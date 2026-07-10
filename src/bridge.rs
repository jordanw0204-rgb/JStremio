use crate::{
    reviews::{ReviewInput, ReviewStore},
    storage::StorageError,
    timestamp_notes::{CreateNoteInput, TimestampNoteStore, UpdateNoteInput},
};
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
                self.notes
                    .create(input)
                    .map(|note| json!(note))
                    .map_err(storage_error)
            }
            "update" => {
                let input: UpdateNoteInput = parse_value(request.payload)?;
                self.notes
                    .update(input)
                    .map(|note| json!(note))
                    .map_err(storage_error)
            }
            "delete" => {
                let payload: IdPayload = parse_value(request.payload)?;
                validate_lookup_id(&payload.id)?;
                self.notes
                    .delete(&payload.id)
                    .map(|deleted| json!({ "deleted": deleted }))
                    .map_err(storage_error)
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
}
