use super::{
    JournalAnnotation, JournalUpdate, PlaybackHistoryDocument, PlaybackSession,
    PlaybackSessionInput, MAX_PLAYBACK_SESSIONS,
};
use crate::storage::{JsonStore, StorageError};
use chrono::{DateTime, SecondsFormat, Utc};
use std::path::Path;

pub struct PlaybackHistoryStore {
    store: JsonStore<PlaybackHistoryDocument>,
}

impl PlaybackHistoryStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join("playback-history.json")),
        }
    }

    pub fn health(&self) -> Result<u64, StorageError> {
        self.store.read().map(|document| document.revision)
    }

    #[cfg(test)]
    pub fn list(&self) -> Result<Vec<PlaybackSession>, StorageError> {
        self.store.read().map(|document| document.sessions)
    }

    pub fn snapshot(&self) -> Result<(u64, Vec<PlaybackSession>), StorageError> {
        self.store
            .read()
            .map(|document| (document.revision, document.sessions))
    }

    pub fn upsert(&self, input: PlaybackSessionInput) -> Result<PlaybackSession, StorageError> {
        input.validate()?;
        self.store.mutate(|document| {
            if let Some(existing) = document
                .sessions
                .iter_mut()
                .find(|session| session.id == input.id)
            {
                if !same_session_identity(existing, &input) {
                    return Err(StorageError::invalid(
                        "id",
                        "is already associated with a different playback session",
                    ));
                }
                merge_session(existing, input);
                existing.validate()?;
                document.revision = document.revision.saturating_add(1);
                return Ok(existing.clone());
            }

            if document.sessions.len() >= MAX_PLAYBACK_SESSIONS {
                let removable = document
                    .sessions
                    .iter()
                    .enumerate()
                    .filter(|(_, session)| session.journal.is_none())
                    .min_by_key(|(_, session)| timestamp_millis(&session.last_seen_at))
                    .map(|(index, _)| index)
                    .ok_or_else(|| {
                        StorageError::invalid(
                            "sessions",
                            "history is full and every entry contains journal data",
                        )
                    })?;
                document.sessions.remove(removable);
            }

            let session = input.into_session();
            session.validate()?;
            document.sessions.push(session.clone());
            document.revision = document.revision.saturating_add(1);
            Ok(session)
        })
    }

    pub fn update_journal(
        &self,
        update: JournalUpdate,
    ) -> Result<Option<PlaybackSession>, StorageError> {
        let update = update.normalize()?;
        self.store.mutate(|document| {
            let Some(session) = document
                .sessions
                .iter_mut()
                .find(|session| session.id == update.id)
            else {
                return Ok(None);
            };
            session.journal =
                if update.text.is_empty() && update.tags.is_empty() && !update.favorite {
                    None
                } else {
                    Some(JournalAnnotation {
                        text: update.text,
                        tags: update.tags,
                        favorite: update.favorite,
                        updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                    })
                };
            session.validate()?;
            document.revision = document.revision.saturating_add(1);
            Ok(Some(session.clone()))
        })
    }

    pub fn delete(&self, id: &str) -> Result<bool, StorageError> {
        self.store.mutate_and_purge_backup(|document| {
            let before = document.sessions.len();
            document.sessions.retain(|session| session.id != id);
            let deleted = before != document.sessions.len();
            if deleted {
                document.revision = document.revision.saturating_add(1);
            }
            Ok(deleted)
        })
    }

    pub fn clear(&self) -> Result<u64, StorageError> {
        self.store.mutate_and_purge_backup(|document| {
            let removed = document.sessions.len() as u64;
            if removed > 0 {
                document.sessions.clear();
                document.revision = document.revision.saturating_add(1);
            }
            Ok(removed)
        })
    }
}

fn merge_session(existing: &mut PlaybackSession, input: PlaybackSessionInput) {
    let incoming_is_newer =
        timestamp_millis(&input.last_seen_at) >= timestamp_millis(&existing.last_seen_at);
    if incoming_is_newer {
        existing.media = input.media;
        existing.last_seen_at = input.last_seen_at;
        existing.end_position_ms = input.end_position_ms;
        existing.duration_ms = input.duration_ms.or(existing.duration_ms);
    }
    existing.ended_at = later_optional(existing.ended_at.take(), input.ended_at);
    existing.watched_ms = existing.watched_ms.max(input.watched_ms);
    existing.max_position_ms = existing.max_position_ms.max(input.max_position_ms);
    existing.completed |= input.completed;
}

fn same_session_identity(existing: &PlaybackSession, input: &PlaybackSessionInput) -> bool {
    timestamp_millis(&existing.started_at) == timestamp_millis(&input.started_at)
        && existing.media.video_id == input.media.video_id
        && existing.media.meta_id == input.media.meta_id
        && existing.media.media_type == input.media.media_type
        && existing.media.season == input.media.season
        && existing.media.episode == input.media.episode
}

fn later_optional(left: Option<String>, right: Option<String>) -> Option<String> {
    match (left, right) {
        (Some(left), Some(right)) => {
            if timestamp_millis(&right) >= timestamp_millis(&left) {
                Some(right)
            } else {
                Some(left)
            }
        }
        (left, right) => right.or(left),
    }
}

fn timestamp_millis(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.timestamp_millis())
        .unwrap_or(i64::MIN)
}

#[cfg(test)]
mod tests {
    use super::PlaybackHistoryStore;
    use crate::{
        media::{MediaMetadata, MediaType},
        playback_history::{JournalUpdate, PlaybackSessionInput},
    };
    use tempfile::tempdir;

    fn input(id: &str, watched_ms: u64, last_seen_at: &str) -> PlaybackSessionInput {
        PlaybackSessionInput {
            id: id.into(),
            media: MediaMetadata {
                video_id: "tt123:1:2".into(),
                meta_id: "tt123".into(),
                media_type: MediaType::Series,
                name: Some("Example Show".into()),
                title: Some("Episode".into()),
                season: Some(1),
                episode: Some(2),
                poster: None,
            },
            started_at: "2026-07-27T20:00:00.000Z".into(),
            last_seen_at: last_seen_at.into(),
            ended_at: None,
            watched_ms,
            start_position_ms: 1_000,
            end_position_ms: 20_000,
            max_position_ms: 20_000,
            duration_ms: Some(40_000),
            completed: false,
        }
    }

    #[test]
    fn retry_merge_is_monotonic_and_persists() {
        let directory = tempdir().unwrap();
        let store = PlaybackHistoryStore::new(directory.path());
        store
            .upsert(input("session-one", 20_000, "2026-07-27T20:01:00.000Z"))
            .unwrap();
        let merged = store
            .upsert(input("session-one", 5_000, "2026-07-27T20:00:30.000Z"))
            .unwrap();
        assert_eq!(merged.watched_ms, 20_000);
        assert_eq!(merged.last_seen_at, "2026-07-27T20:01:00.000Z");
        assert_eq!(
            PlaybackHistoryStore::new(directory.path())
                .list()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn stale_updates_cannot_replace_identity_or_newer_duration() {
        let directory = tempdir().unwrap();
        let store = PlaybackHistoryStore::new(directory.path());
        let mut current = input("session-one", 20_000, "2026-07-27T20:01:00.000Z");
        current.duration_ms = Some(45_000);
        store.upsert(current).unwrap();

        let mut stale = input("session-one", 5_000, "2026-07-27T20:00:30.000Z");
        stale.duration_ms = Some(30_000);
        let merged = store.upsert(stale).unwrap();
        assert_eq!(merged.duration_ms, Some(45_000));

        let mut collision = input("session-one", 5_000, "2026-07-27T20:02:00.000Z");
        collision.media.video_id = "tt999:1:1".into();
        assert!(store.upsert(collision).is_err());
    }

    #[test]
    fn invalid_session_chronology_is_rejected() {
        let directory = tempdir().unwrap();
        let store = PlaybackHistoryStore::new(directory.path());
        let invalid = input("session-one", 5_000, "2026-07-27T19:59:00.000Z");
        assert!(store.upsert(invalid).is_err());
    }

    #[test]
    fn playback_updates_preserve_journal_annotations() {
        let directory = tempdir().unwrap();
        let store = PlaybackHistoryStore::new(directory.path());
        store
            .upsert(input("session-one", 5_000, "2026-07-27T20:00:30.000Z"))
            .unwrap();
        store
            .update_journal(JournalUpdate {
                id: "session-one".into(),
                text: " Great episode ".into(),
                tags: vec!["Mystery".into()],
                favorite: true,
            })
            .unwrap();
        let updated = store
            .upsert(input("session-one", 25_000, "2026-07-27T20:02:00.000Z"))
            .unwrap();
        let journal = updated.journal.unwrap();
        assert_eq!(journal.text, "Great episode");
        assert!(journal.favorite);
    }

    #[test]
    fn delete_clear_and_invalid_tags_are_handled() {
        let directory = tempdir().unwrap();
        let store = PlaybackHistoryStore::new(directory.path());
        store
            .upsert(input("one", 5_000, "2026-07-27T20:00:30.000Z"))
            .unwrap();
        assert!(store
            .update_journal(JournalUpdate {
                id: "one".into(),
                text: String::new(),
                tags: vec!["same".into(), "SAME".into()],
                favorite: false,
            })
            .is_err());
        assert!(store.delete("one").unwrap());
        store
            .upsert(input("two", 1_000, "2026-07-27T20:00:10.000Z"))
            .unwrap();
        assert_eq!(store.clear().unwrap(), 1);
        assert!(store.list().unwrap().is_empty());
        assert!(!directory.path().join("playback-history.json.bak").exists());
    }
}
