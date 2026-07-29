use crate::{
    media::{MediaMetadata, MediaType},
    storage::{StorageError, StoredDocument},
};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_PROFILES: usize = 5_000;
const MAX_RANGE_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileScope {
    Video,
    Season,
    Series,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipAnchor {
    Absolute,
    FromEnd,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkipRange {
    pub start_ms: u64,
    pub end_ms: u64,
    pub anchor: SkipAnchor,
    pub duration_ms_at_creation: Option<u64>,
}

impl SkipRange {
    pub fn validate(&self) -> Result<(), StorageError> {
        if self.start_ms >= self.end_ms || self.end_ms > MAX_RANGE_MS {
            return Err(StorageError::invalid(
                "range",
                "must contain increasing timestamps within 24 hours",
            ));
        }
        if self.anchor == SkipAnchor::FromEnd {
            let duration = self.duration_ms_at_creation.ok_or_else(|| {
                StorageError::invalid("durationMsAtCreation", "is required for from-end ranges")
            })?;
            if duration == 0 || duration > MAX_RANGE_MS || self.end_ms > duration {
                return Err(StorageError::invalid(
                    "durationMsAtCreation",
                    "must contain the complete saved range",
                ));
            }
        }
        Ok(())
    }

    pub fn resolve(&self, duration_ms: Option<u64>) -> Option<ResolvedRange> {
        match self.anchor {
            SkipAnchor::Absolute => {
                let end_ms = duration_ms.map_or(self.end_ms, |duration| self.end_ms.min(duration));
                (end_ms > self.start_ms).then_some(ResolvedRange {
                    start_ms: self.start_ms,
                    end_ms,
                })
            }
            SkipAnchor::FromEnd => {
                let source_duration = self.duration_ms_at_creation?;
                let target_duration = duration_ms?;
                let start_from_end = source_duration.checked_sub(self.start_ms)?;
                let end_from_end = source_duration.checked_sub(self.end_ms)?;
                if target_duration <= start_from_end {
                    return None;
                }
                let start_ms = target_duration.saturating_sub(start_from_end);
                let end_ms = target_duration.saturating_sub(end_from_end);
                (end_ms > start_ms).then_some(ResolvedRange { start_ms, end_ms })
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkipProfile {
    pub id: String,
    pub scope: ProfileScope,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub intro: Option<SkipRange>,
    pub credits: Option<SkipRange>,
    pub created_at: String,
    pub updated_at: String,
}

impl SkipProfile {
    pub fn validate(&self) -> Result<(), StorageError> {
        self.media.validate()?;
        if self.id != profile_id(self.scope, &self.media)? {
            return Err(StorageError::invalid(
                "id",
                "must equal the stable profile key",
            ));
        }
        validate_scope(self.scope, &self.media)?;
        if self.intro.is_none() && self.credits.is_none() {
            return Err(StorageError::invalid(
                "profile",
                "must contain an intro or credits range",
            ));
        }
        if let Some(intro) = &self.intro {
            intro.validate()?;
        }
        if let Some(credits) = &self.credits {
            credits.validate()?;
        }
        validate_timestamp("createdAt", &self.created_at)?;
        validate_timestamp("updatedAt", &self.updated_at)
    }

    pub fn matches(&self, target: &MediaMetadata) -> bool {
        if self.media.media_type != target.media_type || self.media.meta_id != target.meta_id {
            return false;
        }
        match self.scope {
            ProfileScope::Video => self.media.video_id == target.video_id,
            ProfileScope::Season => self.media.season == target.season && target.season.is_some(),
            ProfileScope::Series => target.media_type == MediaType::Series,
        }
    }

    fn rank(&self) -> u8 {
        match self.scope {
            ProfileScope::Video => 3,
            ProfileScope::Season => 2,
            ProfileScope::Series => 1,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkipProfileInput {
    pub scope: ProfileScope,
    #[serde(flatten)]
    pub media: MediaMetadata,
    pub intro: Option<SkipRange>,
    pub credits: Option<SkipRange>,
}

impl SkipProfileInput {
    pub fn validate(&self) -> Result<(), StorageError> {
        SkipProfile {
            id: profile_id(self.scope, &self.media)?,
            scope: self.scope,
            media: self.media.clone(),
            intro: self.intro.clone(),
            credits: self.credits.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
        .validate()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRange {
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProfile {
    pub profile_id: String,
    pub scope: ProfileScope,
    pub intro: Option<ResolvedRange>,
    pub credits: Option<ResolvedRange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkipSegmentsDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub profiles: Vec<SkipProfile>,
}

impl Default for SkipSegmentsDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            profiles: Vec::new(),
        }
    }
}

impl StoredDocument for SkipSegmentsDocument {
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
        if self.profiles.len() > MAX_PROFILES {
            return Err(StorageError::invalid(
                "profiles",
                format!("must not contain more than {MAX_PROFILES} profiles"),
            ));
        }
        let mut ids = HashSet::new();
        for profile in &self.profiles {
            profile.validate()?;
            if !ids.insert(&profile.id) {
                return Err(StorageError::invalid(
                    "profiles",
                    "contains duplicate profile IDs",
                ));
            }
        }
        Ok(())
    }
}

pub fn resolve_profile(
    profiles: &[SkipProfile],
    target: &MediaMetadata,
    duration_ms: Option<u64>,
) -> Option<ResolvedProfile> {
    let profile = profiles
        .iter()
        .filter(|profile| profile.matches(target))
        .max_by_key(|profile| profile.rank())?;
    let intro = profile
        .intro
        .as_ref()
        .and_then(|range| range.resolve(duration_ms));
    let credits = profile
        .credits
        .as_ref()
        .and_then(|range| range.resolve(duration_ms));
    (intro.is_some() || credits.is_some()).then(|| ResolvedProfile {
        profile_id: profile.id.clone(),
        scope: profile.scope,
        intro,
        credits,
    })
}

pub fn profile_id(scope: ProfileScope, media: &MediaMetadata) -> Result<String, StorageError> {
    validate_scope(scope, media)?;
    Ok(match scope {
        ProfileScope::Video => format!("video:{}:{}", media.media_type.as_str(), media.video_id),
        ProfileScope::Season => format!(
            "season:{}:{}",
            media.meta_id,
            media.season.expect("validated season profile")
        ),
        ProfileScope::Series => format!("series:{}", media.meta_id),
    })
}

fn validate_scope(scope: ProfileScope, media: &MediaMetadata) -> Result<(), StorageError> {
    match scope {
        ProfileScope::Video => Ok(()),
        ProfileScope::Season if media.media_type == MediaType::Series && media.season.is_some() => {
            Ok(())
        }
        ProfileScope::Series if media.media_type == MediaType::Series => Ok(()),
        ProfileScope::Season => Err(StorageError::invalid(
            "scope",
            "season scope requires a numbered series episode",
        )),
        ProfileScope::Series => Err(StorageError::invalid(
            "scope",
            "series scope requires series media",
        )),
    }
}

fn validate_timestamp(field: &'static str, value: &str) -> Result<(), StorageError> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| StorageError::invalid(field, "must be an RFC 3339 timestamp"))
}

#[cfg(test)]
mod tests {
    use super::{resolve_profile, ProfileScope, SkipAnchor, SkipProfile, SkipRange};
    use crate::media::{MediaMetadata, MediaType};

    fn media(video_id: &str, season: u32) -> MediaMetadata {
        MediaMetadata {
            video_id: video_id.into(),
            meta_id: "tt123".into(),
            media_type: MediaType::Series,
            name: Some("Show".into()),
            title: Some("Episode".into()),
            season: Some(season),
            episode: Some(2),
            poster: None,
        }
    }

    fn profile(scope: ProfileScope, media: MediaMetadata, id: &str, start: u64) -> SkipProfile {
        SkipProfile {
            id: id.into(),
            scope,
            media,
            intro: Some(SkipRange {
                start_ms: start,
                end_ms: start + 10_000,
                anchor: SkipAnchor::Absolute,
                duration_ms_at_creation: None,
            }),
            credits: None,
            created_at: "2026-07-27T20:00:00Z".into(),
            updated_at: "2026-07-27T20:00:00Z".into(),
        }
    }

    #[test]
    fn video_profile_wins_over_season_and_series() {
        let target = media("tt123:1:2", 1);
        let profiles = vec![
            profile(ProfileScope::Series, target.clone(), "series:tt123", 1_000),
            profile(
                ProfileScope::Season,
                target.clone(),
                "season:tt123:1",
                2_000,
            ),
            profile(
                ProfileScope::Video,
                target.clone(),
                "video:series:tt123:1:2",
                3_000,
            ),
        ];
        let resolved = resolve_profile(&profiles, &target, Some(60_000)).unwrap();
        assert_eq!(resolved.profile_id, "video:series:tt123:1:2");
        assert_eq!(resolved.intro.unwrap().start_ms, 3_000);
    }

    #[test]
    fn credits_reuse_the_distance_from_the_end() {
        let range = SkipRange {
            start_ms: 90_000,
            end_ms: 100_000,
            anchor: SkipAnchor::FromEnd,
            duration_ms_at_creation: Some(100_000),
        };
        let resolved = range.resolve(Some(120_000)).unwrap();
        assert_eq!(resolved.start_ms, 110_000);
        assert_eq!(resolved.end_ms, 120_000);
        assert!(range.resolve(None).is_none());
        assert!(range.resolve(Some(5_000)).is_none());
    }
}
