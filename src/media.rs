use crate::storage::StorageError;
use serde::{Deserialize, Serialize};

const MAX_ID_CHARS: usize = 512;
const MAX_LABEL_CHARS: usize = 1_000;
const MAX_POSTER_CHARS: usize = 4_096;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Movie,
    Series,
}

impl MediaType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Series => "series",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    pub video_id: String,
    pub meta_id: String,
    pub media_type: MediaType,
    pub name: Option<String>,
    pub title: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub poster: Option<String>,
}

impl MediaMetadata {
    pub fn key(&self) -> String {
        format!("{}:{}", self.media_type.as_str(), self.video_id)
    }

    pub fn validate(&self) -> Result<(), StorageError> {
        validate_required("videoId", &self.video_id, MAX_ID_CHARS)?;
        validate_required("metaId", &self.meta_id, MAX_ID_CHARS)?;
        validate_optional("name", self.name.as_deref(), MAX_LABEL_CHARS)?;
        validate_optional("title", self.title.as_deref(), MAX_LABEL_CHARS)?;
        validate_optional("poster", self.poster.as_deref(), MAX_POSTER_CHARS)?;

        if self.media_type == MediaType::Movie && (self.season.is_some() || self.episode.is_some())
        {
            return Err(StorageError::invalid(
                "season",
                "movies cannot contain season or episode numbers",
            ));
        }
        Ok(())
    }
}

pub fn validate_required(
    field: &'static str,
    value: &str,
    max_chars: usize,
) -> Result<(), StorageError> {
    let length = value.chars().count();
    if value.trim().is_empty() {
        return Err(StorageError::invalid(field, "is required"));
    }
    if length > max_chars {
        return Err(StorageError::invalid(
            field,
            format!("must not exceed {max_chars} Unicode characters"),
        ));
    }
    Ok(())
}

pub fn validate_optional(
    field: &'static str,
    value: Option<&str>,
    max_chars: usize,
) -> Result<(), StorageError> {
    if value.map(str::chars).map(Iterator::count).unwrap_or(0) > max_chars {
        return Err(StorageError::invalid(
            field,
            format!("must not exceed {max_chars} Unicode characters"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{MediaMetadata, MediaType};

    fn episode() -> MediaMetadata {
        MediaMetadata {
            video_id: "tt123:1:2".into(),
            meta_id: "tt123".into(),
            media_type: MediaType::Series,
            name: Some("Series".into()),
            title: Some("Episode".into()),
            season: Some(1),
            episode: Some(2),
            poster: None,
        }
    }

    #[test]
    fn stable_media_key_includes_type() {
        assert_eq!(episode().key(), "series:tt123:1:2");
    }

    #[test]
    fn rejects_movie_episode_fields() {
        let mut media = episode();
        media.media_type = MediaType::Movie;
        assert!(media.validate().is_err());
    }
}
