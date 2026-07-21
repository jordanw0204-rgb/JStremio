use crate::{
    extensions::{PluginDescriptor, PluginSettingsStore, PreferredAudioDevice},
    last_played::{LastPlayedInput, LastPlayedStore},
    reviews::{ReviewInput, ReviewStore},
    storage::StorageError,
    themes::{ThemeSettings, ThemeStore},
    timestamp_notes::{CreateNoteInput, TimestampNoteStore, UpdateNoteInput},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const REVIEWS_METHOD: &str = "jstremio-reviews";
pub const TIMESTAMP_NOTES_METHOD: &str = "jstremio-timestamp-notes";
pub const PLUGINS_METHOD: &str = "jstremio-plugins";
pub const LAST_PLAYED_METHOD: &str = "jstremio-last-played";
pub const THEMES_METHOD: &str = "jstremio-themes";

pub struct NativeBridge {
    reviews: ReviewStore,
    notes: TimestampNoteStore,
    data_directory: PathBuf,
    plugin_directory: PathBuf,
    plugins: Mutex<Vec<PluginDescriptor>>,
    plugin_settings: PluginSettingsStore,
    last_played: LastPlayedStore,
    themes: ThemeStore,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeRequest {
    operation: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct IdPayload {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaKeyPayload {
    media_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThumbnailPayload {
    thumbnail_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetPluginEnabledPayload {
    id: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetPluginHotkeyPayload {
    id: String,
    hotkey: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetBegoneMousePayload {
    idle_ms: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetQuickSeekPayload {
    backward_seconds: f64,
    forward_seconds: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetReviewSettingsPayload {
    auto_open_at_end: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetEasySoundOutputPayload {
    preferred_device: Option<PreferredAudioDevice>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetQolThingsPayload {
    remember_volume: bool,
    saved_volume: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetNoSpoilersPayload {
    blur_summary: bool,
    blur_artwork: bool,
    title_mask_percent: u8,
    guard_seeks: bool,
    max_skip_minutes: f64,
}

const MAX_THUMBNAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: String,
    message: String,
    recoverable: bool,
}

#[derive(Debug)]
pub struct BridgeResponse {
    event: String,
    payload: Value,
}

impl BridgeResponse {
    pub fn into_event(self) -> Value {
        json!([self.event, self.payload])
    }
}

impl NativeBridge {
    #[cfg(test)]
    pub fn new(data_directory: &Path) -> Self {
        Self::new_with_plugins(data_directory, &data_directory.join("plugins"), Vec::new())
    }

    pub fn new_with_plugins(
        data_directory: &Path,
        plugin_directory: &Path,
        plugins: Vec<PluginDescriptor>,
    ) -> Self {
        Self {
            reviews: ReviewStore::new(data_directory),
            notes: TimestampNoteStore::new(data_directory),
            data_directory: data_directory.to_path_buf(),
            plugin_directory: plugin_directory.to_path_buf(),
            plugins: Mutex::new(plugins),
            plugin_settings: PluginSettingsStore::new(data_directory),
            last_played: LastPlayedStore::new(data_directory),
            themes: ThemeStore::new(data_directory),
        }
    }

    pub fn supports(method: &str) -> bool {
        matches!(
            method,
            REVIEWS_METHOD
                | TIMESTAMP_NOTES_METHOD
                | PLUGINS_METHOD
                | LAST_PLAYED_METHOD
                | THEMES_METHOD
        )
    }

    pub fn error(method: &str, request_id: u64, code: &str, message: &str) -> BridgeResponse {
        response(
            method,
            request_id,
            Err(ErrorPayload {
                code: code.into(),
                message: message.into(),
                recoverable: true,
            }),
        )
    }

    pub fn handle(&self, method: &str, request_id: u64, params: Option<&Value>) -> BridgeResponse {
        let request = params
            .cloned()
            .ok_or_else(|| validation_error("request payload is required"))
            .and_then(parse_value::<BridgeRequest>);
        let result = match request {
            Ok(request) if method == REVIEWS_METHOD => self.handle_reviews(request),
            Ok(request) if method == TIMESTAMP_NOTES_METHOD => self.handle_notes(request),
            Ok(request) if method == PLUGINS_METHOD => self.handle_plugins(request),
            Ok(request) if method == LAST_PLAYED_METHOD => self.handle_last_played(request),
            Ok(request) if method == THEMES_METHOD => self.handle_themes(request),
            Ok(_) => Err(validation_error("unsupported bridge namespace")),
            Err(error) => Err(error),
        };
        response(method, request_id, result)
    }

    fn handle_reviews(&self, request: BridgeRequest) -> Result<Value, ErrorPayload> {
        match request.operation.as_str() {
            "health" => self
                .reviews
                .health()
                .map(|revision| json!({ "status": "ok", "revision": revision }))
                .map_err(storage_error),
            "list" => self
                .reviews
                .list()
                .map(|mut reviews| {
                    reviews.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
                    json!(reviews)
                })
                .map_err(storage_error),
            "get" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                self.reviews
                    .get(&payload.id)
                    .map(|review| json!(review))
                    .map_err(storage_error)
            }
            "upsert" => {
                let input: ReviewInput = parse_value(request.payload)?;
                self.reviews
                    .upsert(input)
                    .map(|review| json!(review))
                    .map_err(storage_error)
            }
            "delete" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                self.reviews
                    .delete(&payload.id)
                    .map(|deleted| json!({ "deleted": deleted }))
                    .map_err(storage_error)
            }
            "openDataFolder" => self.open_data_folder(),
            _ => Err(operation_error()),
        }
    }

    fn handle_notes(&self, request: BridgeRequest) -> Result<Value, ErrorPayload> {
        match request.operation.as_str() {
            "health" => self
                .notes
                .health()
                .map(|revision| json!({ "status": "ok", "revision": revision }))
                .map_err(storage_error),
            "listAll" => self
                .notes
                .list_all()
                .map(|mut notes| {
                    notes.sort_by(|left, right| {
                        left.media_key
                            .cmp(&right.media_key)
                            .then_with(|| left.timestamp_ms.cmp(&right.timestamp_ms))
                    });
                    json!(notes)
                })
                .map_err(storage_error),
            "listForMedia" => {
                let payload: MediaKeyPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.media_key)?;
                self.notes
                    .list_for_media(&payload.media_key)
                    .map(|notes| json!(notes))
                    .map_err(storage_error)
            }
            "get" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                self.notes
                    .get(&payload.id)
                    .map(|note| json!(note))
                    .map_err(storage_error)
            }
            "create" => {
                let input: CreateNoteInput = parse_value(request.payload)?;
                self.validate_thumbnail_reference(input.thumbnail_id.as_deref())?;
                self.notes
                    .create(input)
                    .map(|note| json!(note))
                    .map_err(storage_error)
            }
            "update" => {
                let input: UpdateNoteInput = parse_value(request.payload)?;
                self.validate_thumbnail_reference(
                    input
                        .thumbnail_id
                        .as_ref()
                        .and_then(|value| value.as_deref()),
                )?;
                let previous_thumbnail = self
                    .notes
                    .get(&input.id)
                    .map_err(storage_error)?
                    .and_then(|note| note.thumbnail_id);
                let note = self.notes.update(input).map_err(storage_error)?;
                if previous_thumbnail != note.thumbnail_id {
                    if let Some(id) = previous_thumbnail {
                        let _ = fs::remove_file(self.thumbnail_path(&id));
                    }
                }
                Ok(json!(note))
            }
            "delete" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                let thumbnail_id = self
                    .notes
                    .get(&payload.id)
                    .map_err(storage_error)?
                    .and_then(|note| note.thumbnail_id);
                let result = self.notes.delete(&payload.id).map_err(storage_error)?;
                if result {
                    if let Some(id) = thumbnail_id {
                        let _ = fs::remove_file(self.thumbnail_path(&id));
                    }
                }
                Ok(json!({ "deleted": result }))
            }
            "prepareFrameCapture" => self.prepare_frame_capture(),
            "completeFrameCapture" => {
                let payload: ThumbnailPayload = parse_value(request.payload)?;
                self.complete_frame_capture(&payload.thumbnail_id)
            }
            "getThumbnail" => {
                let payload: ThumbnailPayload = parse_value(request.payload)?;
                self.get_thumbnail(&payload.thumbnail_id)
            }
            "openDataFolder" => self.open_data_folder(),
            _ => Err(operation_error()),
        }
    }

    fn handle_plugins(&self, request: BridgeRequest) -> Result<Value, ErrorPayload> {
        match request.operation.as_str() {
            "list" => self
                .plugins
                .lock()
                .map(|plugins| json!(&*plugins))
                .map_err(|_| validation_error("plugin state is unavailable")),
            "setEnabled" => {
                let payload: SetPluginEnabledPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                let mut plugins = self
                    .plugins
                    .lock()
                    .map_err(|_| validation_error("plugin state is unavailable"))?;
                let plugin = plugins
                    .iter_mut()
                    .find(|plugin| plugin.id == payload.id)
                    .ok_or_else(|| validation_error("the plugin was not found"))?;
                if plugin.core || plugin.error.is_some() {
                    return Err(validation_error("this plugin cannot be toggled"));
                }
                self.plugin_settings
                    .set_enabled(&payload.id, payload.enabled)
                    .map_err(storage_error)?;
                plugin.enabled = payload.enabled;
                Ok(json!({ "enabled": payload.enabled, "restartRequired": true }))
            }
            "getHotkeys" => self
                .plugin_settings
                .hotkeys()
                .map(|hotkeys| json!(hotkeys))
                .map_err(storage_error),
            "setHotkey" => {
                let payload: SetPluginHotkeyPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                let configurable = self
                    .plugins
                    .lock()
                    .map_err(|_| validation_error("plugin state is unavailable"))?
                    .iter()
                    .any(|plugin| {
                        plugin.id == payload.id
                            && plugin.built_in
                            && !plugin.core
                            && plugin.error.is_none()
                    });
                if !configurable {
                    return Err(validation_error(
                        "this plugin does not expose configurable hotkeys",
                    ));
                }
                self.plugin_settings
                    .set_hotkey(&payload.id, payload.hotkey.clone())
                    .map_err(storage_error)?;
                Ok(json!({
                    "id": payload.id,
                    "hotkey": payload.hotkey,
                    "restartRequired": false
                }))
            }
            "getReviewSettings" => self
                .plugin_settings
                .review_auto_open_at_end()
                .map(|auto_open_at_end| json!({ "autoOpenAtEnd": auto_open_at_end }))
                .map_err(storage_error),
            "setReviewSettings" => {
                let payload: SetReviewSettingsPayload = parse_value(request.payload)?;
                self.plugin_settings
                    .set_review_auto_open_at_end(payload.auto_open_at_end)
                    .map_err(storage_error)?;
                Ok(json!({
                    "autoOpenAtEnd": payload.auto_open_at_end,
                    "restartRequired": false
                }))
            }
            "getBegoneMouse" => self
                .plugin_settings
                .begone_mouse_idle_ms()
                .map(|idle_ms| json!({ "idleMs": idle_ms }))
                .map_err(storage_error),
            "setBegoneMouse" => {
                let payload: SetBegoneMousePayload = parse_value(request.payload)?;
                self.plugin_settings
                    .set_begone_mouse_idle_ms(payload.idle_ms)
                    .map_err(storage_error)?;
                Ok(json!({
                    "idleMs": payload.idle_ms,
                    "restartRequired": false
                }))
            }
            "getQuickSeek" => self
                .plugin_settings
                .quick_seek_seconds()
                .map(|(backward_seconds, forward_seconds)| {
                    json!({
                        "backwardSeconds": backward_seconds,
                        "forwardSeconds": forward_seconds
                    })
                })
                .map_err(storage_error),
            "setQuickSeek" => {
                let payload: SetQuickSeekPayload = parse_value(request.payload)?;
                self.plugin_settings
                    .set_quick_seek_seconds(payload.backward_seconds, payload.forward_seconds)
                    .map_err(storage_error)?;
                Ok(json!({
                    "backwardSeconds": payload.backward_seconds,
                    "forwardSeconds": payload.forward_seconds,
                    "restartRequired": false
                }))
            }
            "getEasySoundOutput" => self
                .plugin_settings
                .preferred_audio_device()
                .map(|preferred_device| json!({ "preferredDevice": preferred_device }))
                .map_err(storage_error),
            "setEasySoundOutput" => {
                let payload: SetEasySoundOutputPayload = parse_value(request.payload)?;
                self.plugin_settings
                    .set_preferred_audio_device(payload.preferred_device.clone())
                    .map_err(storage_error)?;
                Ok(json!({
                    "preferredDevice": payload.preferred_device,
                    "restartRequired": false
                }))
            }
            "getQolThings" => self
                .plugin_settings
                .qol_settings()
                .map(|(remember_volume, saved_volume)| {
                    json!({
                        "rememberVolume": remember_volume,
                        "savedVolume": saved_volume
                    })
                })
                .map_err(storage_error),
            "setQolThings" => {
                let payload: SetQolThingsPayload = parse_value(request.payload)?;
                self.plugin_settings
                    .set_qol_settings(payload.remember_volume, payload.saved_volume)
                    .map_err(storage_error)?;
                Ok(json!({
                    "rememberVolume": payload.remember_volume,
                    "savedVolume": payload.saved_volume,
                    "restartRequired": false
                }))
            }
            "getNoSpoilers" => self
                .plugin_settings
                .no_spoilers_settings()
                .map(
                    |(
                        blur_summary,
                        blur_artwork,
                        title_mask_percent,
                        guard_seeks,
                        max_skip_minutes,
                    )| {
                        json!({
                            "blurSummary": blur_summary,
                            "blurArtwork": blur_artwork,
                            "titleMaskPercent": title_mask_percent,
                            "guardSeeks": guard_seeks,
                            "maxSkipMinutes": max_skip_minutes
                        })
                    },
                )
                .map_err(storage_error),
            "setNoSpoilers" => {
                let payload: SetNoSpoilersPayload = parse_value(request.payload)?;
                self.plugin_settings
                    .set_no_spoilers_settings(
                        payload.blur_summary,
                        payload.blur_artwork,
                        payload.title_mask_percent,
                        payload.guard_seeks,
                        payload.max_skip_minutes,
                    )
                    .map_err(storage_error)?;
                Ok(json!({
                    "blurSummary": payload.blur_summary,
                    "blurArtwork": payload.blur_artwork,
                    "titleMaskPercent": payload.title_mask_percent,
                    "guardSeeks": payload.guard_seeks,
                    "maxSkipMinutes": payload.max_skip_minutes,
                    "restartRequired": false
                }))
            }
            "openPluginsFolder" => {
                fs::create_dir_all(&self.plugin_directory)
                    .map_err(|_| plugin_error("The plugins folder could not be created."))?;
                open::that(&self.plugin_directory)
                    .map_err(|_| plugin_error("The plugins folder could not be opened."))?;
                Ok(json!({ "opened": true }))
            }
            "restart" => {
                schedule_restart()?;
                Ok(json!({ "restarting": true }))
            }
            _ => Err(operation_error()),
        }
    }

    fn handle_last_played(&self, request: BridgeRequest) -> Result<Value, ErrorPayload> {
        match request.operation.as_str() {
            "list" => self
                .last_played
                .list()
                .map(|mut entries| {
                    entries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
                    json!(entries)
                })
                .map_err(storage_error),
            "get" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                self.last_played
                    .get(&payload.id)
                    .map(|entry| json!(entry))
                    .map_err(storage_error)
            }
            "upsert" => {
                let input: LastPlayedInput = parse_value(request.payload)?;
                self.last_played
                    .upsert(input)
                    .map(|entry| json!(entry))
                    .map_err(storage_error)
            }
            "openDataFolder" => self.open_data_folder(),
            _ => Err(operation_error()),
        }
    }

    fn handle_themes(&self, request: BridgeRequest) -> Result<Value, ErrorPayload> {
        match request.operation.as_str() {
            "get" => self
                .themes
                .get()
                .map(|theme| json!(theme))
                .map_err(storage_error),
            "set" => {
                let settings: ThemeSettings = parse_value(request.payload)?;
                self.themes
                    .set(settings)
                    .map(|theme| json!(theme))
                    .map_err(storage_error)
            }
            "reset" => self
                .themes
                .reset()
                .map(|theme| json!(theme))
                .map_err(storage_error),
            "getPresets" => self
                .themes
                .presets()
                .map(|presets| json!(presets))
                .map_err(storage_error),
            "createPreset" => {
                let settings: ThemeSettings = parse_value(request.payload)?;
                self.themes
                    .create_preset(settings)
                    .map(|preset| json!(preset))
                    .map_err(storage_error)
            }
            "deletePreset" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                self.themes
                    .delete_preset(&payload.id)
                    .map(|deleted| json!({ "deleted": deleted }))
                    .map_err(storage_error)
            }
            _ => Err(operation_error()),
        }
    }

    fn open_data_folder(&self) -> Result<Value, ErrorPayload> {
        fs::create_dir_all(&self.data_directory).map_err(|_| ErrorPayload {
            code: "storage_io".into(),
            message: "The local data folder could not be created.".into(),
            recoverable: true,
        })?;
        open::that(&self.data_directory).map_err(|_| ErrorPayload {
            code: "open_folder_failed".into(),
            message: "The local data folder could not be opened.".into(),
            recoverable: true,
        })?;
        Ok(json!({ "opened": true }))
    }

    fn thumbnail_directory(&self) -> PathBuf {
        self.data_directory.join("timestamp-thumbnails")
    }

    fn thumbnail_path(&self, id: &str) -> PathBuf {
        self.thumbnail_directory().join(format!("{id}.jpg"))
    }

    fn validate_thumbnail_id(&self, id: &str) -> Result<(), ErrorPayload> {
        uuid::Uuid::parse_str(id)
            .map(|_| ())
            .map_err(|_| validation_error("the thumbnail ID is invalid"))
    }

    fn validate_thumbnail_reference(&self, id: Option<&str>) -> Result<(), ErrorPayload> {
        let Some(id) = id else {
            return Ok(());
        };
        self.validate_thumbnail_id(id)?;
        self.validate_thumbnail_file(&self.thumbnail_path(id))
            .map(|_| ())
    }

    fn prepare_frame_capture(&self) -> Result<Value, ErrorPayload> {
        let directory = self.thumbnail_directory();
        fs::create_dir_all(&directory)
            .map_err(|_| thumbnail_error("The thumbnail folder could not be created."))?;
        let id = uuid::Uuid::new_v4().to_string();
        let path = self.thumbnail_path(&id);
        Ok(json!({ "thumbnailId": id, "path": path.to_string_lossy() }))
    }

    fn complete_frame_capture(&self, id: &str) -> Result<Value, ErrorPayload> {
        self.validate_thumbnail_id(id)?;
        self.validate_thumbnail_file(&self.thumbnail_path(id))?;
        Ok(json!({ "thumbnailId": id, "ready": true }))
    }

    fn get_thumbnail(&self, id: &str) -> Result<Value, ErrorPayload> {
        self.validate_thumbnail_id(id)?;
        let bytes = self.validate_thumbnail_file(&self.thumbnail_path(id))?;
        Ok(json!({ "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)) }))
    }

    fn validate_thumbnail_file(&self, path: &Path) -> Result<Vec<u8>, ErrorPayload> {
        let metadata =
            fs::metadata(path).map_err(|_| thumbnail_error("The frame thumbnail is not ready."))?;
        if metadata.len() == 0 || metadata.len() > MAX_THUMBNAIL_BYTES {
            return Err(thumbnail_error("The frame thumbnail has an invalid size."));
        }
        let bytes = fs::read(path)
            .map_err(|_| thumbnail_error("The frame thumbnail could not be read."))?;
        if !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(thumbnail_error(
                "The captured frame is not a valid JPEG image.",
            ));
        }
        Ok(bytes)
    }
}

#[cfg(not(test))]
fn schedule_restart() -> Result<(), ErrorPayload> {
    use std::{process::Command, thread, time::Duration};
    let executable = std::env::current_exe()
        .map_err(|_| plugin_error("JStremio could not locate its executable."))?;
    Command::new(executable)
        .arg("--restart-after-pid")
        .arg(std::process::id().to_string())
        .spawn()
        .map_err(|_| plugin_error("JStremio could not start the restart helper."))?;
    thread::spawn(|| {
        thread::sleep(Duration::from_millis(350));
        std::process::exit(0);
    });
    Ok(())
}

#[cfg(test)]
fn schedule_restart() -> Result<(), ErrorPayload> {
    Ok(())
}

fn thumbnail_error(message: &str) -> ErrorPayload {
    ErrorPayload {
        code: "thumbnail_unavailable".into(),
        message: message.into(),
        recoverable: true,
    }
}

fn plugin_error(message: &str) -> ErrorPayload {
    ErrorPayload {
        code: "plugin_io".into(),
        message: message.into(),
        recoverable: true,
    }
}

fn parse_value<T: DeserializeOwned>(value: Value) -> Result<T, ErrorPayload> {
    serde_json::from_value(value).map_err(|_| validation_error("the request payload is invalid"))
}

fn validate_lookup_id(value: &str) -> Result<(), ErrorPayload> {
    if value.trim().is_empty() || value.chars().count() > 512 {
        return Err(validation_error("the requested ID is invalid"));
    }
    Ok(())
}

fn storage_error(error: StorageError) -> ErrorPayload {
    let message = match &error {
        StorageError::Malformed => {
            "The local data file is malformed. It was preserved; open the data folder to recover it."
                .to_string()
        }
        StorageError::UnsupportedSchema { .. } => {
            "The local data file uses an unsupported schema and was preserved.".to_string()
        }
        StorageError::Invalid { .. } => error.to_string(),
        StorageError::TooLarge { .. } => {
            "The local data file is larger than the supported limit.".to_string()
        }
        _ => "The local data operation failed.".to_string(),
    };
    ErrorPayload {
        code: error.code().into(),
        message,
        recoverable: true,
    }
}

fn validation_error(message: &str) -> ErrorPayload {
    ErrorPayload {
        code: "invalid_request".into(),
        message: message.into(),
        recoverable: true,
    }
}

fn operation_error() -> ErrorPayload {
    ErrorPayload {
        code: "unknown_operation".into(),
        message: "The requested operation is not supported.".into(),
        recoverable: true,
    }
}

fn response(method: &str, request_id: u64, result: Result<Value, ErrorPayload>) -> BridgeResponse {
    let event = format!("{method}-response");
    let payload = match result {
        Ok(result) => json!({ "requestId": request_id, "ok": true, "result": result }),
        Err(error) => json!({ "requestId": request_id, "ok": false, "error": error }),
    };
    BridgeResponse { event, payload }
}

#[cfg(test)]
mod tests {
    use super::{
        NativeBridge, LAST_PLAYED_METHOD, PLUGINS_METHOD, REVIEWS_METHOD, THEMES_METHOD,
        TIMESTAMP_NOTES_METHOD,
    };
    use crate::extensions::{PluginDescriptor, PluginSettingsStore};
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn rejects_unknown_operations_without_exposing_generic_io() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let response = bridge
            .handle(
                REVIEWS_METHOD,
                41,
                Some(&json!({ "operation": "readFile", "payload": { "path": "C:\\" } })),
            )
            .into_event();
        assert_eq!(response[1]["requestId"], 41);
        assert_eq!(response[1]["ok"], false);
        assert_eq!(response[1]["error"]["code"], "unknown_operation");
    }

    #[test]
    fn namespaces_are_fixed() {
        assert!(NativeBridge::supports(REVIEWS_METHOD));
        assert!(NativeBridge::supports(TIMESTAMP_NOTES_METHOD));
        assert!(NativeBridge::supports(PLUGINS_METHOD));
        assert!(NativeBridge::supports(LAST_PLAYED_METHOD));
        assert!(NativeBridge::supports(THEMES_METHOD));
        assert!(!NativeBridge::supports("jstremio-filesystem"));
    }

    #[test]
    fn theme_bridge_accepts_only_fixed_validated_palette_operations() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let custom = json!({
            "backgroundStart":"#001122",
            "backgroundEnd":"#223344",
            "accent":"#55AAFF",
            "surface":"#101820",
            "text":"#F4F8FF",
            "gradientAngle":125
        });
        let saved = bridge
            .handle(
                THEMES_METHOD,
                70,
                Some(&json!({"operation":"set","payload":custom})),
            )
            .into_event();
        assert_eq!(saved[1]["ok"], true);
        assert_eq!(saved[1]["result"]["accent"], "#55AAFF");
        let loaded = bridge
            .handle(
                THEMES_METHOD,
                71,
                Some(&json!({"operation":"get","payload":{}})),
            )
            .into_event();
        assert_eq!(loaded[1]["result"]["gradientAngle"], 125);

        let created_preset = bridge
            .handle(
                THEMES_METHOD,
                74,
                Some(&json!({"operation":"createPreset","payload":custom})),
            )
            .into_event();
        assert_eq!(created_preset[1]["ok"], true);
        assert_eq!(created_preset[1]["result"]["name"], "Custom 1");
        let preset_id = created_preset[1]["result"]["id"].as_str().unwrap();
        let presets = bridge
            .handle(
                THEMES_METHOD,
                75,
                Some(&json!({"operation":"getPresets","payload":{}})),
            )
            .into_event();
        assert_eq!(presets[1]["result"].as_array().unwrap().len(), 1);
        let deleted_preset = bridge
            .handle(
                THEMES_METHOD,
                76,
                Some(&json!({"operation":"deletePreset","payload":{"id":preset_id}})),
            )
            .into_event();
        assert_eq!(deleted_preset[1]["result"]["deleted"], true);

        let rejected = bridge
            .handle(
                THEMES_METHOD,
                72,
                Some(&json!({
                    "operation":"set",
                    "payload":{
                        "backgroundStart":"red","backgroundEnd":"#223344","accent":"#55AAFF",
                        "surface":"#101820","text":"#F4F8FF","gradientAngle":361
                    }
                })),
            )
            .into_event();
        assert_eq!(rejected[1]["ok"], false);
        assert_eq!(rejected[1]["error"]["code"], "validation_failed");
        let still_loaded = bridge
            .handle(
                THEMES_METHOD,
                73,
                Some(&json!({"operation":"get","payload":{}})),
            )
            .into_event();
        assert_eq!(still_loaded[1]["result"]["backgroundStart"], "#001122");
    }

    #[test]
    fn last_played_bridge_persists_only_validated_routes() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let payload = json!({
            "videoId":"tt1:1:1","metaId":"tt1","mediaType":"series","name":"Series","title":"Pilot",
            "season":1,"episode":1,"poster":null,"playerDeepLink":"#/player/stream/exact","streamKey":"hash:abc:0",
            "addonName":"Torrentio","streamName":"1080p","streamDescription":"seeded","positionMs":42000
        });
        let saved = bridge
            .handle(
                LAST_PLAYED_METHOD,
                61,
                Some(&json!({"operation":"upsert","payload":payload})),
            )
            .into_event();
        assert_eq!(saved[1]["ok"], true);
        let listed = bridge
            .handle(
                LAST_PLAYED_METHOD,
                62,
                Some(&json!({"operation":"list","payload":{}})),
            )
            .into_event();
        assert_eq!(
            listed[1]["result"][0]["playerDeepLink"],
            "#/player/stream/exact"
        );
    }

    #[test]
    fn plugin_toggles_are_fixed_persisted_operations() {
        let directory = tempdir().unwrap();
        let plugin_directory = directory.path().join("plugins");
        let bridge = NativeBridge::new_with_plugins(
            directory.path(),
            &plugin_directory,
            vec![PluginDescriptor {
                id: "reviews".into(),
                name: "Local Reviews".into(),
                version: "1.0.0".into(),
                description: "Private reviews".into(),
                author: "JStremio".into(),
                built_in: true,
                enabled: true,
                core: false,
                error: None,
            }],
        );
        let response = bridge
            .handle(
                PLUGINS_METHOD,
                50,
                Some(&json!({
                    "operation": "setEnabled",
                    "payload": { "id": "reviews", "enabled": false }
                })),
            )
            .into_event();
        assert_eq!(response[1]["result"]["restartRequired"], true);
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .overrides()
                .unwrap()
                .get("reviews"),
            Some(&false)
        );
    }

    #[test]
    fn plugin_hotkeys_are_fixed_validated_and_immediately_persisted() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new_with_plugins(
            directory.path(),
            &directory.path().join("plugins"),
            vec![PluginDescriptor {
                id: "reviews".into(),
                name: "Local Reviews".into(),
                version: "1.0.0".into(),
                description: "Private reviews".into(),
                author: "JStremio".into(),
                built_in: true,
                enabled: true,
                core: false,
                error: None,
            }],
        );
        let saved = bridge
            .handle(
                PLUGINS_METHOD,
                51,
                Some(&json!({
                    "operation": "setHotkey",
                    "payload": { "id": "reviews", "hotkey": "Ctrl+Shift+KeyR" }
                })),
            )
            .into_event();
        assert_eq!(saved[1]["result"]["restartRequired"], false);
        let listed = bridge
            .handle(
                PLUGINS_METHOD,
                52,
                Some(&json!({"operation": "getHotkeys", "payload": {}})),
            )
            .into_event();
        assert_eq!(listed[1]["result"]["reviews"], "Ctrl+Shift+KeyR");

        let rejected = bridge
            .handle(
                PLUGINS_METHOD,
                53,
                Some(&json!({
                    "operation": "setHotkey",
                    "payload": { "id": "reviews", "hotkey": "ArrowLeft" }
                })),
            )
            .into_event();
        assert_eq!(rejected[1]["ok"], false);
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .hotkeys()
                .unwrap()
                .get("reviews")
                .map(String::as_str),
            Some("Ctrl+Shift+KeyR")
        );
    }

    #[test]
    fn review_end_prompt_is_fixed_and_immediately_persisted() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let defaults = bridge
            .handle(
                PLUGINS_METHOD,
                54,
                Some(&json!({"operation": "getReviewSettings", "payload": {}})),
            )
            .into_event();
        assert_eq!(defaults[1]["result"]["autoOpenAtEnd"], true);

        let saved = bridge
            .handle(
                PLUGINS_METHOD,
                55,
                Some(&json!({
                    "operation": "setReviewSettings",
                    "payload": { "autoOpenAtEnd": false }
                })),
            )
            .into_event();
        assert_eq!(saved[1]["result"]["autoOpenAtEnd"], false);
        assert_eq!(saved[1]["result"]["restartRequired"], false);
        assert!(!PluginSettingsStore::new(directory.path())
            .review_auto_open_at_end()
            .unwrap());
    }

    #[test]
    fn begone_mouse_delay_is_fixed_validated_and_immediately_persisted() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let saved = bridge
            .handle(
                PLUGINS_METHOD,
                54,
                Some(&json!({
                    "operation": "setBegoneMouse",
                    "payload": { "idleMs": 0.05 }
                })),
            )
            .into_event();
        assert_eq!(saved[1]["ok"], true);
        assert_eq!(saved[1]["result"]["idleMs"], 0.05);
        assert_eq!(saved[1]["result"]["restartRequired"], false);
        let loaded = bridge
            .handle(
                PLUGINS_METHOD,
                55,
                Some(&json!({"operation": "getBegoneMouse", "payload": {}})),
            )
            .into_event();
        assert_eq!(loaded[1]["result"]["idleMs"], 0.05);

        let rejected = bridge
            .handle(
                PLUGINS_METHOD,
                56,
                Some(&json!({
                    "operation": "setBegoneMouse",
                    "payload": { "idleMs": 600000.01 }
                })),
            )
            .into_event();
        assert_eq!(rejected[1]["ok"], false);
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .begone_mouse_idle_ms()
                .unwrap(),
            0.05
        );
    }

    #[test]
    fn quick_seek_durations_are_fixed_validated_and_immediately_persisted() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let saved = bridge
            .handle(
                PLUGINS_METHOD,
                57,
                Some(&json!({
                    "operation": "setQuickSeek",
                    "payload": { "backwardSeconds": 7.5, "forwardSeconds": 12.25 }
                })),
            )
            .into_event();
        assert_eq!(saved[1]["ok"], true);
        assert_eq!(saved[1]["result"]["backwardSeconds"], 7.5);
        assert_eq!(saved[1]["result"]["forwardSeconds"], 12.25);
        assert_eq!(saved[1]["result"]["restartRequired"], false);

        let loaded = bridge
            .handle(
                PLUGINS_METHOD,
                58,
                Some(&json!({"operation": "getQuickSeek", "payload": {}})),
            )
            .into_event();
        assert_eq!(loaded[1]["result"]["backwardSeconds"], 7.5);
        assert_eq!(loaded[1]["result"]["forwardSeconds"], 12.25);

        let rejected = bridge
            .handle(
                PLUGINS_METHOD,
                59,
                Some(&json!({
                    "operation": "setQuickSeek",
                    "payload": { "backwardSeconds": 0, "forwardSeconds": 5 }
                })),
            )
            .into_event();
        assert_eq!(rejected[1]["ok"], false);
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .quick_seek_seconds()
                .unwrap(),
            (7.5, 12.25)
        );
    }

    #[test]
    fn new_player_plugin_settings_are_fixed_and_immediately_persisted() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());

        let defaults = bridge
            .handle(
                PLUGINS_METHOD,
                60,
                Some(&json!({"operation": "getEasySoundOutput", "payload": {}})),
            )
            .into_event();
        assert_eq!(defaults[1]["result"]["preferredDevice"], json!(null));

        let sound = bridge
            .handle(
                PLUGINS_METHOD,
                61,
                Some(&json!({
                    "operation": "setEasySoundOutput",
                    "payload": {
                        "preferredDevice": {
                            "name": "wasapi/{device-id}",
                            "description": "Desk speakers"
                        }
                    }
                })),
            )
            .into_event();
        assert_eq!(
            sound[1]["result"]["preferredDevice"]["name"],
            "wasapi/{device-id}"
        );
        assert_eq!(sound[1]["result"]["restartRequired"], false);

        let qol = bridge
            .handle(
                PLUGINS_METHOD,
                62,
                Some(&json!({
                    "operation": "setQolThings",
                    "payload": { "rememberVolume": true, "savedVolume": 37.5 }
                })),
            )
            .into_event();
        assert_eq!(qol[1]["result"]["savedVolume"], 37.5);

        let spoilers = bridge
            .handle(
                PLUGINS_METHOD,
                63,
                Some(&json!({
                    "operation": "setNoSpoilers",
                    "payload": {
                        "blurSummary": false,
                        "blurArtwork": true,
                        "titleMaskPercent": 80,
                        "guardSeeks": true,
                        "maxSkipMinutes": 3.5
                    }
                })),
            )
            .into_event();
        assert_eq!(spoilers[1]["result"]["blurSummary"], false);
        assert_eq!(spoilers[1]["result"]["titleMaskPercent"], 80);
        assert_eq!(spoilers[1]["result"]["maxSkipMinutes"], 3.5);

        let store = PluginSettingsStore::new(directory.path());
        assert_eq!(
            store.preferred_audio_device().unwrap().unwrap().description,
            "Desk speakers"
        );
        assert_eq!(store.qol_settings().unwrap(), (true, Some(37.5)));
        assert_eq!(
            store.no_spoilers_settings().unwrap(),
            (false, true, 80, true, 3.5)
        );
    }

    #[test]
    fn frame_capture_uses_generated_local_jpeg_slots() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let prepared = bridge
            .handle(
                TIMESTAMP_NOTES_METHOD,
                1,
                Some(&json!({ "operation": "prepareFrameCapture", "payload": {} })),
            )
            .into_event();
        let id = prepared[1]["result"]["thumbnailId"].as_str().unwrap();
        let path = prepared[1]["result"]["path"].as_str().unwrap();
        assert!(path.starts_with(directory.path().to_string_lossy().as_ref()));
        std::fs::write(path, [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();

        let completed = bridge
            .handle(
                TIMESTAMP_NOTES_METHOD,
                2,
                Some(&json!({
                    "operation": "completeFrameCapture",
                    "payload": { "thumbnailId": id }
                })),
            )
            .into_event();
        assert_eq!(completed[1]["ok"], true);

        let thumbnail = bridge
            .handle(
                TIMESTAMP_NOTES_METHOD,
                3,
                Some(&json!({
                    "operation": "getThumbnail",
                    "payload": { "thumbnailId": id }
                })),
            )
            .into_event();
        assert!(thumbnail[1]["result"]["dataUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn replacing_and_deleting_note_thumbnails_cleans_local_files() {
        let directory = tempdir().unwrap();
        let bridge = NativeBridge::new(directory.path());
        let prepare = |request_id| {
            bridge
                .handle(
                    TIMESTAMP_NOTES_METHOD,
                    request_id,
                    Some(&json!({ "operation": "prepareFrameCapture", "payload": {} })),
                )
                .into_event()
        };
        let first = prepare(10);
        let first_id = first[1]["result"]["thumbnailId"].as_str().unwrap();
        let first_path = std::path::PathBuf::from(first[1]["result"]["path"].as_str().unwrap());
        std::fs::write(&first_path, [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();
        let created = bridge
            .handle(
                TIMESTAMP_NOTES_METHOD,
                11,
                Some(&json!({
                    "operation": "create",
                    "payload": {
                        "videoId": "tt123",
                        "metaId": "tt123",
                        "mediaType": "movie",
                        "name": "Movie",
                        "title": null,
                        "season": null,
                        "episode": null,
                        "poster": null,
                        "timestampMs": 1000,
                        "durationMsAtCreation": 60000,
                        "text": "Frame note",
                        "color": "#56E0CF",
                        "rating": null,
                        "thumbnailId": first_id
                    }
                })),
            )
            .into_event();
        assert_eq!(created[1]["ok"], true);
        let note_id = created[1]["result"]["id"].as_str().unwrap();

        let second = prepare(12);
        let second_id = second[1]["result"]["thumbnailId"].as_str().unwrap();
        let second_path = std::path::PathBuf::from(second[1]["result"]["path"].as_str().unwrap());
        std::fs::write(&second_path, [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();
        let updated = bridge
            .handle(
                TIMESTAMP_NOTES_METHOD,
                13,
                Some(&json!({
                    "operation": "update",
                    "payload": {
                        "id": note_id,
                        "timestampMs": 1000,
                        "text": "Updated frame note",
                        "color": "#56E0CF",
                        "rating": null,
                        "thumbnailId": second_id
                    }
                })),
            )
            .into_event();
        assert_eq!(updated[1]["ok"], true);
        assert!(!first_path.exists());
        assert!(second_path.exists());

        let deleted = bridge
            .handle(
                TIMESTAMP_NOTES_METHOD,
                14,
                Some(&json!({ "operation": "delete", "payload": { "id": note_id } })),
            )
            .into_event();
        assert_eq!(deleted[1]["result"]["deleted"], true);
        assert!(!second_path.exists());
    }
}
