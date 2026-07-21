use crate::storage::{JsonStore, StorageError, StoredDocument};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

const CONFIGURABLE_HOTKEY_PLUGINS: [&str; 2] = ["reviews", "timestamp-notes"];
pub const DEFAULT_BEGONE_MOUSE_IDLE_MS: f64 = 1_000.0;
pub const DEFAULT_REVIEW_AUTO_OPEN_AT_END: bool = true;
const MAX_BEGONE_MOUSE_IDLE_MS: f64 = 600_000.0;
pub const DEFAULT_QUICK_SEEK_SECONDS: f64 = 5.0;
const MIN_QUICK_SEEK_SECONDS: f64 = 0.05;
const MAX_QUICK_SEEK_SECONDS: f64 = 3_600.0;
pub const DEFAULT_QOL_REMEMBER_VOLUME: bool = true;
pub const DEFAULT_NO_SPOILERS_BLUR_SUMMARY: bool = true;
pub const DEFAULT_NO_SPOILERS_BLUR_ARTWORK: bool = true;
pub const DEFAULT_NO_SPOILERS_TITLE_MASK_PERCENT: u8 = 70;
pub const DEFAULT_NO_SPOILERS_GUARD_SEEKS: bool = true;
pub const DEFAULT_NO_SPOILERS_MAX_SKIP_MINUTES: f64 = 10.0;
const MAX_AUDIO_DEVICE_CHARS: usize = 2_048;
const MAX_AUDIO_DEVICE_DESCRIPTION_CHARS: usize = 512;
const MAX_SAVED_VOLUME: f64 = 130.0;
const MAX_NO_SPOILERS_SKIP_MINUTES: f64 = 1_440.0;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferredAudioDevice {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub enabled: HashMap<String, bool>,
    #[serde(default)]
    pub hotkeys: HashMap<String, String>,
    #[serde(default = "default_review_auto_open_at_end")]
    pub review_auto_open_at_end: bool,
    #[serde(default = "default_begone_mouse_idle_ms")]
    pub begone_mouse_idle_ms: f64,
    #[serde(default = "default_quick_seek_seconds")]
    pub quick_seek_backward_seconds: f64,
    #[serde(default = "default_quick_seek_seconds")]
    pub quick_seek_forward_seconds: f64,
    #[serde(default)]
    pub easy_sound_output_preferred_device: Option<PreferredAudioDevice>,
    #[serde(default = "default_qol_remember_volume")]
    pub qol_remember_volume: bool,
    #[serde(default)]
    pub qol_saved_volume: Option<f64>,
    #[serde(default = "default_no_spoilers_blur_summary")]
    pub no_spoilers_blur_summary: bool,
    #[serde(default = "default_no_spoilers_blur_artwork")]
    pub no_spoilers_blur_artwork: bool,
    #[serde(default = "default_no_spoilers_title_mask_percent")]
    pub no_spoilers_title_mask_percent: u8,
    #[serde(default = "default_no_spoilers_guard_seeks")]
    pub no_spoilers_guard_seeks: bool,
    #[serde(default = "default_no_spoilers_max_skip_minutes")]
    pub no_spoilers_max_skip_minutes: f64,
}

impl StoredDocument for PluginSettingsDocument {
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
        if self.enabled.len() > 128
            || self.enabled.keys().any(|id| {
                id.is_empty()
                    || id.len() > 64
                    || id.bytes().any(|byte| {
                        !(byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                    })
            })
        {
            return Err(StorageError::invalid(
                "enabled",
                "contains an invalid plugin ID",
            ));
        }
        if self.hotkeys.len() > CONFIGURABLE_HOTKEY_PLUGINS.len()
            || self
                .hotkeys
                .keys()
                .any(|id| !CONFIGURABLE_HOTKEY_PLUGINS.contains(&id.as_str()))
            || self.hotkeys.values().any(|hotkey| !valid_hotkey(hotkey))
        {
            return Err(StorageError::invalid(
                "hotkeys",
                "contains an invalid plugin hotkey",
            ));
        }
        let unique: HashSet<&str> = self.hotkeys.values().map(String::as_str).collect();
        if unique.len() != self.hotkeys.len() {
            return Err(StorageError::invalid(
                "hotkeys",
                "contains conflicting plugin hotkeys",
            ));
        }
        validate_begone_mouse_idle_ms(self.begone_mouse_idle_ms)?;
        validate_quick_seek_seconds("backwardSeconds", self.quick_seek_backward_seconds)?;
        validate_quick_seek_seconds("forwardSeconds", self.quick_seek_forward_seconds)?;
        if let Some(device) = &self.easy_sound_output_preferred_device {
            validate_preferred_audio_device(device)?;
        }
        validate_saved_volume(self.qol_saved_volume)?;
        validate_no_spoilers_settings(
            self.no_spoilers_title_mask_percent,
            self.no_spoilers_max_skip_minutes,
        )?;
        Ok(())
    }
}

impl Default for PluginSettingsDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            enabled: HashMap::new(),
            hotkeys: HashMap::new(),
            review_auto_open_at_end: DEFAULT_REVIEW_AUTO_OPEN_AT_END,
            begone_mouse_idle_ms: DEFAULT_BEGONE_MOUSE_IDLE_MS,
            quick_seek_backward_seconds: DEFAULT_QUICK_SEEK_SECONDS,
            quick_seek_forward_seconds: DEFAULT_QUICK_SEEK_SECONDS,
            easy_sound_output_preferred_device: None,
            qol_remember_volume: DEFAULT_QOL_REMEMBER_VOLUME,
            qol_saved_volume: None,
            no_spoilers_blur_summary: DEFAULT_NO_SPOILERS_BLUR_SUMMARY,
            no_spoilers_blur_artwork: DEFAULT_NO_SPOILERS_BLUR_ARTWORK,
            no_spoilers_title_mask_percent: DEFAULT_NO_SPOILERS_TITLE_MASK_PERCENT,
            no_spoilers_guard_seeks: DEFAULT_NO_SPOILERS_GUARD_SEEKS,
            no_spoilers_max_skip_minutes: DEFAULT_NO_SPOILERS_MAX_SKIP_MINUTES,
        }
    }
}

pub struct PluginSettingsStore {
    store: JsonStore<PluginSettingsDocument>,
}

impl PluginSettingsStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join("plugins.json")),
        }
    }

    pub fn overrides(&self) -> Result<HashMap<String, bool>, StorageError> {
        self.store.read().map(|document| document.enabled)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<u64, StorageError> {
        self.store.mutate(|document| {
            document.enabled.insert(id.to_string(), enabled);
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn hotkeys(&self) -> Result<HashMap<String, String>, StorageError> {
        self.store.read().map(|document| document.hotkeys)
    }

    pub fn set_hotkey(&self, id: &str, hotkey: Option<String>) -> Result<u64, StorageError> {
        if !CONFIGURABLE_HOTKEY_PLUGINS.contains(&id) {
            return Err(StorageError::invalid(
                "id",
                "does not identify a configurable built-in plugin",
            ));
        }
        self.store.mutate(|document| {
            if let Some(hotkey) = hotkey {
                document.hotkeys.insert(id.to_string(), hotkey);
            } else {
                document.hotkeys.remove(id);
            }
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn review_auto_open_at_end(&self) -> Result<bool, StorageError> {
        self.store
            .read()
            .map(|document| document.review_auto_open_at_end)
    }

    pub fn set_review_auto_open_at_end(&self, enabled: bool) -> Result<u64, StorageError> {
        self.store.mutate(|document| {
            document.review_auto_open_at_end = enabled;
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn begone_mouse_idle_ms(&self) -> Result<f64, StorageError> {
        self.store
            .read()
            .map(|document| document.begone_mouse_idle_ms)
    }

    pub fn set_begone_mouse_idle_ms(&self, idle_ms: f64) -> Result<u64, StorageError> {
        validate_begone_mouse_idle_ms(idle_ms)?;
        self.store.mutate(|document| {
            document.begone_mouse_idle_ms = idle_ms;
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn quick_seek_seconds(&self) -> Result<(f64, f64), StorageError> {
        self.store.read().map(|document| {
            (
                document.quick_seek_backward_seconds,
                document.quick_seek_forward_seconds,
            )
        })
    }

    pub fn set_quick_seek_seconds(
        &self,
        backward_seconds: f64,
        forward_seconds: f64,
    ) -> Result<u64, StorageError> {
        validate_quick_seek_seconds("backwardSeconds", backward_seconds)?;
        validate_quick_seek_seconds("forwardSeconds", forward_seconds)?;
        self.store.mutate(|document| {
            document.quick_seek_backward_seconds = backward_seconds;
            document.quick_seek_forward_seconds = forward_seconds;
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn preferred_audio_device(&self) -> Result<Option<PreferredAudioDevice>, StorageError> {
        self.store
            .read()
            .map(|document| document.easy_sound_output_preferred_device)
    }

    pub fn set_preferred_audio_device(
        &self,
        device: Option<PreferredAudioDevice>,
    ) -> Result<u64, StorageError> {
        if let Some(device) = &device {
            validate_preferred_audio_device(device)?;
        }
        self.store.mutate(|document| {
            document.easy_sound_output_preferred_device = device;
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn qol_settings(&self) -> Result<(bool, Option<f64>), StorageError> {
        self.store
            .read()
            .map(|document| (document.qol_remember_volume, document.qol_saved_volume))
    }

    pub fn set_qol_settings(
        &self,
        remember_volume: bool,
        saved_volume: Option<f64>,
    ) -> Result<u64, StorageError> {
        validate_saved_volume(saved_volume)?;
        self.store.mutate(|document| {
            document.qol_remember_volume = remember_volume;
            document.qol_saved_volume = saved_volume;
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }

    pub fn no_spoilers_settings(&self) -> Result<(bool, bool, u8, bool, f64), StorageError> {
        self.store.read().map(|document| {
            (
                document.no_spoilers_blur_summary,
                document.no_spoilers_blur_artwork,
                document.no_spoilers_title_mask_percent,
                document.no_spoilers_guard_seeks,
                document.no_spoilers_max_skip_minutes,
            )
        })
    }

    pub fn set_no_spoilers_settings(
        &self,
        blur_summary: bool,
        blur_artwork: bool,
        title_mask_percent: u8,
        guard_seeks: bool,
        max_skip_minutes: f64,
    ) -> Result<u64, StorageError> {
        validate_no_spoilers_settings(title_mask_percent, max_skip_minutes)?;
        self.store.mutate(|document| {
            document.no_spoilers_blur_summary = blur_summary;
            document.no_spoilers_blur_artwork = blur_artwork;
            document.no_spoilers_title_mask_percent = title_mask_percent;
            document.no_spoilers_guard_seeks = guard_seeks;
            document.no_spoilers_max_skip_minutes = max_skip_minutes;
            document.revision = document.revision.saturating_add(1);
            Ok(document.revision)
        })
    }
}

fn default_begone_mouse_idle_ms() -> f64 {
    DEFAULT_BEGONE_MOUSE_IDLE_MS
}

fn default_review_auto_open_at_end() -> bool {
    DEFAULT_REVIEW_AUTO_OPEN_AT_END
}

fn default_quick_seek_seconds() -> f64 {
    DEFAULT_QUICK_SEEK_SECONDS
}

fn default_qol_remember_volume() -> bool {
    DEFAULT_QOL_REMEMBER_VOLUME
}

fn default_no_spoilers_blur_summary() -> bool {
    DEFAULT_NO_SPOILERS_BLUR_SUMMARY
}

fn default_no_spoilers_blur_artwork() -> bool {
    DEFAULT_NO_SPOILERS_BLUR_ARTWORK
}

fn default_no_spoilers_title_mask_percent() -> u8 {
    DEFAULT_NO_SPOILERS_TITLE_MASK_PERCENT
}

fn default_no_spoilers_guard_seeks() -> bool {
    DEFAULT_NO_SPOILERS_GUARD_SEEKS
}

fn default_no_spoilers_max_skip_minutes() -> f64 {
    DEFAULT_NO_SPOILERS_MAX_SKIP_MINUTES
}

fn validate_begone_mouse_idle_ms(value: f64) -> Result<(), StorageError> {
    if !value.is_finite() || !(0.0..=MAX_BEGONE_MOUSE_IDLE_MS).contains(&value) {
        return Err(StorageError::invalid(
            "idleMs",
            "must be a finite number from 0 through 600000 milliseconds",
        ));
    }
    Ok(())
}

fn validate_quick_seek_seconds(field: &'static str, value: f64) -> Result<(), StorageError> {
    if !value.is_finite() || !(MIN_QUICK_SEEK_SECONDS..=MAX_QUICK_SEEK_SECONDS).contains(&value) {
        return Err(StorageError::invalid(
            field,
            "must be a finite number from 0.05 through 3600 seconds",
        ));
    }
    Ok(())
}

fn validate_preferred_audio_device(device: &PreferredAudioDevice) -> Result<(), StorageError> {
    let name_length = device.name.chars().count();
    let description_length = device.description.chars().count();
    if device.name.trim().is_empty()
        || name_length > MAX_AUDIO_DEVICE_CHARS
        || device.name.chars().any(char::is_control)
        || description_length > MAX_AUDIO_DEVICE_DESCRIPTION_CHARS
        || device.description.chars().any(char::is_control)
    {
        return Err(StorageError::invalid(
            "preferredDevice",
            "must contain a valid MPV audio device name and description",
        ));
    }
    Ok(())
}

fn validate_saved_volume(value: Option<f64>) -> Result<(), StorageError> {
    if value
        .is_some_and(|volume| !volume.is_finite() || !(0.0..=MAX_SAVED_VOLUME).contains(&volume))
    {
        return Err(StorageError::invalid(
            "savedVolume",
            "must be a finite number from 0 through 130",
        ));
    }
    Ok(())
}

fn validate_no_spoilers_settings(
    title_mask_percent: u8,
    max_skip_minutes: f64,
) -> Result<(), StorageError> {
    if title_mask_percent > 100 {
        return Err(StorageError::invalid(
            "titleMaskPercent",
            "must be from 0 through 100",
        ));
    }
    if !max_skip_minutes.is_finite()
        || !(0.05..=MAX_NO_SPOILERS_SKIP_MINUTES).contains(&max_skip_minutes)
    {
        return Err(StorageError::invalid(
            "maxSkipMinutes",
            "must be a finite number from 0.05 through 1440",
        ));
    }
    Ok(())
}

fn valid_hotkey(value: &str) -> bool {
    if value.is_empty() || value.len() > 64 || !value.is_ascii() {
        return false;
    }
    let parts: Vec<&str> = value.split('+').collect();
    let Some(code) = parts.last().copied() else {
        return false;
    };
    let modifiers = &parts[..parts.len() - 1];
    if !valid_hotkey_code(code)
        || (code == "F4" && modifiers.contains(&"Alt"))
        || modifiers == ["Alt"]
    {
        return false;
    }
    let mut previous_modifier = None;
    for modifier in modifiers {
        let index = match *modifier {
            "Ctrl" => 0,
            "Alt" => 1,
            "Shift" => 2,
            _ => return false,
        };
        if previous_modifier.is_some_and(|previous| index <= previous) {
            return false;
        }
        previous_modifier = Some(index);
    }
    true
}

fn valid_hotkey_code(code: &str) -> bool {
    let key = code
        .strip_prefix("Key")
        .is_some_and(|value| value.len() == 1 && value.as_bytes()[0].is_ascii_uppercase());
    let digit = code
        .strip_prefix("Digit")
        .is_some_and(|value| value.len() == 1 && value.as_bytes()[0].is_ascii_digit());
    let function = code
        .strip_prefix('F')
        .and_then(|value| value.parse::<u8>().ok())
        .is_some_and(|value| (1..=24).contains(&value));
    let numpad = code.strip_prefix("Numpad").is_some_and(|value| {
        (value.len() == 1 && value.as_bytes()[0].is_ascii_digit())
            || matches!(
                value,
                "Add" | "Subtract" | "Multiply" | "Divide" | "Decimal"
            )
    });
    key || digit
        || function
        || numpad
        || matches!(
            code,
            "Comma"
                | "Period"
                | "Slash"
                | "Semicolon"
                | "Quote"
                | "BracketLeft"
                | "BracketRight"
                | "Backslash"
                | "Backquote"
                | "Minus"
                | "Equal"
                | "IntlBackslash"
                | "Insert"
        )
}

#[cfg(test)]
mod tests {
    use super::{PluginSettingsStore, PreferredAudioDevice};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn plugin_overrides_persist() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        store.set_enabled("reviews", false).unwrap();
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .overrides()
                .unwrap()
                .get("reviews"),
            Some(&false)
        );
    }

    #[test]
    fn old_plugin_documents_gain_new_settings_without_a_migration() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("plugins.json"),
            r#"{"schemaVersion":1,"revision":1,"enabled":{"reviews":true}}"#,
        )
        .unwrap();
        let store = PluginSettingsStore::new(directory.path());
        assert!(store.hotkeys().unwrap().is_empty());
        assert!(store.review_auto_open_at_end().unwrap());
        assert_eq!(store.begone_mouse_idle_ms().unwrap(), 1_000.0);
        assert_eq!(store.quick_seek_seconds().unwrap(), (5.0, 5.0));
        assert_eq!(store.preferred_audio_device().unwrap(), None);
        assert_eq!(store.qol_settings().unwrap(), (true, None));
        assert_eq!(
            store.no_spoilers_settings().unwrap(),
            (true, true, 70, true, 10.0)
        );
        store
            .set_hotkey("reviews", Some("Ctrl+Shift+KeyR".into()))
            .unwrap();
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .hotkeys()
                .unwrap()
                .get("reviews")
                .map(String::as_str),
            Some("Ctrl+Shift+KeyR")
        );
    }

    #[test]
    fn review_end_prompt_defaults_on_and_persists() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        assert!(store.review_auto_open_at_end().unwrap());
        store.set_review_auto_open_at_end(false).unwrap();
        assert!(!PluginSettingsStore::new(directory.path())
            .review_auto_open_at_end()
            .unwrap());
    }

    #[test]
    fn rejects_unsafe_or_conflicting_hotkeys_and_supports_clearing() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        store
            .set_hotkey("reviews", Some("Ctrl+KeyR".into()))
            .unwrap();
        assert!(store
            .set_hotkey("timestamp-notes", Some("Ctrl+KeyR".into()))
            .is_err());
        assert!(store
            .set_hotkey("timestamp-notes", Some("ArrowLeft".into()))
            .is_err());
        assert!(store
            .set_hotkey("custom-plugin", Some("KeyP".into()))
            .is_err());
        store.set_hotkey("reviews", None).unwrap();
        assert!(store.hotkeys().unwrap().is_empty());
    }

    #[test]
    fn begone_mouse_delay_accepts_decimal_milliseconds_and_rejects_unsafe_values() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        store.set_begone_mouse_idle_ms(0.05).unwrap();
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .begone_mouse_idle_ms()
                .unwrap(),
            0.05
        );
        assert!(store.set_begone_mouse_idle_ms(-0.01).is_err());
        assert!(store.set_begone_mouse_idle_ms(600_000.01).is_err());
        assert!(store.set_begone_mouse_idle_ms(f64::NAN).is_err());
    }

    #[test]
    fn quick_seek_durations_persist_independently_and_reject_unsafe_values() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        store.set_quick_seek_seconds(7.5, 12.25).unwrap();
        assert_eq!(
            PluginSettingsStore::new(directory.path())
                .quick_seek_seconds()
                .unwrap(),
            (7.5, 12.25)
        );
        assert!(store.set_quick_seek_seconds(0.0, 5.0).is_err());
        assert!(store.set_quick_seek_seconds(5.0, 3_600.01).is_err());
        assert!(store.set_quick_seek_seconds(f64::NAN, 5.0).is_err());
        assert_eq!(store.quick_seek_seconds().unwrap(), (7.5, 12.25));
    }

    #[test]
    fn preferred_audio_device_persists_and_can_be_cleared() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        let device = PreferredAudioDevice {
            name: "wasapi/{device-id}".into(),
            description: "Desk Speakers".into(),
        };
        store
            .set_preferred_audio_device(Some(device.clone()))
            .unwrap();
        assert_eq!(store.preferred_audio_device().unwrap(), Some(device));
        store.set_preferred_audio_device(None).unwrap();
        assert_eq!(store.preferred_audio_device().unwrap(), None);
        assert!(store
            .set_preferred_audio_device(Some(PreferredAudioDevice {
                name: "bad\0device".into(),
                description: "Invalid".into(),
            }))
            .is_err());
    }

    #[test]
    fn qol_volume_and_no_spoilers_settings_validate_and_persist() {
        let directory = tempdir().unwrap();
        let store = PluginSettingsStore::new(directory.path());
        store.set_qol_settings(true, Some(42.5)).unwrap();
        assert_eq!(store.qol_settings().unwrap(), (true, Some(42.5)));
        assert!(store.set_qol_settings(true, Some(130.01)).is_err());
        store
            .set_no_spoilers_settings(false, true, 85, true, 2.5)
            .unwrap();
        assert_eq!(
            store.no_spoilers_settings().unwrap(),
            (false, true, 85, true, 2.5)
        );
        assert!(store
            .set_no_spoilers_settings(true, true, 101, true, 10.0)
            .is_err());
        assert!(store
            .set_no_spoilers_settings(true, true, 70, true, 0.0)
            .is_err());
    }
}
