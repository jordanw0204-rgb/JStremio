use crate::{
    media::{validate_optional, validate_required, MediaMetadata},
    storage::{StorageError, StoredDocument},
};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_DEEP_LINK_CHARS: usize = 32_768;
const MAX_STREAM_LABEL_CHARS: usize = 4_096;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastPlayedEntry {
    pub id: String,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub player_deep_link: String,
    pub stream_key: String,
    pub addon_name: Option<String>,
    pub stream_name: Option<String>,
    pub stream_description: Option<String>,
    pub position_ms: Option<u64>,
    pub updated_at: String,
}

impl LastPlayedEntry {
    pub fn validate(&self) -> Result<(), StorageError> {
        self.media.validate()?;
        if self.id != self.media.key() {
            return Err(StorageError::invalid(
                "id",
                "must equal the stable media key",
            ));
        }
        validate_required(
            "playerDeepLink",
            &self.player_deep_link,
            MAX_DEEP_LINK_CHARS,
        )?;
        if !self.player_deep_link.starts_with("#/") && !self.player_deep_link.starts_with("/") {
            return Err(StorageError::invalid(
                "playerDeepLink",
                "must be a Stremio application route",
            ));
        }
        validate_required("streamKey", &self.stream_key, MAX_DEEP_LINK_CHARS)?;
        validate_optional(
            "addonName",
            self.addon_name.as_deref(),
            MAX_STREAM_LABEL_CHARS,
        )?;
        validate_optional(
            "streamName",
            self.stream_name.as_deref(),
            MAX_STREAM_LABEL_CHARS,
        )?;
        validate_optional(
            "streamDescription",
            self.stream_description.as_deref(),
            MAX_STREAM_LABEL_CHARS,
        )?;
        DateTime::parse_from_rfc3339(&self.updated_at)
            .map_err(|_| StorageError::invalid("updatedAt", "must be an RFC 3339 timestamp"))?;
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastPlayedInput {
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub player_deep_link: String,
    pub stream_key: String,
    pub addon_name: Option<String>,
    pub stream_name: Option<String>,
    pub stream_description: Option<String>,
    pub position_ms: Option<u64>,
}

impl LastPlayedInput {
    pub fn validate(&self) -> Result<(), StorageError> {
        LastPlayedEntry {
            id: self.media.key(),
            media: self.media.clone(),
            player_deep_link: self.player_deep_link.clone(),
            stream_key: self.stream_key.clone(),
            addon_name: self.addon_name.clone(),
            stream_name: self.stream_name.clone(),
            stream_description: self.stream_description.clone(),
            position_ms: self.position_ms,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
        .validate()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastPlayedDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<LastPlayedEntry>,
}

impl Default for LastPlayedDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            entries: Vec::new(),
        }
    }
}

impl StoredDocument for LastPlayedDocument {
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
        for entry in &self.entries {
            entry.validate()?;
            if !ids.insert(&entry.id) {
                return Err(StorageError::invalid(
                    "entries",
                    "contains duplicate media IDs",
                ));
            }
        }
        Ok(())
    }
}
