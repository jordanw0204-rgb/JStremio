use super::model::{profile_id, resolve_profile};
use super::{ResolvedProfile, SkipProfile, SkipProfileInput, SkipSegmentsDocument};
use crate::{
    media::MediaMetadata,
    storage::{JsonStore, StorageError},
};
use chrono::{SecondsFormat, Utc};
use std::path::Path;

pub struct SkipSegmentStore {
    store: JsonStore<SkipSegmentsDocument>,
}

impl SkipSegmentStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join("skip-segments.json")),
        }
    }

    pub fn list_for_media(&self, target: &MediaMetadata) -> Result<Vec<SkipProfile>, StorageError> {
        target.validate()?;
        self.store.read().map(|document| {
            document
                .profiles
                .into_iter()
                .filter(|profile| profile.matches(target))
                .collect()
        })
    }

    pub fn resolve(
        &self,
        target: &MediaMetadata,
        duration_ms: Option<u64>,
    ) -> Result<Option<ResolvedProfile>, StorageError> {
        target.validate()?;
        self.store
            .read()
            .map(|document| resolve_profile(&document.profiles, target, duration_ms))
    }

    pub fn upsert(&self, input: SkipProfileInput) -> Result<SkipProfile, StorageError> {
        input.validate()?;
        let id = profile_id(input.scope, &input.media)?;
        self.store.mutate(|document| {
            let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
            let created_at = document
                .profiles
                .iter()
                .find(|profile| profile.id == id)
                .map(|profile| profile.created_at.clone())
                .unwrap_or_else(|| now.clone());
            let profile = SkipProfile {
                id: id.clone(),
                scope: input.scope,
                media: input.media,
                intro: input.intro,
                credits: input.credits,
                created_at,
                updated_at: now,
            };
            profile.validate()?;
            if let Some(existing) = document
                .profiles
                .iter_mut()
                .find(|profile| profile.id == id)
            {
                *existing = profile.clone();
            } else {
                document.profiles.push(profile.clone());
            }
            document.revision = document.revision.saturating_add(1);
            Ok(profile)
        })
    }

    pub fn delete(&self, id: &str) -> Result<bool, StorageError> {
        self.store.mutate(|document| {
            let before = document.profiles.len();
            document.profiles.retain(|profile| profile.id != id);
            let deleted = before != document.profiles.len();
            if deleted {
                document.revision = document.revision.saturating_add(1);
            }
            Ok(deleted)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::SkipSegmentStore;
    use crate::{
        media::{MediaMetadata, MediaType},
        skip_segments::{ProfileScope, SkipAnchor, SkipProfileInput, SkipRange},
    };
    use tempfile::tempdir;

    fn media(video_id: &str) -> MediaMetadata {
        MediaMetadata {
            video_id: video_id.into(),
            meta_id: "tt123".into(),
            media_type: MediaType::Series,
            name: Some("Show".into()),
            title: Some("Episode".into()),
            season: Some(1),
            episode: Some(2),
            poster: None,
        }
    }

    #[test]
    fn profiles_persist_and_resolve_for_another_episode() {
        let directory = tempdir().unwrap();
        let store = SkipSegmentStore::new(directory.path());
        store
            .upsert(SkipProfileInput {
                scope: ProfileScope::Series,
                media: media("tt123:1:2"),
                intro: Some(SkipRange {
                    start_ms: 5_000,
                    end_ms: 75_000,
                    anchor: SkipAnchor::Absolute,
                    duration_ms_at_creation: None,
                }),
                credits: None,
            })
            .unwrap();
        let restarted = SkipSegmentStore::new(directory.path());
        let resolved = restarted
            .resolve(&media("tt123:1:3"), Some(1_800_000))
            .unwrap()
            .unwrap();
        assert_eq!(resolved.intro.unwrap().end_ms, 75_000);
        assert!(restarted.delete(&resolved.profile_id).unwrap());
    }

    #[test]
    fn rejects_inverted_ranges_and_movie_series_scope() {
        let directory = tempdir().unwrap();
        let store = SkipSegmentStore::new(directory.path());
        let mut movie = media("tt999");
        movie.media_type = MediaType::Movie;
        movie.season = None;
        movie.episode = None;
        assert!(store
            .upsert(SkipProfileInput {
                scope: ProfileScope::Series,
                media: movie,
                intro: Some(SkipRange {
                    start_ms: 10_000,
                    end_ms: 5_000,
                    anchor: SkipAnchor::Absolute,
                    duration_ms_at_creation: None,
                }),
                credits: None,
            })
            .is_err());
    }
}
