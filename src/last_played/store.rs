use super::{LastPlayedDocument, LastPlayedEntry, LastPlayedInput};
use crate::storage::{JsonStore, StorageError};
use chrono::{SecondsFormat, Utc};
use std::path::Path;

pub struct LastPlayedStore {
    store: JsonStore<LastPlayedDocument>,
}

impl LastPlayedStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join("last-played.json")),
        }
    }
    pub fn list(&self) -> Result<Vec<LastPlayedEntry>, StorageError> {
        self.store.read().map(|document| document.entries)
    }
    pub fn get(&self, id: &str) -> Result<Option<LastPlayedEntry>, StorageError> {
        self.store
            .read()
            .map(|document| document.entries.into_iter().find(|entry| entry.id == id))
    }
    pub fn upsert(&self, input: LastPlayedInput) -> Result<LastPlayedEntry, StorageError> {
        input.validate()?;
        let id = input.media.key();
        self.store.mutate(|document| {
            let entry = LastPlayedEntry {
                id: id.clone(),
                media: input.media,
                player_deep_link: input.player_deep_link,
                stream_key: input.stream_key,
                addon_name: input.addon_name,
                stream_name: input.stream_name,
                stream_description: input.stream_description,
                position_ms: input.position_ms,
                updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            };
            entry.validate()?;
            if let Some(existing) = document.entries.iter_mut().find(|entry| entry.id == id) {
                *existing = entry.clone();
            } else {
                document.entries.push(entry.clone());
            }
            document.revision = document.revision.saturating_add(1);
            Ok(entry)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::LastPlayedStore;
    use crate::{
        last_played::LastPlayedInput,
        media::{MediaMetadata, MediaType},
    };
    use tempfile::tempdir;

    fn input(link: &str) -> LastPlayedInput {
        LastPlayedInput {
            media: MediaMetadata {
                video_id: "tt1:1:2".into(),
                meta_id: "tt1".into(),
                media_type: MediaType::Series,
                name: Some("Series".into()),
                title: Some("Episode".into()),
                season: Some(1),
                episode: Some(2),
                poster: None,
            },
            player_deep_link: link.into(),
            stream_key: "infohash:abc:0".into(),
            addon_name: Some("Torrentio".into()),
            stream_name: Some("1080p".into()),
            stream_description: None,
            position_ms: Some(12_000),
        }
    }
    #[test]
    fn exact_stream_route_persists_and_updates() {
        let dir = tempdir().unwrap();
        let store = LastPlayedStore::new(dir.path());
        store.upsert(input("#/player/one")).unwrap();
        store.upsert(input("#/player/two")).unwrap();
        let restarted = LastPlayedStore::new(dir.path());
        let entry = restarted.get("series:tt1:1:2").unwrap().unwrap();
        assert_eq!(entry.player_deep_link, "#/player/two");
        assert_eq!(restarted.list().unwrap().len(), 1);
    }
    #[test]
    fn rejects_non_application_routes() {
        let dir = tempdir().unwrap();
        assert!(LastPlayedStore::new(dir.path())
            .upsert(input("https://evil.invalid/video"))
            .is_err());
    }
}
