use crate::{
    reviews::{ReviewInput, ReviewStore},
    storage::StorageError,
    timestamp_notes::{CreateNoteInput, TimestampNoteStore, UpdateNoteInput},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const REVIEWS_METHOD: &str = "jstremio-reviews";
pub const TIMESTAMP_NOTES_METHOD: &str = "jstremio-timestamp-notes";

pub struct NativeBridge {
    reviews: ReviewStore,
    notes: TimestampNoteStore,
    data_directory: PathBuf,
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
    pub fn new(data_directory: &Path) -> Self {
        Self {
            reviews: ReviewStore::new(data_directory),
            notes: TimestampNoteStore::new(data_directory),
            data_directory: data_directory.to_path_buf(),
        }
    }

    pub fn supports(method: &str) -> bool {
        matches!(method, REVIEWS_METHOD | TIMESTAMP_NOTES_METHOD)
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

fn thumbnail_error(message: &str) -> ErrorPayload {
    ErrorPayload {
        code: "thumbnail_unavailable".into(),
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
    use super::{NativeBridge, REVIEWS_METHOD, TIMESTAMP_NOTES_METHOD};
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
        assert!(!NativeBridge::supports("jstremio-filesystem"));
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
