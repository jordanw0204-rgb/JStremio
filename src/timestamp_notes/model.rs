use crate::{
    media::{validate_required, MediaMetadata},
    storage::{StorageError, StoredDocument},
};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

pub const MAX_NOTE_TEXT_CHARS: usize = 5_000;
pub const DURATION_TOLERANCE_MS: u64 = 1_000;
pub const MAX_TIMESTAMP_MS: u64 = 7 * 24 * 60 * 60 * 1_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimestampNote {
    pub id: String,
    pub media_key: String,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub timestamp_ms: u64,
    pub duration_ms_at_creation: Option<u64>,
    pub text: String,
    pub created_at: String,
    pub updated_at: String,
}

impl TimestampNote {
    pub fn validate(&self) -> Result<(), StorageError> {
        self.media.validate()?;
        if Uuid::parse_str(&self.id).is_err() {
            return Err(StorageError::invalid("id", "must be a UUID"));
        }
        if self.media_key != self.media.key() {
            return Err(StorageError::invalid(
                "mediaKey",
                "must equal the stable media key",
            ));
        }
        validate_note_values(self.timestamp_ms, self.duration_ms_at_creation, &self.text)?;
        validate_timestamp("createdAt", &self.created_at)?;
        validate_timestamp("updatedAt", &self.updated_at)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateNoteInput {
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub timestamp_ms: u64,
    pub duration_ms_at_creation: Option<u64>,
    pub text: String,
}

impl CreateNoteInput {
    pub fn validate(&self) -> Result<(), StorageError> {
        self.media.validate()?;
        validate_note_values(self.timestamp_ms, self.duration_ms_at_creation, &self.text)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateNoteInput {
    pub id: String,
    pub timestamp_ms: u64,
    pub text: String,
}

impl UpdateNoteInput {
    pub fn validate(&self) -> Result<(), StorageError> {
        if Uuid::parse_str(&self.id).is_err() {
            return Err(StorageError::invalid("id", "must be a UUID"));
        }
        validate_required("text", &self.text, MAX_NOTE_TEXT_CHARS)?;
        if self.timestamp_ms > MAX_TIMESTAMP_MS {
            return Err(StorageError::invalid(
                "timestampMs",
                "is unreasonably large",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimestampNotesDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub notes: Vec<TimestampNote>,
}

impl Default for TimestampNotesDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            notes: Vec::new(),
        }
    }
}

impl StoredDocument for TimestampNotesDocument {
    const SCHEMA_VERSION: u32 = 1;

    fn schema_version(&self) -> u32 {
        self.schema_version
    }

    fn validate(&self) -> Result<(), StorageError> {
        if self.schema_version != Self::SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema {
                found: self.schema_version,
                expected: Self::SCHEMA_VERSION,
            });
        }
        let mut ids = HashSet::new();
        for note in &self.notes {
            note.validate()?;
            if !ids.insert(&note.id) {
                return Err(StorageError::invalid("notes", "contains duplicate IDs"));
            }
        }
        Ok(())
    }
}

fn validate_note_values(
    timestamp_ms: u64,
    duration_ms: Option<u64>,
    text: &str,
) -> Result<(), StorageError> {
    validate_required("text", text, MAX_NOTE_TEXT_CHARS)?;
    if timestamp_ms > MAX_TIMESTAMP_MS {
        return Err(StorageError::invalid(
            "timestampMs",
            "is unreasonably large",
        ));
    }
    if let Some(duration_ms) = duration_ms {
        if duration_ms == 0 {
            return Err(StorageError::invalid(
                "durationMsAtCreation",
                "must be positive",
            ));
        }
        if timestamp_ms > duration_ms.saturating_add(DURATION_TOLERANCE_MS) {
            return Err(StorageError::invalid(
                "timestampMs",
                "cannot exceed the known duration",
            ));
        }
    }
    Ok(())
}

fn validate_timestamp(field: &'static str, value: &str) -> Result<(), StorageError> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| StorageError::invalid(field, "must be an RFC 3339 timestamp"))
}
