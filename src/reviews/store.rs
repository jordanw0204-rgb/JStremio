use super::{Review, ReviewInput, ReviewsDocument};
use crate::storage::{JsonStore, StorageError};
use chrono::{SecondsFormat, Utc};
use std::path::Path;

pub struct ReviewStore {
    store: JsonStore<ReviewsDocument>,
}

impl ReviewStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join("reviews.json")),
        }
    }

    pub fn health(&self) -> Result<u64, StorageError> {
        self.store.read().map(|document| document.revision)
    }

    pub fn list(&self) -> Result<Vec<Review>, StorageError> {
        self.store.read().map(|document| document.reviews)
    }

    pub fn get(&self, id: &str) -> Result<Option<Review>, StorageError> {
        self.store
            .read()
            .map(|document| document.reviews.into_iter().find(|review| review.id == id))
    }

    pub fn upsert(&self, input: ReviewInput) -> Result<Review, StorageError> {
        input.validate()?;
        let id = input.media.key();
        self.store.mutate(|document| {
            let now = now();
            let created_at = document
                .reviews
                .iter()
                .find(|review| review.id == id)
                .map(|review| review.created_at.clone())
                .unwrap_or_else(|| now.clone());
            let review = Review {
                id: id.clone(),
                media: input.media,
                rating: input.rating,
                text: input.text.trim().to_string(),
                created_at,
                updated_at: now,
            };
            review.validate()?;
            if let Some(existing) = document.reviews.iter_mut().find(|item| item.id == id) {
                *existing = review.clone();
            } else {
                document.reviews.push(review.clone());
            }
            document.revision = document.revision.saturating_add(1);
            Ok(review)
        })
    }

    pub fn delete(&self, id: &str) -> Result<bool, StorageError> {
        self.store.mutate(|document| {
            let before = document.reviews.len();
            document.reviews.retain(|review| review.id != id);
            let deleted = before != document.reviews.len();
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
    use super::ReviewStore;
    use crate::{
        media::{MediaMetadata, MediaType},
        reviews::ReviewInput,
    };
    use tempfile::tempdir;

    fn input(rating: u8) -> ReviewInput {
        ReviewInput {
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
            rating,
            text: " private review ".into(),
        }
    }

    #[test]
    fn create_update_delete_persists() {
        let directory = tempdir().unwrap();
        let store = ReviewStore::new(directory.path());
        let created = store.upsert(input(10)).unwrap();
        assert_eq!(created.id, "series:tt123:1:2");
        assert_eq!(created.text, "private review");
        let updated = store.upsert(input(9)).unwrap();
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.delete(&created.id).unwrap());

        let restarted = ReviewStore::new(directory.path());
        assert!(restarted.list().unwrap().is_empty());
    }

    #[test]
    fn rating_boundaries_are_enforced() {
        let directory = tempdir().unwrap();
        let store = ReviewStore::new(directory.path());
        assert!(store.upsert(input(0)).is_err());
        assert!(store.upsert(input(11)).is_err());
    }
}
