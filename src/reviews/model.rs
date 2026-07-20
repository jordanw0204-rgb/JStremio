use crate::{
    media::{validate_optional, MediaMetadata},
    storage::{StorageError, StoredDocument},
};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_REVIEW_TEXT_CHARS: usize = 5_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub rating: u8,
    pub text: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Review {
    pub fn validate(&self) -> Result<(), StorageError> {
        self.media.validate()?;
        if self.id != self.media.key() {
            return Err(StorageError::invalid(
                "id",
                "must equal the stable media key",
            ));
        }
        if !(1..=10).contains(&self.rating) {
            return Err(StorageError::invalid(
                "rating",
                "must be an integer from 1 to 10",
            ));
        }
        validate_optional("text", Some(&self.text), MAX_REVIEW_TEXT_CHARS)?;
        validate_timestamp("createdAt", &self.created_at)?;
        validate_timestamp("updatedAt", &self.updated_at)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub rating: u8,
    #[serde(default)]
    pub text: String,
}

impl ReviewInput {
    pub fn validate(&self) -> Result<(), StorageError> {
        self.media.validate()?;
        if !(1..=10).contains(&self.rating) {
            return Err(StorageError::invalid(
                "rating",
                "must be an integer from 1 to 10",
            ));
        }
        validate_optional("text", Some(&self.text), MAX_REVIEW_TEXT_CHARS)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewsDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub reviews: Vec<Review>,
}

impl Default for ReviewsDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            reviews: Vec::new(),
        }
    }
}

impl StoredDocument for ReviewsDocument {
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
        for review in &self.reviews {
            review.validate()?;
            if !ids.insert(&review.id) {
                return Err(StorageError::invalid("reviews", "contains duplicate IDs"));
            }
        }
        Ok(())
    }
}

fn validate_timestamp(field: &'static str, value: &str) -> Result<(), StorageError> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| StorageError::invalid(field, "must be an RFC 3339 timestamp"))
}
