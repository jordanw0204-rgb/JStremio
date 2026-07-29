use crate::{
    media::MediaMetadata,
    storage::{StorageError, StoredDocument},
};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_PLAYBACK_SESSIONS: usize = 10_000;
const MAX_SESSION_ID_CHARS: usize = 128;
const MAX_JOURNAL_TEXT_CHARS: usize = 4_000;
const MAX_JOURNAL_TAGS: usize = 12;
const MAX_JOURNAL_TAG_CHARS: usize = 32;
const MAX_SESSION_TIME_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const POSITION_DURATION_TOLERANCE_MS: u64 = 5_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalAnnotation {
    pub text: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub updated_at: String,
}

impl JournalAnnotation {
    pub fn validate(&self) -> Result<(), StorageError> {
        validate_text("journal.text", &self.text, MAX_JOURNAL_TEXT_CHARS)?;
        if self.tags.len() > MAX_JOURNAL_TAGS {
            return Err(StorageError::invalid(
                "journal.tags",
                format!("must not contain more than {MAX_JOURNAL_TAGS} tags"),
            ));
        }
        let mut unique = HashSet::new();
        for tag in &self.tags {
            let normalized = tag.trim().to_lowercase();
            if normalized.is_empty()
                || tag.chars().count() > MAX_JOURNAL_TAG_CHARS
                || tag.chars().any(char::is_control)
            {
                return Err(StorageError::invalid(
                    "journal.tags",
                    "contains an invalid tag",
                ));
            }
            if !unique.insert(normalized) {
                return Err(StorageError::invalid(
                    "journal.tags",
                    "contains duplicate tags",
                ));
            }
        }
        validate_timestamp("journal.updatedAt", &self.updated_at)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalUpdate {
    pub id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
}

impl JournalUpdate {
    pub fn normalize(mut self) -> Result<Self, StorageError> {
        validate_id(&self.id)?;
        self.text = self.text.trim().to_string();
        self.tags = self
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        let probe = JournalAnnotation {
            text: self.text.clone(),
            tags: self.tags.clone(),
            favorite: self.favorite,
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        probe.validate()?;
        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub id: String,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub started_at: String,
    pub last_seen_at: String,
    pub ended_at: Option<String>,
    pub watched_ms: u64,
    pub start_position_ms: u64,
    pub end_position_ms: u64,
    pub max_position_ms: u64,
    pub duration_ms: Option<u64>,
    pub completed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journal: Option<JournalAnnotation>,
}

impl PlaybackSession {
    pub fn validate(&self) -> Result<(), StorageError> {
        validate_id(&self.id)?;
        self.media.validate()?;
        let started_at = parse_timestamp("startedAt", &self.started_at)?;
        let last_seen_at = parse_timestamp("lastSeenAt", &self.last_seen_at)?;
        if last_seen_at < started_at {
            return Err(StorageError::invalid(
                "lastSeenAt",
                "must not be earlier than startedAt",
            ));
        }
        if let Some(ended_at) = &self.ended_at {
            let ended_at = parse_timestamp("endedAt", ended_at)?;
            if ended_at < last_seen_at {
                return Err(StorageError::invalid(
                    "endedAt",
                    "must not be earlier than lastSeenAt",
                ));
            }
        }
        for (field, value) in [
            ("watchedMs", self.watched_ms),
            ("startPositionMs", self.start_position_ms),
            ("endPositionMs", self.end_position_ms),
            ("maxPositionMs", self.max_position_ms),
        ] {
            if value > MAX_SESSION_TIME_MS {
                return Err(StorageError::invalid(
                    field,
                    "is outside the supported seven-day session range",
                ));
            }
        }
        if self
            .duration_ms
            .is_some_and(|value| value == 0 || value > MAX_SESSION_TIME_MS)
        {
            return Err(StorageError::invalid(
                "durationMs",
                "is outside the supported range",
            ));
        }
        if self.max_position_ms < self.start_position_ms
            || self.max_position_ms < self.end_position_ms
        {
            return Err(StorageError::invalid(
                "maxPositionMs",
                "must be at least the observed start and end positions",
            ));
        }
        if let Some(duration_ms) = self.duration_ms {
            let maximum = duration_ms.saturating_add(POSITION_DURATION_TOLERANCE_MS);
            if self.start_position_ms > maximum
                || self.end_position_ms > maximum
                || self.max_position_ms > maximum
            {
                return Err(StorageError::invalid(
                    "durationMs",
                    "must be consistent with the observed playback positions",
                ));
            }
        }
        if let Some(journal) = &self.journal {
            journal.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaybackSessionInput {
    pub id: String,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub started_at: String,
    pub last_seen_at: String,
    pub ended_at: Option<String>,
    pub watched_ms: u64,
    pub start_position_ms: u64,
    pub end_position_ms: u64,
    pub max_position_ms: u64,
    pub duration_ms: Option<u64>,
    pub completed: bool,
}

impl PlaybackSessionInput {
    pub fn validate(&self) -> Result<(), StorageError> {
        PlaybackSession {
            id: self.id.clone(),
            media: self.media.clone(),
            started_at: self.started_at.clone(),
            last_seen_at: self.last_seen_at.clone(),
            ended_at: self.ended_at.clone(),
            watched_ms: self.watched_ms,
            start_position_ms: self.start_position_ms,
            end_position_ms: self.end_position_ms,
            max_position_ms: self.max_position_ms,
            duration_ms: self.duration_ms,
            completed: self.completed,
            journal: None,
        }
        .validate()
    }

    pub fn into_session(self) -> PlaybackSession {
        PlaybackSession {
            id: self.id,
            media: self.media,
            started_at: self.started_at,
            last_seen_at: self.last_seen_at,
            ended_at: self.ended_at,
            watched_ms: self.watched_ms,
            start_position_ms: self.start_position_ms,
            end_position_ms: self.end_position_ms,
            max_position_ms: self.max_position_ms,
            duration_ms: self.duration_ms,
            completed: self.completed,
            journal: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackHistoryDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub sessions: Vec<PlaybackSession>,
}

impl Default for PlaybackHistoryDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            sessions: Vec::new(),
        }
    }
}

impl StoredDocument for PlaybackHistoryDocument {
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
        if self.sessions.len() > MAX_PLAYBACK_SESSIONS {
            return Err(StorageError::invalid(
                "sessions",
                format!("must not contain more than {MAX_PLAYBACK_SESSIONS} entries"),
            ));
        }
        let mut ids = HashSet::new();
        for session in &self.sessions {
            session.validate()?;
            if !ids.insert(&session.id) {
                return Err(StorageError::invalid(
                    "sessions",
                    "contains duplicate session IDs",
                ));
            }
        }
        Ok(())
    }
}

fn validate_id(value: &str) -> Result<(), StorageError> {
    if value.trim().is_empty()
        || value.chars().count() > MAX_SESSION_ID_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(StorageError::invalid(
            "id",
            "contains an invalid session ID",
        ));
    }
    Ok(())
}

fn validate_text(field: &'static str, value: &str, max_chars: usize) -> Result<(), StorageError> {
    if value.chars().count() > max_chars || value.chars().any(|character| character == '\0') {
        return Err(StorageError::invalid(
            field,
            format!("must not exceed {max_chars} characters"),
        ));
    }
    Ok(())
}

fn validate_timestamp(field: &'static str, value: &str) -> Result<(), StorageError> {
    parse_timestamp(field, value).map(|_| ())
}

fn parse_timestamp(
    field: &'static str,
    value: &str,
) -> Result<DateTime<chrono::FixedOffset>, StorageError> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| StorageError::invalid(field, "must be an RFC 3339 timestamp"))
}
