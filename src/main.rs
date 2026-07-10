#![cfg_attr(all(not(test), not(debug_assertions)), windows_subsystem = "windows")]
#[macro_use]
extern crate bitflags;
use std::{
    collections::HashSet,
    io::Write,
    path::{Path, PathBuf},
    process::exit,
    sync::Arc,
};
use whoami::username;

use clap::Parser;
use native_windows_gui::{self as nwg, NativeUi};
mod app_paths;
mod bridge;
mod extensions;
mod media;
mod reviews;
mod storage;
mod stremio_app;
mod timestamp_notes;
use crate::stremio_app::{
    constants::{
        DEV_ENDPOINT, IPC_PATH, SERVER_IPC_KEY, STA_ENDPOINT, STREMIO_SERVER_DEV_MODE, WEB_ENDPOINT,
    },
    MainWindow, PipeClient,
};
use app_paths::AppPaths;
use extensions::{ExtensionHost, OriginPolicy};

#[derive(Parser, Debug)]
#[clap(version)]
struct Opt {
    command: Option<String>,
    #[clap(
        long,
        help = "Start the app only in system tray and keep the window hidden"
    )]
    start_hidden: bool,
    #[clap(long, help = "Do not show the splash image")]
    no_splash: bool,
    #[clap(long, help = "Enable dev tools when pressing F12")]
    dev_tools: bool,
    #[clap(long, help = "Disable the server and load the WebUI from localhost")]
    development: bool,
    #[clap(long, help = "Shortcut for --webui-url=https://staging.strem.io/")]
    staging: bool,
    #[clap(long, default_value = WEB_ENDPOINT, help = "Override the WebUI URL")]
    webui_url: String,
    #[clap(long, help = "Disable all JStremio extensions")]
    disable_extensions: bool,
    #[clap(long, value_name = "ID", help = "Disable one packaged extension")]
    disable_extension: Vec<String>,
    #[clap(
        long,
        value_name = "PATH",
        help = "Use a development extension directory"
    )]
    extensions_dir: Option<PathBuf>,
    #[clap(
        long,
        value_name = "PORT",
        help = "Enable loopback WebView2 CDP in debug builds only"
    )]
    remote_debugging_port: Option<u16>,
    #[clap(
        long,
        default_value = "",
        help = "Secret key for communication with the server. By default it is randomly generrated on startup"
    )]
    server_ipc_key: String,
}

fn main() {
    // native-windows-gui has some basic high DPI support with the high-dpi
    // feature. It supports the "System DPI Awareness" mode, but not the more
    // advanced Per-Monitor (v2) DPI Awareness modes.
    //
    // Use an application manifest to get rid of this deprecated warning.
    #[allow(deprecated)]
    unsafe {
        nwg::set_dpi_awareness()
    };
    nwg::enable_visual_styles();

    let opt = Opt::parse();

    std::env::set_var(
        SERVER_IPC_KEY,
        if opt.server_ipc_key.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            opt.server_ipc_key.clone()
        },
    );

    let command = match opt.command {
        Some(file) => {
            if Path::new(&file).exists() {
                "file:///".to_string() + &file.replace('\\', "/")
            } else {
                file
            }
        }
        None => "".to_string(),
    };

    // Single application IPC
    let mut commands_path = IPC_PATH.to_string();
    // Append the username so it works per User
    commands_path.push_str(&username());
    let socket_path = Path::new(&commands_path);
    if let Ok(mut stream) = PipeClient::connect(socket_path) {
        let forwarded = stream
            .write_all(command.as_bytes())
            .and_then(|_| stream.flush())
            .is_ok();
        drop(stream);
        if forwarded {
            exit(0);
        }
        eprintln!("Failed to forward command to existing Stremio instance; launching new instance");
    }
    // END IPC

    std::env::set_var(
        STREMIO_SERVER_DEV_MODE,
        if opt.development { "true" } else { "false" },
    );

    let webui_url = if opt.development && opt.webui_url == WEB_ENDPOINT {
        DEV_ENDPOINT.to_string()
    } else if opt.staging && opt.webui_url == WEB_ENDPOINT {
        STA_ENDPOINT.to_string()
    } else {
        opt.webui_url
    };

    let paths = AppPaths::discover().expect("JStremio requires LOCALAPPDATA");
    let extensions_dir = if let Some(path) = opt.extensions_dir {
        if cfg!(debug_assertions) {
            path
        } else {
            eprintln!("--extensions-dir is ignored outside debug builds");
            packaged_extensions_directory()
        }
    } else {
        packaged_extensions_directory()
    };
    let remote_debugging_port = match opt.remote_debugging_port {
        Some(port) if cfg!(debug_assertions) && port >= 1024 => Some(port),
        Some(_) => {
            eprintln!("--remote-debugging-port is ignored outside debug builds or below 1024");
            None
        }
        None => None,
    };
    let disabled_ids = opt.disable_extension.into_iter().collect::<HashSet<_>>();
    let origins = OriginPolicy::new(
        opt.staging || has_same_origin(&webui_url, STA_ENDPOINT),
        opt.development,
    );
    let extension_host = if opt.disable_extensions {
        println!("JStremio extensions disabled (safe mode)");
        None
    } else {
        match ExtensionHost::load(&extensions_dir, &paths.data, &disabled_ids, origins) {
            Ok(host) => {
                println!(
                    "JStremio {} loaded extensions: {}",
                    env!("CARGO_PKG_VERSION"),
                    host.loaded_ids().join(", ")
                );
                Some(Arc::new(host))
            }
            Err(error) => {
                eprintln!("JStremio extensions unavailable; continuing in safe mode: {error}");
                None
            }
        }
    };
    stremio_app::stremio_wevbiew::configure(
        paths.webview2,
        remote_debugging_port,
        extension_host.clone(),
    )
    .expect("JStremio WebView2 configuration must be set once");

    println!("Initializing JStremio native UI");
    nwg::init().expect("Failed to init Native Windows GUI");
    println!("Building JStremio main window");
    let _app = MainWindow::build_ui(MainWindow {
        command,
        commands_path: Some(commands_path),
        webui_url,
        no_splash: opt.no_splash,
        dev_tools: opt.development || opt.dev_tools,
        start_hidden: opt.start_hidden,
        extension_host,
        ..Default::default()
    })
    .expect("Failed to build UI");
    println!("JStremio main window initialized");
    nwg::dispatch_thread_events();
}

fn packaged_extensions_directory() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("resources")
        .join("extensions")
}

fn has_same_origin(value: &str, expected: &str) -> bool {
    match (url::Url::parse(value), url::Url::parse(expected)) {
        (Ok(value), Ok(expected)) => value.origin() == expected.origin(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::has_same_origin;

    #[test]
    fn recognizes_only_the_exact_configured_origin() {
        assert!(has_same_origin(
            "https://staging.strem.io/#/player",
            "https://staging.strem.io/"
        ));
        assert!(!has_same_origin(
            "https://staging.strem.io.evil.invalid/",
            "https://staging.strem.io/"
        ));
        assert!(!has_same_origin(
            "http://staging.strem.io/",
            "https://staging.strem.io/"
        ));
    }
}
