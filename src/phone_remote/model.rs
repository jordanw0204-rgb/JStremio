use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, net::IpAddr};

pub const MAX_REMOTE_TEXT_CHARS: usize = 512;
pub const MAX_REMOTE_MESSAGE_BYTES: usize = 4 * 1024;
pub const MAX_SEEK_DELTA_MS: i64 = 5 * 60 * 1_000;
const MAX_REMOTE_POSITION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteInterface {
    pub name: String,
    pub address: IpAddr,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartPhoneRemoteRequest {
    pub interface_ip: IpAddr,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePlaybackState {
    pub publisher_id: String,
    pub revision: u64,
    pub active: bool,
    pub media_session_id: Option<String>,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub paused: Option<bool>,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub volume: Option<f64>,
    pub muted: Option<bool>,
    pub updated_at: i64,
}

impl Default for RemotePlaybackState {
    fn default() -> Self {
        Self {
            publisher_id: "native".into(),
            revision: 0,
            active: false,
            media_session_id: None,
            title: None,
            subtitle: None,
            season: None,
            episode: None,
            paused: None,
            position_ms: None,
            duration_ms: None,
            volume: None,
            muted: None,
            updated_at: Utc::now().timestamp_millis(),
        }
    }
}

impl RemotePlaybackState {
    pub fn validate(&self) -> Result<(), PhoneRemoteError> {
        if self.publisher_id.is_empty()
            || self.publisher_id.chars().count() > MAX_REMOTE_TEXT_CHARS
            || self.publisher_id.chars().any(char::is_control)
        {
            return Err(PhoneRemoteError::InvalidState);
        }
        for value in [&self.media_session_id, &self.title, &self.subtitle]
            .iter()
            .filter_map(|value| value.as_deref())
        {
            if value.chars().count() > MAX_REMOTE_TEXT_CHARS
                || value.chars().any(|character| character.is_control())
            {
                return Err(PhoneRemoteError::InvalidState);
            }
        }
        if self.active
            && self
                .media_session_id
                .as_deref()
                .is_none_or(|value| value.is_empty())
        {
            return Err(PhoneRemoteError::InvalidState);
        }
        if self
            .volume
            .is_some_and(|volume| !volume.is_finite() || !(0.0..=100.0).contains(&volume))
        {
            return Err(PhoneRemoteError::InvalidState);
        }
        if matches!((self.position_ms, self.duration_ms), (Some(position), Some(duration)) if position > duration.saturating_add(60_000))
        {
            return Err(PhoneRemoteError::InvalidState);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingCode {
    pub url: String,
    pub qr_data_url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneRemoteStatus {
    pub running: bool,
    pub interface_ip: Option<IpAddr>,
    pub origin: Option<String>,
    pub connected_clients: usize,
    pub paired_sessions: usize,
    pub started_at: Option<DateTime<Utc>>,
}

impl PhoneRemoteStatus {
    pub(crate) fn stopped() -> Self {
        Self {
            running: false,
            interface_ip: None,
            origin: None,
            connected_clients: 0,
            paired_sessions: 0,
            started_at: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartPhoneRemoteResult {
    pub status: PhoneRemoteStatus,
    pub pairing: PairingCode,
}

#[derive(Debug, thiserror::Error)]
pub enum PhoneRemoteError {
    #[error("the selected network interface is not available")]
    InvalidInterface,
    #[error("the phone remote is already running")]
    AlreadyRunning,
    #[error("the phone remote is not running")]
    NotRunning,
    #[error("the bundled phone remote assets are unavailable")]
    AssetsUnavailable,
    #[error("the phone remote could not start")]
    StartFailed,
    #[error("the playback state is invalid")]
    InvalidState,
    #[error("the active player is unavailable")]
    PlayerUnavailable,
    #[error("the remote command is invalid")]
    InvalidCommand,
}

impl PhoneRemoteError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidInterface => "invalid_interface",
            Self::AlreadyRunning => "already_running",
            Self::NotRunning => "not_running",
            Self::AssetsUnavailable => "assets_unavailable",
            Self::StartFailed => "start_failed",
            Self::InvalidState => "invalid_state",
            Self::PlayerUnavailable => "player_unavailable",
            Self::InvalidCommand => "invalid_command",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum RemoteCommand {
    SetPaused {
        request_id: u64,
        media_session_id: String,
        paused: bool,
    },
    TogglePaused {
        request_id: u64,
        media_session_id: String,
    },
    SeekTo {
        request_id: u64,
        media_session_id: String,
        position_ms: u64,
    },
    SeekBy {
        request_id: u64,
        media_session_id: String,
        delta_ms: i64,
    },
    SetVolume {
        request_id: u64,
        media_session_id: String,
        volume: f64,
    },
    SetMuted {
        request_id: u64,
        media_session_id: String,
        muted: bool,
    },
}

impl RemoteCommand {
    pub(crate) fn request_id(&self) -> u64 {
        match self {
            Self::SetPaused { request_id, .. }
            | Self::TogglePaused { request_id, .. }
            | Self::SeekTo { request_id, .. }
            | Self::SeekBy { request_id, .. }
            | Self::SetVolume { request_id, .. }
            | Self::SetMuted { request_id, .. } => *request_id,
        }
    }

    fn media_session_id(&self) -> &str {
        match self {
            Self::SetPaused {
                media_session_id, ..
            }
            | Self::TogglePaused {
                media_session_id, ..
            }
            | Self::SeekTo {
                media_session_id, ..
            }
            | Self::SeekBy {
                media_session_id, ..
            }
            | Self::SetVolume {
                media_session_id, ..
            }
            | Self::SetMuted {
                media_session_id, ..
            } => media_session_id,
        }
    }

    pub(crate) fn player_message(
        &self,
        state: &RemotePlaybackState,
    ) -> Result<String, PhoneRemoteError> {
        if !state.active
            || state.media_session_id.as_deref() != Some(self.media_session_id())
            || self.media_session_id().is_empty()
        {
            return Err(PhoneRemoteError::InvalidCommand);
        }

        let value = match self {
            Self::SetPaused { paused, .. } => {
                serde_json::json!(["mpv-set-prop", ["pause", paused]])
            }
            Self::TogglePaused { .. } => {
                let paused = state.paused.ok_or(PhoneRemoteError::InvalidCommand)?;
                serde_json::json!(["mpv-set-prop", ["pause", !paused]])
            }
            Self::SeekTo { position_ms, .. } => {
                if *position_ms > MAX_REMOTE_POSITION_MS {
                    return Err(PhoneRemoteError::InvalidCommand);
                }
                let target = clamp_position(*position_ms, state.duration_ms);
                serde_json::json!(["mpv-set-prop", ["time-pos", target as f64 / 1_000.0]])
            }
            Self::SeekBy { delta_ms, .. } => {
                if !(-MAX_SEEK_DELTA_MS..=MAX_SEEK_DELTA_MS).contains(delta_ms) {
                    return Err(PhoneRemoteError::InvalidCommand);
                }
                let current = state.position_ms.ok_or(PhoneRemoteError::InvalidCommand)? as i128;
                let target = (current + *delta_ms as i128).max(0) as u64;
                let target = clamp_position(target, state.duration_ms);
                serde_json::json!(["mpv-set-prop", ["time-pos", target as f64 / 1_000.0]])
            }
            Self::SetVolume { volume, .. } => {
                if !volume.is_finite() || !(0.0..=100.0).contains(volume) {
                    return Err(PhoneRemoteError::InvalidCommand);
                }
                serde_json::json!(["mpv-set-prop", ["volume", volume]])
            }
            Self::SetMuted { muted, .. } => {
                serde_json::json!(["mpv-set-prop", ["mute", muted]])
            }
        };
        serde_json::to_string(&value).map_err(|_| PhoneRemoteError::InvalidCommand)
    }
}

fn clamp_position(position_ms: u64, duration_ms: Option<u64>) -> u64 {
    duration_ms.map_or(position_ms, |duration| position_ms.min(duration))
}

impl fmt::Display for RemoteCommand {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::SetPaused { .. } => "setPaused",
            Self::TogglePaused { .. } => "togglePaused",
            Self::SeekTo { .. } => "seekTo",
            Self::SeekBy { .. } => "seekBy",
            Self::SetVolume { .. } => "setVolume",
            Self::SetMuted { .. } => "setMuted",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{PhoneRemoteError, RemoteCommand, RemotePlaybackState};

    fn playing() -> RemotePlaybackState {
        RemotePlaybackState {
            active: true,
            media_session_id: Some("session-one".into()),
            paused: Some(false),
            position_ms: Some(50_000),
            duration_ms: Some(100_000),
            volume: Some(50.0),
            ..RemotePlaybackState::default()
        }
    }

    #[test]
    fn maps_only_typed_commands_to_player_messages() {
        let command = RemoteCommand::SeekBy {
            request_id: 1,
            media_session_id: "session-one".into(),
            delta_ms: 80_000,
        };
        assert_eq!(
            command.player_message(&playing()).unwrap(),
            r#"["mpv-set-prop",["time-pos",100.0]]"#
        );
    }

    #[test]
    fn rejects_stale_sessions_and_out_of_range_values() {
        let stale = RemoteCommand::SetPaused {
            request_id: 1,
            media_session_id: "old".into(),
            paused: true,
        };
        assert!(matches!(
            stale.player_message(&playing()),
            Err(PhoneRemoteError::InvalidCommand)
        ));
        let volume = RemoteCommand::SetVolume {
            request_id: 2,
            media_session_id: "session-one".into(),
            volume: 101.0,
        };
        assert!(volume.player_message(&playing()).is_err());
        let seek = RemoteCommand::SeekTo {
            request_id: 3,
            media_session_id: "session-one".into(),
            position_ms: u64::MAX,
        };
        assert!(seek.player_message(&playing()).is_err());
    }

    #[test]
    fn maps_mute_to_an_mpv_flag() {
        let mute = RemoteCommand::SetMuted {
            request_id: 3,
            media_session_id: "session-one".into(),
            muted: true,
        };
        assert_eq!(
            mute.player_message(&playing()).unwrap(),
            r#"["mpv-set-prop",["mute",true]]"#
        );
    }
}
