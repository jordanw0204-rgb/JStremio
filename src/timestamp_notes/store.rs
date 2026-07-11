use super::{CreateNoteInput, TimestampNote, TimestampNotesDocument, UpdateNoteInput};
use crate::storage::{JsonStore, StorageError};
use chrono::{SecondsFormat, Utc};
use std::path::Path;
use uuid::Uuid;

pub struct TimestampNoteStore {
    store: JsonStore<TimestampNotesDocument>,
}

impl TimestampNoteStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join("timestamp-notes.json")),
        }
    }

    pub fn health(&self) -> Result<u64, StorageError> {
        self.store.read().map(|document| document.revision)
    }

    pub fn list_all(&self) -> Result<Vec<TimestampNote>, StorageError> {
        self.store.read().map(|document| document.notes)
    }

    pub fn list_for_media(&self, media_key: &str) -> Result<Vec<TimestampNote>, StorageError> {
        self.store.read().map(|document| {
            let mut notes = document
                .notes
                .into_iter()
                .filter(|note| note.media_key == media_key)
                .collect::<Vec<_>>();
            notes.sort_by_key(|note| note.timestamp_ms);
            notes
        })
    }

    pub fn get(&self, id: &str) -> Result<Option<TimestampNote>, StorageError> {
        self.store
            .read()
            .map(|document| document.notes.into_iter().find(|note| note.id == id))
    }

    pub fn create(&self, input: CreateNoteInput) -> Result<TimestampNote, StorageError> {
        input.validate()?;
        self.store.mutate(|document| {
            let now = now();
            let note = TimestampNote {
                id: Uuid::new_v4().to_string(),
                media_key: input.media.key(),
                media: input.media,
                timestamp_ms: input.timestamp_ms,
                duration_ms_at_creation: input.duration_ms_at_creation,
                text: input.text.trim().to_string(),
                color: input.color.map(|value| value.to_ascii_uppercase()),
                rating: input.rating,
                thumbnail_id: input.thumbnail_id,
                created_at: now.clone(),
                updated_at: now,
            };
            note.validate()?;
            document.notes.push(note.clone());
            document.revision = document.revision.saturating_add(1);
            Ok(note)
        })
    }

    pub fn update(&self, input: UpdateNoteInput) -> Result<TimestampNote, StorageError> {
        input.validate()?;
        self.store.mutate(|document| {
            let note = document
                .notes
                .iter_mut()
                .find(|note| note.id == input.id)
                .ok_or_else(|| StorageError::invalid("id", "note was not found"))?;
            if let Some(duration) = note.duration_ms_at_creation {
                if input.timestamp_ms > duration.saturating_add(super::model::DURATION_TOLERANCE_MS)
                {
                    return Err(StorageError::invalid(
                        "timestampMs",
                        "cannot exceed the duration captured at creation",
                    ));
                }
            }
            note.timestamp_ms = input.timestamp_ms;
            note.text = input.text.trim().to_string();
            note.color = input.color.map(|value| value.to_ascii_uppercase());
            note.rating = input.rating;
            if let Some(thumbnail_id) = input.thumbnail_id {
                note.thumbnail_id = thumbnail_id;
            }
            note.updated_at = now();
            note.validate()?;
            let result = note.clone();
            document.revision = document.revision.saturating_add(1);
            Ok(result)
        })
    }

    pub fn delete(&self, id: &str) -> Result<bool, StorageError> {
        self.store.mutate(|document| {
            let before = document.notes.len();
            document.notes.retain(|note| note.id != id);
            let deleted = before != document.notes.len();
            if deleted {
                document.revision = document.revision.saturating_add(1);
            }
            Ok(deleted)
        })
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::TimestampNoteStore;
    use crate::{
        media::{MediaMetadata, MediaType},
        timestamp_notes::{CreateNoteInput, UpdateNoteInput},
    };
    use tempfile::tempdir;

    fn input(timestamp_ms: u64) -> CreateNoteInput {
        CreateNoteInput {
            media: MediaMetadata {
                video_id: "tt123:1:2".into(),
                meta_id: "tt123".into(),
                media_type: MediaType::Series,
                name: Some("Series".into()),
                title: Some("Episode".into()),
                season: Some(1),
                episode: Some(2),
                poster: None,
            },
            timestamp_ms,
            duration_ms_at_creation: Some(60_000),
            text: " note ".into(),
            color: Some("#56e0cf".into()),
            rating: Some(4),
            thumbnail_id: None,
        }
    }

    #[test]
    fn uuid_multiple_notes_update_delete_and_restart() {
        let directory = tempdir().unwrap();
        let store = TimestampNoteStore::new(directory.path());
        let first = store.create(input(10_000)).unwrap();
        let second = store.create(input(10_000)).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(store.list_for_media(&first.media_key).unwrap().len(), 2);

        let updated = store
            .update(UpdateNoteInput {
                id: first.id.clone(),
                timestamp_ms: 12_000,
                text: "updated".into(),
                color: Some("#ff3366".into()),
                rating: Some(5),
                thumbnail_id: None,
            })
            .unwrap();
        assert_eq!(updated.created_at, first.created_at);
        assert_eq!(updated.color.as_deref(), Some("#FF3366"));
        assert_eq!(updated.rating, Some(5));
        assert!(store.delete(&second.id).unwrap());

        let restarted = TimestampNoteStore::new(directory.path());
        assert_eq!(restarted.list_all().unwrap().len(), 1);
    }

    #[test]
    fn rejects_missing_text_and_out_of_range_timestamp() {
        let directory = tempdir().unwrap();
        let store = TimestampNoteStore::new(directory.path());
        let mut missing = input(10_000);
        missing.text = "  ".into();
        assert!(store.create(missing).is_err());
        assert!(store.create(input(62_000)).is_err());
        let mut bad_color = input(10_000);
        bad_color.color = Some("red".into());
        assert!(store.create(bad_color).is_err());
        let mut bad_rating = input(10_000);
        bad_rating.rating = Some(6);
        assert!(store.create(bad_rating).is_err());
    }
}
