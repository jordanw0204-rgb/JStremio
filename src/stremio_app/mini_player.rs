use crate::{
    storage::{JsonStore, StorageError, StoredDocument},
    stremio_app::window_helper::WindowStyle,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io, mem, path::Path};
use winapi::{
    shared::windef::{HWND, RECT},
    um::winuser::{
        AdjustWindowRectEx, GetMonitorInfoA, GetWindowLongA, GetWindowPlacement, GetWindowRect,
        MonitorFromRect, MonitorFromWindow, SetWindowLongA, SetWindowPos, ShowWindow, GWL_EXSTYLE,
        GWL_STYLE, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTCAPTION, HTLEFT, HTRIGHT, HTTOP,
        HTTOPLEFT, HTTOPRIGHT, HWND_TOPMOST, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_RESTORE,
        WINDOWPLACEMENT, WMSZ_BOTTOM, WMSZ_BOTTOMLEFT, WMSZ_BOTTOMRIGHT, WMSZ_LEFT, WMSZ_RIGHT,
        WMSZ_TOP, WMSZ_TOPLEFT, WMSZ_TOPRIGHT, WS_CAPTION, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME,
        WS_EX_STATICEDGE, WS_EX_TOPMOST, WS_EX_WINDOWEDGE,
    },
};

pub const MINI_PLAYER_METHOD: &str = "jstremio-mini-player";
pub const MINI_PLAYER_MIN_WIDTH: i32 = 420;
pub const MINI_PLAYER_MIN_HEIGHT: i32 = 236;

const SETTINGS_FILE: &str = "mini-player.json";
const DEFAULT_MIN_WIDTH: i32 = 480;
const DEFAULT_MAX_WIDTH: i32 = 720;
const DEFAULT_MARGIN: i32 = 16;
const VIDEO_ASPECT_WIDTH: i32 = 16;
const VIDEO_ASPECT_HEIGHT: i32 = 9;
const RESIZE_BORDER_PX: i32 = 7;
const DRAG_STRIP_HEIGHT_PX: i32 = 24;
const MAX_WINDOW_DIMENSION: i32 = 16_384;
const MAX_COORDINATE: i32 = 262_144;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MiniPlayerRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl MiniPlayerRect {
    fn validate(&self) -> Result<(), StorageError> {
        if self.width < MINI_PLAYER_MIN_WIDTH || self.width > MAX_WINDOW_DIMENSION {
            return Err(StorageError::invalid(
                "width",
                "is outside the supported mini-player range",
            ));
        }
        if self.height < MINI_PLAYER_MIN_HEIGHT || self.height > MAX_WINDOW_DIMENSION {
            return Err(StorageError::invalid(
                "height",
                "is outside the supported mini-player range",
            ));
        }
        if !(-MAX_COORDINATE..=MAX_COORDINATE).contains(&self.x)
            || !(-MAX_COORDINATE..=MAX_COORDINATE).contains(&self.y)
        {
            return Err(StorageError::invalid(
                "position",
                "is outside the supported desktop range",
            ));
        }
        Ok(())
    }

    fn from_rect(rect: RECT) -> Option<Self> {
        let width = rect.right.checked_sub(rect.left)?;
        let height = rect.bottom.checked_sub(rect.top)?;
        let result = Self {
            x: rect.left,
            y: rect.top,
            width,
            height,
        };
        result.validate().ok().map(|_| result)
    }

    fn as_rect(self) -> RECT {
        RECT {
            left: self.x,
            top: self.y,
            right: self.x.saturating_add(self.width),
            bottom: self.y.saturating_add(self.height),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MiniPlayerDocument {
    schema_version: u32,
    revision: u64,
    placement: Option<MiniPlayerRect>,
}

impl Default for MiniPlayerDocument {
    fn default() -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            revision: 0,
            placement: None,
        }
    }
}

impl StoredDocument for MiniPlayerDocument {
    const SCHEMA_VERSION: u32 = 1;

    fn schema_version(&self) -> u32 {
        self.schema_version
    }

    fn validate(&self) -> Result<(), StorageError> {
        if let Some(placement) = self.placement {
            placement.validate()?;
        }
        Ok(())
    }
}

pub struct MiniPlayerPlacementStore {
    store: JsonStore<MiniPlayerDocument>,
}

impl MiniPlayerPlacementStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join(SETTINGS_FILE)),
        }
    }

    pub fn load(&self) -> Result<Option<MiniPlayerRect>, StorageError> {
        self.store.read().map(|document| document.placement)
    }

    pub fn save(&self, placement: MiniPlayerRect) -> Result<(), StorageError> {
        placement.validate()?;
        self.store.mutate(|document| {
            document.placement = Some(placement);
            document.revision = document.revision.saturating_add(1);
            Ok(())
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MiniPlayerAction {
    Get,
    Set(bool),
}

impl MiniPlayerAction {
    pub fn changes_window(self) -> bool {
        matches!(self, Self::Set(_))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MiniPlayerRequest {
    pub request_id: u64,
    pub action: MiniPlayerAction,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MiniPlayerBridgeError {
    code: &'static str,
    message: String,
}

impl MiniPlayerBridgeError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn native(message: impl Into<String>) -> Self {
        Self::new("native_error", message)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestEnvelope {
    operation: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetPayload {
    enabled: bool,
}

pub fn parse_request(
    request_id: u64,
    params: Option<&Value>,
) -> Result<MiniPlayerRequest, MiniPlayerBridgeError> {
    let params = params.ok_or_else(|| {
        MiniPlayerBridgeError::new("invalid_request", "The request payload is required.")
    })?;
    let envelope = serde_json::from_value::<RequestEnvelope>(params.clone()).map_err(|_| {
        MiniPlayerBridgeError::new("invalid_request", "The mini-player request is invalid.")
    })?;
    let action = match envelope.operation.as_str() {
        "get" => {
            if !envelope
                .payload
                .as_object()
                .is_some_and(serde_json::Map::is_empty)
            {
                return Err(MiniPlayerBridgeError::new(
                    "invalid_request",
                    "The get operation does not accept values.",
                ));
            }
            MiniPlayerAction::Get
        }
        "set" => {
            let payload = serde_json::from_value::<SetPayload>(envelope.payload).map_err(|_| {
                MiniPlayerBridgeError::new(
                    "invalid_request",
                    "The set operation requires an enabled boolean.",
                )
            })?;
            MiniPlayerAction::Set(payload.enabled)
        }
        _ => {
            return Err(MiniPlayerBridgeError::new(
                "unknown_operation",
                "The requested mini-player operation is not supported.",
            ))
        }
    };
    Ok(MiniPlayerRequest { request_id, action })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniPlayerState {
    pub enabled: bool,
    pub topmost: bool,
    pub bounds: MiniPlayerRect,
}

pub fn response_event(
    request_id: u64,
    result: Result<MiniPlayerState, MiniPlayerBridgeError>,
) -> Value {
    let payload = match result {
        Ok(state) => json!({ "requestId": request_id, "ok": true, "result": state }),
        Err(error) => json!({
            "requestId": request_id,
            "ok": false,
            "error": {
                "code": error.code,
                "message": error.message,
                "recoverable": true,
            }
        }),
    };
    json!([format!("{MINI_PLAYER_METHOD}-response"), payload])
}

#[derive(Default)]
pub struct MiniPlayerSession {
    active: bool,
    restore_placement: Option<WINDOWPLACEMENT>,
    restore_topmost: bool,
    restore_fullscreen: bool,
    restore_style: Option<i32>,
    restore_ex_style: Option<i32>,
}

impl MiniPlayerSession {
    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn state(&self, hwnd: HWND) -> Result<MiniPlayerState, MiniPlayerBridgeError> {
        Ok(MiniPlayerState {
            enabled: self.active,
            topmost: is_topmost(hwnd),
            bounds: current_window_rect(hwnd)?,
        })
    }

    pub fn enter(
        &mut self,
        hwnd: HWND,
        style: &mut WindowStyle,
        store: &MiniPlayerPlacementStore,
    ) -> Result<MiniPlayerState, MiniPlayerBridgeError> {
        if self.active {
            return self.state(hwnd);
        }
        let restore_fullscreen = style.full_screen;
        if restore_fullscreen {
            style.set_full_screen(hwnd, false);
        }
        if unsafe { winapi::um::winuser::IsIconic(hwnd) } != 0 {
            unsafe { ShowWindow(hwnd, SW_RESTORE) };
        }

        let restore_placement = current_placement(hwnd)?;
        let restore_topmost = is_topmost(hwnd);
        if unsafe { winapi::um::winuser::IsZoomed(hwnd) } != 0 {
            unsafe { ShowWindow(hwnd, SW_RESTORE) };
        }

        let persisted = match store.load() {
            Ok(placement) => placement,
            Err(error) => {
                eprintln!("Cannot load mini-player placement: {error}");
                None
            }
        };
        let work_area = monitor_work_area(hwnd, persisted)?;
        let candidate = persisted
            .filter(|placement| persisted_placement_is_compact(*placement, work_area))
            .unwrap_or_else(|| default_placement(work_area));
        self.restore_placement = Some(restore_placement);
        self.restore_topmost = restore_topmost;
        self.restore_fullscreen = restore_fullscreen;
        self.restore_style = Some(unsafe { GetWindowLongA(hwnd, GWL_STYLE) });
        self.restore_ex_style = Some(unsafe { GetWindowLongA(hwnd, GWL_EXSTYLE) });
        if let Err(error) = apply_mini_player_frame(hwnd) {
            let _ = self.restore_window_frame(hwnd);
            self.restore_placement = None;
            self.restore_style = None;
            self.restore_ex_style = None;
            if restore_fullscreen {
                style.set_full_screen(hwnd, true);
            }
            return Err(error);
        }
        let placement = clamp_to_work_area(
            aspect_locked_placement(hwnd, candidate, work_area),
            work_area,
        );
        // WM_GETMINMAXINFO can be delivered synchronously by SetWindowPos. Mark
        // the session active first so MainWindow supplies the mini-player limits.
        self.active = true;
        let positioned = unsafe {
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                placement.x,
                placement.y,
                placement.width,
                placement.height,
                SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            )
        };
        if positioned == 0 {
            let error = io::Error::last_os_error();
            self.active = false;
            let _ = self.restore_window_frame(hwnd);
            if let Some(placement) = self.restore_placement.take() {
                let _ = style.restore_window_placement(hwnd, placement);
            }
            let _ = style.set_topmost(hwnd, restore_topmost);
            if restore_fullscreen {
                style.set_full_screen(hwnd, true);
            }
            self.restore_style = None;
            self.restore_ex_style = None;
            return Err(MiniPlayerBridgeError::native(format!(
                "The mini-player window could not be positioned. {error}"
            )));
        }

        if !style.set_topmost(hwnd, true) {
            let error = io::Error::last_os_error();
            self.active = false;
            let _ = self.restore_window_frame(hwnd);
            if let Some(placement) = self.restore_placement.take() {
                let _ = style.restore_window_placement(hwnd, placement);
            }
            let _ = style.set_topmost(hwnd, restore_topmost);
            if restore_fullscreen {
                style.set_full_screen(hwnd, true);
            }
            self.restore_style = None;
            self.restore_ex_style = None;
            return Err(MiniPlayerBridgeError::native(format!(
                "The mini-player could not be kept above other windows. {error}"
            )));
        }
        self.state(hwnd)
    }

    pub fn exit(
        &mut self,
        hwnd: HWND,
        style: &mut WindowStyle,
        store: &MiniPlayerPlacementStore,
    ) -> Result<MiniPlayerState, MiniPlayerBridgeError> {
        if !self.active {
            return self.state(hwnd);
        }
        if let Ok(placement) = current_window_rect(hwnd) {
            if let Err(error) = store.save(placement) {
                eprintln!("Cannot save mini-player placement: {error}");
            }
        }

        let restore_placement = self.restore_placement.ok_or_else(|| {
            MiniPlayerBridgeError::native("The normal window placement is unavailable.")
        })?;
        self.restore_window_frame(hwnd)?;
        if !style.restore_window_placement(hwnd, restore_placement) {
            return Err(last_error(
                "The normal window placement could not be restored.",
            ));
        }
        if !style.set_topmost(hwnd, self.restore_topmost) {
            return Err(last_error(
                "The previous always-on-top state could not be restored.",
            ));
        }
        self.restore_style = None;
        self.restore_ex_style = None;
        self.active = false;
        self.restore_placement = None;
        if self.restore_fullscreen {
            style.set_full_screen(hwnd, true);
        }
        self.restore_fullscreen = false;
        self.state(hwnd)
    }

    fn restore_window_frame(&mut self, hwnd: HWND) -> Result<(), MiniPlayerBridgeError> {
        let restore_style = self.restore_style.ok_or_else(|| {
            MiniPlayerBridgeError::native("The normal window frame is unavailable.")
        })?;
        let restore_ex_style = self.restore_ex_style.ok_or_else(|| {
            MiniPlayerBridgeError::native("The normal extended window frame is unavailable.")
        })?;
        unsafe {
            SetWindowLongA(hwnd, GWL_STYLE, restore_style);
            SetWindowLongA(hwnd, GWL_EXSTYLE, restore_ex_style);
        }
        if unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            )
        } == 0
        {
            return Err(last_error("The normal window frame could not be restored."));
        }
        Ok(())
    }

    pub fn save_current(&self, hwnd: HWND, store: &MiniPlayerPlacementStore) {
        if !self.active {
            return;
        }
        match current_window_rect(hwnd).and_then(|placement| {
            store
                .save(placement)
                .map_err(|error| MiniPlayerBridgeError::native(error.to_string()))
        }) {
            Ok(()) => {}
            Err(error) => eprintln!("Cannot save mini-player placement: {}", error.message),
        }
    }
}

fn current_placement(hwnd: HWND) -> Result<WINDOWPLACEMENT, MiniPlayerBridgeError> {
    let mut placement: WINDOWPLACEMENT = unsafe { mem::zeroed() };
    placement.length = mem::size_of::<WINDOWPLACEMENT>() as u32;
    if unsafe { GetWindowPlacement(hwnd, &mut placement) } == 0 {
        return Err(last_error(
            "The normal window placement could not be captured.",
        ));
    }
    Ok(placement)
}

fn current_window_rect(hwnd: HWND) -> Result<MiniPlayerRect, MiniPlayerBridgeError> {
    let mut rect: RECT = unsafe { mem::zeroed() };
    if unsafe { winapi::um::winuser::GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err(last_error("The window bounds could not be read."));
    }
    MiniPlayerRect::from_rect(rect)
        .ok_or_else(|| MiniPlayerBridgeError::native("The window bounds are invalid."))
}

fn monitor_work_area(
    hwnd: HWND,
    preferred: Option<MiniPlayerRect>,
) -> Result<MiniPlayerRect, MiniPlayerBridgeError> {
    let monitor = if let Some(preferred) = preferred {
        unsafe { MonitorFromRect(&preferred.as_rect(), MONITOR_DEFAULTTONEAREST) }
    } else {
        unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) }
    };
    let mut info: MONITORINFO = unsafe { mem::zeroed() };
    info.cbSize = mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoA(monitor, &mut info) } == 0 {
        return Err(last_error("The monitor work area could not be read."));
    }
    MiniPlayerRect::from_rect(info.rcWork)
        .ok_or_else(|| MiniPlayerBridgeError::native("The monitor work area is invalid."))
}

fn default_placement(work_area: MiniPlayerRect) -> MiniPlayerRect {
    let width = (work_area.width * 32 / 100)
        .clamp(DEFAULT_MIN_WIDTH, DEFAULT_MAX_WIDTH)
        .min(work_area.width);
    let height = (width * VIDEO_ASPECT_HEIGHT / VIDEO_ASPECT_WIDTH)
        .max(MINI_PLAYER_MIN_HEIGHT)
        .min(work_area.height);
    MiniPlayerRect {
        x: work_area.x + work_area.width - width - DEFAULT_MARGIN,
        y: work_area.y + work_area.height - height - DEFAULT_MARGIN,
        width,
        height,
    }
}

fn apply_mini_player_frame(hwnd: HWND) -> Result<(), MiniPlayerBridgeError> {
    let style = unsafe { GetWindowLongA(hwnd, GWL_STYLE) };
    let ex_style = unsafe { GetWindowLongA(hwnd, GWL_EXSTYLE) };
    unsafe {
        // Keep WS_THICKFRAME so Windows retains its native resize behavior,
        // while removing every visible caption/edge style.
        SetWindowLongA(hwnd, GWL_STYLE, style & !(WS_CAPTION as i32));
        SetWindowLongA(
            hwnd,
            GWL_EXSTYLE,
            ex_style
                & !(WS_EX_DLGMODALFRAME as i32
                    | WS_EX_WINDOWEDGE as i32
                    | WS_EX_CLIENTEDGE as i32
                    | WS_EX_STATICEDGE as i32),
        );
    }
    if unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    } == 0
    {
        return Err(last_error("The mini-player frame could not be applied."));
    }
    Ok(())
}

fn persisted_placement_is_compact(candidate: MiniPlayerRect, work_area: MiniPlayerRect) -> bool {
    candidate.width.saturating_mul(100) <= work_area.width.saturating_mul(85)
        && candidate.height.saturating_mul(100) <= work_area.height.saturating_mul(85)
}

fn aspect_locked_placement(
    hwnd: HWND,
    candidate: MiniPlayerRect,
    work_area: MiniPlayerRect,
) -> MiniPlayerRect {
    let (frame_width, frame_height) = mini_player_frame_size(hwnd);
    let minimum_client_width = (MINI_PLAYER_MIN_WIDTH - frame_width).max(1);
    let maximum_client_width = (work_area.width - frame_width).max(1).min(mul_div_round(
        (work_area.height - frame_height).max(1),
        VIDEO_ASPECT_WIDTH,
        VIDEO_ASPECT_HEIGHT,
    ));
    let client_width = (candidate.width - frame_width)
        .max(minimum_client_width.min(maximum_client_width))
        .min(maximum_client_width);
    let client_height = mul_div_round(client_width, VIDEO_ASPECT_HEIGHT, VIDEO_ASPECT_WIDTH);
    MiniPlayerRect {
        width: client_width.saturating_add(frame_width),
        height: client_height.saturating_add(frame_height),
        ..candidate
    }
}

pub fn mini_player_min_outer_size(hwnd: HWND) -> (i32, i32) {
    let (frame_width, frame_height) = mini_player_frame_size(hwnd);
    let client_width = (MINI_PLAYER_MIN_WIDTH - frame_width).max(1);
    (
        client_width + frame_width,
        mul_div_round(client_width, VIDEO_ASPECT_HEIGHT, VIDEO_ASPECT_WIDTH) + frame_height,
    )
}

fn mini_player_frame_size(hwnd: HWND) -> (i32, i32) {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let style = unsafe { GetWindowLongA(hwnd, GWL_STYLE) } as u32;
    let ex_style = unsafe { GetWindowLongA(hwnd, GWL_EXSTYLE) } as u32;
    if unsafe { AdjustWindowRectEx(&mut rect, style, 0, ex_style) } == 0 {
        return (0, 0);
    }
    (rect.right - rect.left, rect.bottom - rect.top)
}

pub fn constrain_mini_player_sizing(hwnd: HWND, edge: usize, rect: &mut RECT) {
    let (frame_width, frame_height) = mini_player_frame_size(hwnd);
    constrain_sizing_rect(rect, edge, frame_width, frame_height);
}

fn constrain_sizing_rect(rect: &mut RECT, edge: usize, frame_width: i32, frame_height: i32) {
    let outer_width = (rect.right - rect.left).max(frame_width + 1);
    let outer_height = (rect.bottom - rect.top).max(frame_height + 1);
    let width_drives = !matches!(edge as u32, WMSZ_TOP | WMSZ_BOTTOM);
    if width_drives {
        let client_width = outer_width - frame_width;
        let target_height = mul_div_round(client_width, VIDEO_ASPECT_HEIGHT, VIDEO_ASPECT_WIDTH)
            .saturating_add(frame_height);
        match edge as u32 {
            WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT => rect.top = rect.bottom - target_height,
            WMSZ_BOTTOM | WMSZ_BOTTOMLEFT | WMSZ_BOTTOMRIGHT => {
                rect.bottom = rect.top + target_height
            }
            WMSZ_LEFT | WMSZ_RIGHT => {
                let delta = target_height - outer_height;
                rect.top -= delta / 2;
                rect.bottom += delta - delta / 2;
            }
            _ => {}
        }
    } else {
        let client_height = outer_height - frame_height;
        let target_width = mul_div_round(client_height, VIDEO_ASPECT_WIDTH, VIDEO_ASPECT_HEIGHT)
            .saturating_add(frame_width);
        let delta = target_width - outer_width;
        rect.left -= delta / 2;
        rect.right += delta - delta / 2;
    }
}

pub fn mini_player_hit_test(hwnd: HWND, cursor_x: i32, cursor_y: i32) -> Option<isize> {
    let mut rect: RECT = unsafe { mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    hit_test_rect(rect, cursor_x, cursor_y)
}

fn hit_test_rect(rect: RECT, cursor_x: i32, cursor_y: i32) -> Option<isize> {
    let left = cursor_x < rect.left + RESIZE_BORDER_PX;
    let right = cursor_x >= rect.right - RESIZE_BORDER_PX;
    let top = cursor_y < rect.top + RESIZE_BORDER_PX;
    let bottom = cursor_y >= rect.bottom - RESIZE_BORDER_PX;
    match (left, right, top, bottom) {
        (true, _, true, _) => Some(HTTOPLEFT),
        (_, true, true, _) => Some(HTTOPRIGHT),
        (true, _, _, true) => Some(HTBOTTOMLEFT),
        (_, true, _, true) => Some(HTBOTTOMRIGHT),
        (true, _, _, _) => Some(HTLEFT),
        (_, true, _, _) => Some(HTRIGHT),
        (_, _, true, _) => Some(HTTOP),
        (_, _, _, true) => Some(HTBOTTOM),
        _ => {
            let width = rect.right - rect.left;
            let in_center_drag_strip = cursor_x >= rect.left + width / 4
                && cursor_x < rect.right - width / 4
                && cursor_y < rect.top + DRAG_STRIP_HEIGHT_PX;
            in_center_drag_strip.then_some(HTCAPTION)
        }
    }
}

fn mul_div_round(value: i32, numerator: i32, denominator: i32) -> i32 {
    value
        .saturating_mul(numerator)
        .saturating_add(denominator / 2)
        / denominator
}

fn clamp_to_work_area(candidate: MiniPlayerRect, work_area: MiniPlayerRect) -> MiniPlayerRect {
    let width = candidate.width.min(work_area.width).max(1);
    let height = candidate.height.min(work_area.height).max(1);
    let max_x = work_area.x.saturating_add(work_area.width - width);
    let max_y = work_area.y.saturating_add(work_area.height - height);
    MiniPlayerRect {
        x: candidate.x.max(work_area.x).min(max_x),
        y: candidate.y.max(work_area.y).min(max_y),
        width,
        height,
    }
}

fn is_topmost(hwnd: HWND) -> bool {
    unsafe { GetWindowLongA(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST == WS_EX_TOPMOST }
}

fn last_error(message: &str) -> MiniPlayerBridgeError {
    MiniPlayerBridgeError::native(format!("{message} {}", io::Error::last_os_error()))
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_to_work_area, constrain_sizing_rect, default_placement, hit_test_rect, parse_request,
        response_event, MiniPlayerAction, MiniPlayerPlacementStore, MiniPlayerRect,
    };
    use serde_json::json;
    use tempfile::tempdir;
    use winapi::{
        shared::windef::RECT,
        um::winuser::{HTCAPTION, HTLEFT, HTTOP, WMSZ_BOTTOMRIGHT, WMSZ_RIGHT},
    };

    #[test]
    fn parses_only_fixed_get_and_set_operations() {
        assert_eq!(
            parse_request(7, Some(&json!({ "operation": "get", "payload": {} })))
                .unwrap()
                .action,
            MiniPlayerAction::Get
        );
        assert_eq!(
            parse_request(
                8,
                Some(&json!({ "operation": "set", "payload": { "enabled": true } }))
            )
            .unwrap()
            .action,
            MiniPlayerAction::Set(true)
        );
        assert!(parse_request(
            9,
            Some(&json!({ "operation": "set", "payload": { "enabled": true, "x": 1 } }))
        )
        .is_err());
        assert!(parse_request(10, Some(&json!({ "operation": "move", "payload": {} }))).is_err());
    }

    #[test]
    fn only_set_actions_trigger_window_notifications() {
        assert!(!MiniPlayerAction::Get.changes_window());
        assert!(MiniPlayerAction::Set(true).changes_window());
        assert!(MiniPlayerAction::Set(false).changes_window());
    }

    #[test]
    fn placement_round_trips_through_validated_storage() {
        let directory = tempdir().unwrap();
        let store = MiniPlayerPlacementStore::new(directory.path());
        let placement = MiniPlayerRect {
            x: -1200,
            y: 40,
            width: 640,
            height: 408,
        };
        store.save(placement).unwrap();
        assert_eq!(
            MiniPlayerPlacementStore::new(directory.path())
                .load()
                .unwrap(),
            Some(placement)
        );
        assert!(store
            .save(MiniPlayerRect {
                width: 100,
                ..placement
            })
            .is_err());
    }

    #[test]
    fn placement_is_visible_and_default_stays_near_bottom_right() {
        let work = MiniPlayerRect {
            x: 100,
            y: 50,
            width: 1200,
            height: 800,
        };
        let default = default_placement(work);
        assert!(default.x > work.x + work.width / 2);
        assert!(default.y > work.y + work.height / 2);
        let clamped = clamp_to_work_area(
            MiniPlayerRect {
                x: -50_000,
                y: 50_000,
                width: 2_000,
                height: 2_000,
            },
            work,
        );
        assert_eq!(clamped.x, work.x);
        assert_eq!(clamped.y + clamped.height, work.y + work.height);
        assert!(clamped.width <= work.width && clamped.height <= work.height);
    }

    #[test]
    fn sizing_keeps_the_client_area_at_sixteen_by_nine() {
        let mut right_edge = RECT {
            left: 100,
            top: 100,
            right: 740,
            bottom: 500,
        };
        constrain_sizing_rect(&mut right_edge, WMSZ_RIGHT as usize, 16, 16);
        let client_width = right_edge.right - right_edge.left - 16;
        let client_height = right_edge.bottom - right_edge.top - 16;
        assert!((client_width * 9 - client_height * 16).abs() <= 8);
        assert!((right_edge.top + right_edge.bottom - 600).abs() <= 1);

        let mut corner = RECT {
            left: 100,
            top: 100,
            right: 900,
            bottom: 650,
        };
        constrain_sizing_rect(&mut corner, WMSZ_BOTTOMRIGHT as usize, 0, 0);
        assert!(((corner.right - corner.left) * 9 - (corner.bottom - corner.top) * 16).abs() <= 8);
        assert_eq!(corner.top, 100);
    }

    #[test]
    fn frameless_hit_test_keeps_resize_edges_and_a_center_drag_strip() {
        let rect = RECT {
            left: -640,
            top: 40,
            right: 0,
            bottom: 400,
        };
        assert_eq!(hit_test_rect(rect, -639, 200), Some(HTLEFT));
        assert_eq!(hit_test_rect(rect, -320, 41), Some(HTTOP));
        assert_eq!(hit_test_rect(rect, -320, 55), Some(HTCAPTION));
        assert_eq!(hit_test_rect(rect, -100, 200), None);
    }

    #[test]
    fn response_keeps_request_id_and_namespace() {
        let event = response_event(
            42,
            Err(super::MiniPlayerBridgeError::new("invalid_request", "bad")),
        );
        assert_eq!(event[0], "jstremio-mini-player-response");
        assert_eq!(event[1]["requestId"], 42);
        assert_eq!(event[1]["ok"], false);
    }
}
