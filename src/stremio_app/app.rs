use native_windows_derive::NwgUi;
use native_windows_gui as nwg;
use serde_json;
use std::{
    cell::RefCell,
    collections::VecDeque,
    io::Read,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    str,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};
use winapi::um::{
    winbase::CREATE_BREAKAWAY_FROM_JOB,
    winuser::{ShowWindow, SW_MAXIMIZE, WS_EX_TOPMOST},
};

use crate::{
    bridge::{NativeBridge, THEMES_METHOD},
    extensions::{ExtensionHost, MAX_CUSTOM_MESSAGE_BYTES},
    stremio_app::{
        constants::{
            web_endpoint_with_streaming_server, APP_NAME, WEB_ENDPOINT, WINDOW_MIN_HEIGHT,
            WINDOW_MIN_WIDTH,
        },
        ipc::{RPCRequest, RPCResponse},
        mini_player::{
            mini_player_min_outer_size, parse_request as parse_mini_player_request,
            response_event as mini_player_response, MiniPlayerAction, MiniPlayerBridgeError,
            MiniPlayerPlacementStore, MiniPlayerRequest, MiniPlayerSession, MINI_PLAYER_METHOD,
        },
        splash::SplashImage,
        stremio_player::Player,
        stremio_wevbiew::WebView,
        systray::SystemTray,
        window_helper::WindowStyle,
        window_settings::WindowSettings,
        PipeServer,
    },
    themes::{ThemeSettings, ThemeStore},
    updater::UpdateLaunch,
};

use super::discord::DiscordRpc;
use super::stremio_server::StremioServer;

const MAX_PENDING_MINI_PLAYER_REQUESTS: usize = 16;

#[derive(Default, NwgUi)]
pub struct MainWindow {
    pub command: String,
    pub commands_path: Option<String>,
    pub webui_url: String,
    pub no_splash: bool,
    pub dev_tools: bool,
    pub start_hidden: bool,
    pub extension_host: Option<Arc<ExtensionHost>>,
    pub data_directory: PathBuf,
    pub update_launch: Option<UpdateLaunch>,
    pub update_shutdown_command: Option<String>,
    pub requested_fullscreen: Arc<Mutex<Option<bool>>>,
    pub pending_mini_player_requests: Arc<Mutex<VecDeque<MiniPlayerRequest>>>,
    pub mini_player_session: RefCell<MiniPlayerSession>,
    pub mini_player_active_signal: Arc<AtomicBool>,
    pub pending_title_bar_theme: Arc<Mutex<Option<ThemeSettings>>>,
    pub saved_window_style: RefCell<WindowStyle>,
    #[nwg_resource]
    pub embed: nwg::EmbedResource,
    #[nwg_resource(source_embed: Some(&data.embed), source_embed_str: Some("MAINICON"))]
    pub window_icon: nwg::Icon,
    #[nwg_control(icon: Some(&data.window_icon), title: APP_NAME, flags: "MAIN_WINDOW")]
    #[nwg_events(
        OnWindowClose: [Self::on_quit(SELF, EVT_DATA)],
        OnInit: [Self::on_init],
        OnPaint: [Self::on_paint],
        OnMinMaxInfo: [Self::on_min_max(SELF, EVT_DATA)],
        OnWindowMinimize: [Self::transmit_window_state_change],
        OnWindowMaximize: [Self::on_window_state_changed],
        OnWindowFocus: [Self::transmit_window_state_change],
        OnResizeEnd: [Self::on_resize_end],
    )]
    pub window: nwg::Window,
    #[nwg_partial(parent: window)]
    #[nwg_events(
        (tray, MousePressLeftUp): [Self::on_show],
        (tray_exit, OnMenuItemSelected): [Self::on_exit],
        (tray_show_hide, OnMenuItemSelected): [Self::on_show_hide],
        (tray_topmost, OnMenuItemSelected): [Self::on_toggle_topmost],
    )]
    pub tray: SystemTray,
    #[nwg_partial(parent: window)]
    pub splash_screen: SplashImage,
    #[nwg_partial(parent: window)]
    pub server: StremioServer,
    #[nwg_partial(parent: window)]
    pub player: Player,
    #[nwg_partial(parent: window)]
    pub webview: WebView,
    #[nwg_control]
    #[nwg_events(OnNotice: [Self::on_toggle_fullscreen_notice] )]
    pub toggle_fullscreen_notice: nwg::Notice,
    #[nwg_control]
    #[nwg_events(OnNotice: [nwg::stop_thread_dispatch()] )]
    pub quit_notice: nwg::Notice,
    #[nwg_control]
    #[nwg_events(OnNotice: [Self::on_hide_splash_notice] )]
    pub hide_splash_notice: nwg::Notice,
    #[nwg_control]
    #[nwg_events(OnNotice: [Self::on_focus_notice] )]
    pub focus_notice: nwg::Notice,
    #[nwg_control]
    #[nwg_events(OnNotice: [Self::on_title_bar_theme_notice] )]
    pub title_bar_theme_notice: nwg::Notice,
    #[nwg_control]
    #[nwg_events(OnNotice: [Self::on_mini_player_notice] )]
    pub mini_player_notice: nwg::Notice,
}

impl MainWindow {
    fn on_title_bar_theme_notice(&self) {
        let theme = self
            .pending_title_bar_theme
            .lock()
            .ok()
            .and_then(|mut pending| pending.take());
        if let (Some(theme), Some(hwnd), Ok(style)) = (
            theme,
            self.window.handle.hwnd(),
            self.saved_window_style.try_borrow(),
        ) {
            style.set_title_bar_color(hwnd, &theme.surface, &theme.text);
        }
    }

    fn transmit_window_visibility_change(&self) {
        if let (Ok(web_channel), Ok(style)) = (
            self.webview.channel.try_borrow(),
            self.saved_window_style.try_borrow(),
        ) {
            let (web_tx, _) = web_channel
                .as_ref()
                .expect("Cannont obtain communication channel for the Web UI");
            let web_tx_app = web_tx.clone();
            web_tx_app
                .send(RPCResponse::visibility_change(
                    self.window.visible(),
                    style.full_screen as u32,
                    style.full_screen,
                ))
                .ok();
        } else {
            eprintln!("Cannot obtain communication channel or window style");
        }
    }
    fn transmit_window_state_change(&self) {
        if let (Some(hwnd), Ok(web_channel), Ok(style)) = (
            self.window.handle.hwnd(),
            self.webview.channel.try_borrow(),
            self.saved_window_style.try_borrow(),
        ) {
            let state = style.clone().get_window_state(hwnd);
            drop(style);
            let (web_tx, _) = web_channel
                .as_ref()
                .expect("Cannont obtain communication channel for the Web UI");
            let web_tx_app = web_tx.clone();
            web_tx_app.send(RPCResponse::state_change(state)).ok();
        } else {
            eprintln!("Cannot obtain window handle or communication channel");
        }
    }
    fn on_init(&self) {
        let webui_url =
            if self.webui_url.trim_end_matches('/') == WEB_ENDPOINT.trim_end_matches('/') {
                self.server
                    .server_url()
                    .map(|server_url| web_endpoint_with_streaming_server(&server_url))
                    .unwrap_or_else(|| self.webui_url.clone())
            } else {
                self.webui_url.clone()
            };
        self.webview.endpoint.set(webui_url).ok();
        self.webview.dev_tools.set(self.dev_tools).ok();
        let theme = ThemeStore::new(&self.data_directory)
            .get()
            .unwrap_or_default();
        if let Some(hwnd) = self.window.handle.hwnd() {
            if let Ok(mut saved_style) = self.saved_window_style.try_borrow_mut() {
                saved_style.set_title_bar_color(hwnd, &theme.surface, &theme.text);
                if let Some(window_settings) = WindowSettings::load() {
                    let _ = saved_style
                        .restore_window_placement(hwnd, window_settings.to_window_placement());
                } else {
                    saved_style.center_window(hwnd, WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT);
                }
            }
        }

        self.window.set_visible(!self.start_hidden);
        self.tray.tray_show_hide.set_checked(!self.start_hidden);
        if self.no_splash {
            self.splash_screen.hide();
        }

        let player_channel = self.player.channel.borrow();
        let (player_tx, player_rx) = player_channel
            .as_ref()
            .expect("Cannont obtain communication channel for the Player");
        let player_tx = player_tx.clone();
        let player_rx = player_rx.clone();
        if let Some(extension_host) = &self.extension_host {
            extension_host
                .phone_remote()
                .attach_player(player_tx.clone());
        }

        let web_channel = self.webview.channel.borrow();
        let (web_tx, web_rx) = web_channel
            .as_ref()
            .expect("Cannont obtain communication channel for the Web UI");
        let web_tx_player = web_tx.clone();
        let web_tx_web = web_tx.clone();
        let web_tx_arg = web_tx.clone();
        let web_rx = web_rx.clone();

        let command_clone = self.command.clone();
        let update_shutdown_command = self.update_shutdown_command.clone();
        let quit_sender = self.quit_notice.sender();

        // Single application IPC
        let socket_path = Path::new(
            self.commands_path
                .as_ref()
                .expect("Cannot initialie the single application IPC"),
        );

        if let Ok(mut listener) = PipeServer::bind(socket_path) {
            let focus_sender = self.focus_notice.sender();
            thread::spawn(move || loop {
                if let Ok(mut stream) = listener.accept() {
                    let mut buf = vec![];
                    stream.read_to_end(&mut buf).ok();
                    if let Ok(s) = str::from_utf8(&buf) {
                        if is_update_shutdown_command(s, update_shutdown_command.as_deref()) {
                            quit_sender.notice();
                            continue;
                        }
                        focus_sender.notice();
                        // ['open-media', url]
                        web_tx_arg.send(RPCResponse::open_media(s.to_string())).ok();
                        println!("{s}");
                    }
                }
            });
        }

        if let Some(update_launch) = self.update_launch.clone() {
            thread::spawn(move || {
                if let Err(error) = update_launch.start() {
                    eprintln!("JStremio update check could not start: {error}");
                }
            });
        }

        // Read message from player
        thread::spawn(move || loop {
            player_rx
                .iter()
                .map(|msg| web_tx_player.send(msg))
                .for_each(drop);
        }); // thread

        let toggle_fullscreen_sender = self.toggle_fullscreen_notice.sender();
        let hide_splash_sender = self.hide_splash_notice.sender();
        let focus_sender = self.focus_notice.sender();
        let title_bar_theme_sender = self.title_bar_theme_notice.sender();
        let mini_player_sender = self.mini_player_notice.sender();
        let discord_rpc = DiscordRpc::new(web_tx.clone());
        let requested_fullscreen = self.requested_fullscreen.clone();
        let pending_mini_player_requests = self.pending_mini_player_requests.clone();
        let pending_title_bar_theme = self.pending_title_bar_theme.clone();
        let extension_host = self.extension_host.clone();
        let data_directory = self.data_directory.clone();

        thread::spawn(move || loop {
            if let Ok(web_message) = web_rx.recv() {
                let Some(msg) = serde_json::from_str::<RPCRequest>(&web_message.message).ok()
                else {
                    continue;
                };
                if let Some(method) = msg.get_method() {
                    if method == MINI_PLAYER_METHOD {
                        let allowed = extension_host.as_ref().is_some_and(|host| {
                            host.allows_message(&web_message.source, &web_message.top_level_source)
                        });
                        if !allowed {
                            continue;
                        }
                        let parsed = if web_message.message.len() > MAX_CUSTOM_MESSAGE_BYTES {
                            Err(MiniPlayerBridgeError::new(
                                "message_too_large",
                                "The request exceeds the native message limit.",
                            ))
                        } else {
                            parse_mini_player_request(msg.id, msg.get_params())
                        };
                        match parsed {
                            Ok(request) => {
                                if let Ok(mut pending) = pending_mini_player_requests.lock() {
                                    if pending.len() < MAX_PENDING_MINI_PLAYER_REQUESTS {
                                        pending.push_back(request);
                                        mini_player_sender.notice();
                                    } else {
                                        web_tx_web
                                            .send(RPCResponse::response_message(Some(
                                                mini_player_response(
                                                    msg.id,
                                                    Err(MiniPlayerBridgeError::new(
                                                        "native_busy",
                                                        "Too many mini-player requests are pending.",
                                                    )),
                                                ),
                                            )))
                                            .ok();
                                    }
                                } else {
                                    web_tx_web
                                        .send(RPCResponse::response_message(Some(
                                            mini_player_response(
                                                msg.id,
                                                Err(MiniPlayerBridgeError::new(
                                                    "native_busy",
                                                    "The mini-player request queue is unavailable.",
                                                )),
                                            ),
                                        )))
                                        .ok();
                                }
                            }
                            Err(error) => {
                                web_tx_web
                                    .send(RPCResponse::response_message(Some(
                                        mini_player_response(msg.id, Err(error)),
                                    )))
                                    .ok();
                            }
                        }
                        continue;
                    }
                    if NativeBridge::supports(method) {
                        let updates_title_bar = method == THEMES_METHOD
                            && msg
                                .get_params()
                                .and_then(|params| params.get("operation"))
                                .and_then(|operation| operation.as_str())
                                .is_some_and(|operation| matches!(operation, "set" | "reset"));
                        if let Some(response) = extension_host.as_ref().and_then(|host| {
                            host.handle_bridge_message(
                                method,
                                msg.id,
                                msg.get_params(),
                                web_message.message.len(),
                                &web_message.source,
                                &web_message.top_level_source,
                            )
                        }) {
                            if updates_title_bar {
                                if let Ok(theme) = ThemeStore::new(&data_directory).get() {
                                    if let Ok(mut pending) = pending_title_bar_theme.lock() {
                                        *pending = Some(theme);
                                        title_bar_theme_sender.notice();
                                    }
                                }
                            }
                            web_tx_web
                                .send(RPCResponse::response_message(Some(response.into_event())))
                                .ok();
                        }
                        continue;
                    }
                }
                match msg.get_method() {
                    // The handshake. Here we send some useful data to the WEB UI
                    None if msg.is_handshake() => {
                        web_tx_web.send(RPCResponse::get_handshake()).ok();
                    }
                    Some("win-set-visibility") => {
                        if let Some(fullscreen) = msg
                            .get_params()
                            .and_then(|params| params.get("fullscreen"))
                            .and_then(|value| value.as_bool())
                        {
                            *requested_fullscreen.lock().unwrap() = Some(fullscreen);
                            toggle_fullscreen_sender.notice();
                        }
                    }
                    Some("quit") => quit_sender.notice(),
                    Some("app-ready") => {
                        hide_splash_sender.notice();
                        web_tx_web
                            .send(RPCResponse::visibility_change(true, 1, false))
                            .ok();
                        let command_ref = command_clone.clone();
                        if !command_ref.is_empty() {
                            web_tx_web.send(RPCResponse::open_media(command_ref)).ok();
                        }
                    }
                    Some("app-error") => {
                        hide_splash_sender.notice();
                        if let Some(arg) = msg.get_params() {
                            // TODO: Make this modal dialog
                            eprintln!("Web App Error: {arg}");
                        }
                    }
                    Some("open-external") => {
                        if let Some(arg) = msg.get_params() {
                            // FIXME: THIS IS NOT SAFE BY ANY MEANS
                            // open::that("calc").ok(); does exactly that
                            let arg = arg.as_str().unwrap_or("");
                            let arg_lc = arg.to_lowercase();
                            if arg_lc.starts_with("http://")
                                || arg_lc.starts_with("https://")
                                || arg_lc.starts_with("rtp://")
                                || arg_lc.starts_with("rtps://")
                                || arg_lc.starts_with("ftp://")
                                || arg_lc.starts_with("ipfs://")
                            {
                                open::that(arg).ok();
                            }
                        }
                    }
                    Some("play-external") => {
                        if let Some(arg) = msg.get_params() {
                            let arg = arg.as_str().unwrap_or("");
                            let arg_lc = arg.to_lowercase();
                            const ALLOWED_SCHEMES: &[&str] = &["mpv://", "vlc://", "potplayer://"];
                            let allowed = ALLOWED_SCHEMES.iter().any(|s| arg_lc.starts_with(s));
                            if !arg.is_empty() && allowed {
                                if let Some(stream_url) =
                                    arg_lc.starts_with("mpv://").then(|| &arg[6..])
                                {
                                    // `--` ends mpv's option parsing; the stream URL can't smuggle flags.
                                    let mpv_paths: Vec<String> = vec![
                                        std::env::var("ProgramFiles")
                                            .ok()
                                            .map(|v| format!("{v}\\mpv\\mpv.exe")),
                                        std::env::var("ProgramFiles(x86)")
                                            .ok()
                                            .map(|v| format!("{v}\\mpv\\mpv.exe")),
                                        std::env::var("LOCALAPPDATA")
                                            .ok()
                                            .map(|v| format!("{v}\\Programs\\mpv\\mpv.exe")),
                                        std::env::var("LOCALAPPDATA")
                                            .ok()
                                            .map(|v| format!("{v}\\mpv\\mpv.exe")),
                                        Some("mpv.exe".to_string()),
                                    ]
                                    .into_iter()
                                    .flatten()
                                    .collect();
                                    for path in &mpv_paths {
                                        if Command::new(path)
                                            .arg("--")
                                            .arg(stream_url)
                                            .creation_flags(CREATE_BREAKAWAY_FROM_JOB)
                                            .spawn()
                                            .is_ok()
                                        {
                                            break;
                                        }
                                    }
                                } else {
                                    open::that(arg).ok();
                                }
                            }
                        }
                    }
                    Some("win-focus") => {
                        focus_sender.notice();
                    }
                    Some("autoupdater-notif-clicked") => {
                        eprintln!("The official Stremio updater is disabled in JStremio");
                    }
                    Some("discord-connect") => {
                        if let Err(e) = discord_rpc.connect() {
                            eprintln!("Discord connect error: {}", e);
                            web_tx_web.send(RPCResponse::discord_status(false)).ok();
                        }
                    }
                    Some("discord-disconnect") => {
                        if let Err(e) = discord_rpc.disconnect() {
                            eprintln!("Discord disconnect error: {}", e);
                        }
                        web_tx_web.send(RPCResponse::discord_status(false)).ok();
                    }
                    Some("discord-set-activity") => {
                        if let Some(params) = msg.get_params() {
                            let state = params.get("state").and_then(|v| v.as_str()).unwrap_or("");
                            let details =
                                params.get("details").and_then(|v| v.as_str()).unwrap_or("");
                            let image = params.get("image").and_then(|v| v.as_str());
                            let start_timestamp =
                                params.get("startTimestamp").and_then(|v| v.as_i64());
                            let end_timestamp = params.get("endTimestamp").and_then(|v| v.as_i64());

                            if let Err(e) = discord_rpc.set_activity(
                                state,
                                details,
                                image,
                                start_timestamp,
                                end_timestamp,
                            ) {
                                eprintln!("Discord set activity error: {}", e);
                            }
                        }
                    }
                    Some("discord-clear-activity") => {
                        if let Err(e) = discord_rpc.clear_activity() {
                            eprintln!("Discord clear activity error: {}", e);
                        }
                    }
                    Some(player_command) if player_command.starts_with("mpv-") => {
                        if player_command == "mpv-command"
                            && msg
                                .get_params()
                                .and_then(|params| params.as_array())
                                .and_then(|params| params.first())
                                .and_then(|command| command.as_str())
                                == Some("screenshot-to-file")
                            && !allowed_screenshot_command(msg.get_params(), &data_directory)
                        {
                            eprintln!("Rejected screenshot command outside the prepared thumbnail directory");
                            continue;
                        }
                        let resp_json = serde_json::to_string(
                            &msg.args.expect("Cannot have method without args"),
                        )
                        .expect("Cannot build response");
                        player_tx.send(resp_json).ok();
                    }
                    Some(unknown) => {
                        eprintln!("Unsupported command {}({:?})", unknown, msg.get_params())
                    }
                    None => {}
                }
            } // recv
        }); // thread
    }
    fn on_min_max(&self, data: &nwg::EventData) {
        let data = data.on_min_max();
        // WM_GETMINMAXINFO is emitted synchronously from SetWindowPos while
        // MiniPlayerSession is mutably borrowed. The shared signal avoids a
        // failed RefCell borrow falling back to the normal 1000x600 minimum.
        let mini_player = self.mini_player_active_signal.load(Ordering::Acquire);
        if mini_player {
            if let Some(hwnd) = self.window.handle.hwnd() {
                let (width, height) = mini_player_min_outer_size(hwnd);
                data.set_min_size(width, height);
            }
        } else {
            data.set_min_size(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT);
        }
    }
    fn on_paint(&self) {
        if !self.splash_screen.visible() {
            self.refresh_webview_bounds();
        }
    }
    fn refresh_webview_bounds(&self) {
        self.webview.fit_to_window(self.window.handle.hwnd());
    }
    fn on_resize_end(&self) {
        self.refresh_webview_bounds();
        if self.mini_player_active() {
            self.save_mini_player_settings();
        } else {
            self.save_window_settings();
        }
    }
    fn on_window_state_changed(&self) {
        if self.mini_player_active() {
            if let Some(hwnd) = self.window.handle.hwnd() {
                let store = MiniPlayerPlacementStore::new(&self.data_directory);
                let mut should_maximize = false;
                if let (Ok(mut session), Ok(mut style)) = (
                    self.mini_player_session.try_borrow_mut(),
                    self.saved_window_style.try_borrow_mut(),
                ) {
                    if let Err(error) = session.exit(hwnd, &mut style, &store) {
                        eprintln!("Cannot leave mini player before maximizing: {error:?}");
                    } else {
                        self.mini_player_active_signal
                            .store(false, Ordering::Release);
                        should_maximize = true;
                    }
                }
                if should_maximize {
                    unsafe { ShowWindow(hwnd, SW_MAXIMIZE) };
                }
            }
        }
        self.refresh_webview_bounds();
        self.save_window_settings();
        self.transmit_window_state_change();
    }
    fn save_window_settings(&self) {
        if self
            .saved_window_style
            .try_borrow()
            .map(|style| style.full_screen)
            .unwrap_or(false)
            || self.mini_player_active()
        {
            return;
        }
        if let Some(hwnd) = self.window.handle.hwnd() {
            if let Err(err) = WindowSettings::save(hwnd) {
                eprintln!("Cannot save window settings: {err}");
            }
        }
    }
    fn on_toggle_fullscreen_notice(&self) {
        if let Some(hwnd) = self.window.handle.hwnd() {
            if let Ok(mut saved_style) = self.saved_window_style.try_borrow_mut() {
                let target = self
                    .requested_fullscreen
                    .lock()
                    .unwrap()
                    .take()
                    .unwrap_or(!saved_style.full_screen);
                if target {
                    if let Ok(mut session) = self.mini_player_session.try_borrow_mut() {
                        if session.is_active() {
                            let store = MiniPlayerPlacementStore::new(&self.data_directory);
                            if let Err(error) = session.exit(hwnd, &mut saved_style, &store) {
                                eprintln!("Cannot leave mini player before fullscreen: {error:?}");
                            } else {
                                self.mini_player_active_signal
                                    .store(false, Ordering::Release);
                            }
                        }
                    }
                }
                saved_style.set_full_screen(hwnd, target);
                self.tray
                    .tray_topmost
                    .set_enabled(!saved_style.full_screen && !self.mini_player_active());
                self.tray
                    .tray_topmost
                    .set_checked((saved_style.ex_style as u32 & WS_EX_TOPMOST) == WS_EX_TOPMOST);
            }
        }
        self.refresh_webview_bounds();
        self.transmit_window_visibility_change();
    }
    fn on_hide_splash_notice(&self) {
        self.splash_screen.hide();
        self.refresh_webview_bounds();
    }
    fn on_focus_notice(&self) {
        self.window.set_visible(true);
        if let Some(hwnd) = self.window.handle.hwnd() {
            if let Ok(mut saved_style) = self.saved_window_style.try_borrow_mut() {
                saved_style.set_active(hwnd);
            }
        }
        self.refresh_webview_bounds();
    }
    fn on_toggle_topmost(&self) {
        if self.mini_player_active() {
            return;
        }
        if let Some(hwnd) = self.window.handle.hwnd() {
            if let Ok(mut saved_style) = self.saved_window_style.try_borrow_mut() {
                saved_style.toggle_topmost(hwnd);
                self.tray
                    .tray_topmost
                    .set_checked((saved_style.ex_style as u32 & WS_EX_TOPMOST) == WS_EX_TOPMOST);
            }
        }
    }
    fn on_show(&self) {
        self.window.set_visible(true);
        if let (Some(hwnd), Ok(mut saved_style)) = (
            self.window.handle.hwnd(),
            self.saved_window_style.try_borrow_mut(),
        ) {
            if saved_style.is_window_minimized(hwnd) {
                self.window.restore();
            }
            saved_style.set_active(hwnd);
        }
        self.refresh_webview_bounds();
        self.tray.tray_show_hide.set_checked(self.window.visible());
        self.transmit_window_state_change();
        self.transmit_window_visibility_change();
    }
    fn on_show_hide(&self) {
        if self.window.visible() {
            self.window.set_visible(false);
            self.tray.tray_show_hide.set_checked(self.window.visible());
            self.transmit_window_state_change();
            self.transmit_window_visibility_change();
        } else {
            self.on_show();
        }
    }
    fn on_quit(&self, data: &nwg::EventData) {
        if let nwg::EventData::OnWindowClose(data) = data {
            data.close(false);
        }
        self.save_window_settings();
        self.window.set_visible(false);
        self.tray.tray_show_hide.set_checked(self.window.visible());
        self.transmit_window_visibility_change();
    }
    fn on_exit(&self) {
        self.save_mini_player_settings();
        self.save_window_settings();
        nwg::stop_thread_dispatch();
    }

    fn mini_player_active(&self) -> bool {
        self.mini_player_session
            .try_borrow()
            .map(|session| session.is_active())
            .unwrap_or(false)
    }

    fn save_mini_player_settings(&self) {
        let Some(hwnd) = self.window.handle.hwnd() else {
            return;
        };
        let store = MiniPlayerPlacementStore::new(&self.data_directory);
        if let Ok(session) = self.mini_player_session.try_borrow() {
            session.save_current(hwnd, &store);
        }
    }

    fn on_mini_player_notice(&self) {
        let requests = self
            .pending_mini_player_requests
            .lock()
            .map(|mut pending| pending.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();
        for request in requests {
            let result = self.apply_mini_player_action(request.action);
            self.send_mini_player_response(request.request_id, result);
        }
    }

    fn apply_mini_player_action(
        &self,
        action: MiniPlayerAction,
    ) -> Result<crate::stremio_app::mini_player::MiniPlayerState, MiniPlayerBridgeError> {
        let changes_window = action.changes_window();
        let hwnd = self.window.handle.hwnd().ok_or_else(|| {
            MiniPlayerBridgeError::new("native_error", "The application window is unavailable.")
        })?;
        if matches!(action, MiniPlayerAction::Set(true)) && !self.mini_player_active() {
            self.save_window_settings();
        }
        let store = MiniPlayerPlacementStore::new(&self.data_directory);
        if let MiniPlayerAction::Set(enabled) = action {
            // The raw Win32 handler must know before SetWindowPos synchronously
            // emits sizing/hit-test messages.
            self.mini_player_active_signal
                .store(enabled, Ordering::Release);
        }
        let result = {
            let mut session = self.mini_player_session.try_borrow_mut().map_err(|_| {
                MiniPlayerBridgeError::new("native_busy", "The mini-player state is busy.")
            })?;
            let mut style = self.saved_window_style.try_borrow_mut().map_err(|_| {
                MiniPlayerBridgeError::new("native_busy", "The window style is busy.")
            })?;
            match action {
                MiniPlayerAction::Get => session.state(hwnd),
                MiniPlayerAction::Set(true) => session.enter(hwnd, &mut style, &store),
                MiniPlayerAction::Set(false) => session.exit(hwnd, &mut style, &store),
            }
        };

        if matches!(action, MiniPlayerAction::Set(_)) {
            let enabled = result
                .as_ref()
                .map(|state| state.enabled)
                .unwrap_or_else(|_| self.mini_player_active());
            self.mini_player_active_signal
                .store(enabled, Ordering::Release);
        }

        if changes_window {
            self.refresh_webview_bounds();
            if let Ok(style) = self.saved_window_style.try_borrow() {
                let mini_player = self.mini_player_active();
                self.tray
                    .tray_topmost
                    .set_enabled(!mini_player && !style.full_screen);
                self.tray.tray_topmost.set_checked(
                    mini_player || (style.ex_style as u32 & WS_EX_TOPMOST) == WS_EX_TOPMOST,
                );
            }
            self.transmit_window_state_change();
            self.transmit_window_visibility_change();
        }
        result
    }

    fn send_mini_player_response(
        &self,
        request_id: u64,
        result: Result<crate::stremio_app::mini_player::MiniPlayerState, MiniPlayerBridgeError>,
    ) {
        if let Ok(web_channel) = self.webview.channel.try_borrow() {
            if let Some((web_tx, _)) = web_channel.as_ref() {
                web_tx
                    .send(RPCResponse::response_message(Some(mini_player_response(
                        request_id, result,
                    ))))
                    .ok();
            }
        }
    }
}

fn allowed_screenshot_command(params: Option<&serde_json::Value>, data_directory: &Path) -> bool {
    let Some(values) = params.and_then(|value| value.as_array()) else {
        return false;
    };
    if values.len() != 3
        || values.first().and_then(|value| value.as_str()) != Some("screenshot-to-file")
        || values.get(2).and_then(|value| value.as_str()) != Some("video")
    {
        return false;
    }
    let Some(path) = values
        .get(1)
        .and_then(|value| value.as_str())
        .map(Path::new)
    else {
        return false;
    };
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(id) = file_name.strip_suffix(".jpg") else {
        return false;
    };
    if uuid::Uuid::parse_str(id).is_err() {
        return false;
    }
    let expected = data_directory.join("timestamp-thumbnails");
    path.parent()
        .and_then(|parent| parent.canonicalize().ok())
        .zip(expected.canonicalize().ok())
        .is_some_and(|(parent, expected)| parent == expected)
}

fn is_update_shutdown_command(incoming: &str, expected: Option<&str>) -> bool {
    expected.is_some_and(|expected| incoming == expected)
}

#[cfg(test)]
mod frame_capture_tests {
    use super::{allowed_screenshot_command, is_update_shutdown_command};
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn screenshot_command_is_limited_to_generated_thumbnail_paths() {
        let root = tempdir().unwrap();
        let thumbnails = root.path().join("timestamp-thumbnails");
        fs::create_dir_all(&thumbnails).unwrap();
        let allowed = thumbnails.join("11111111-1111-4111-8111-111111111111.jpg");
        assert!(allowed_screenshot_command(
            Some(&json!(["screenshot-to-file", allowed, "video"])),
            root.path(),
        ));
        assert!(!allowed_screenshot_command(
            Some(&json!([
                "screenshot-to-file",
                "C:\\Windows\\outside.jpg",
                "video"
            ])),
            root.path(),
        ));
    }

    #[test]
    fn update_shutdown_requires_the_exact_per_launch_command() {
        let expected = "jstremio-internal-update-ready:11111111-1111-4111-8111-111111111111";
        assert!(is_update_shutdown_command(expected, Some(expected)));
        assert!(!is_update_shutdown_command(
            "jstremio-internal-update-ready:22222222-2222-4222-8222-222222222222",
            Some(expected)
        ));
        assert!(!is_update_shutdown_command(expected, None));
    }
}
