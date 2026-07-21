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
    use super::PluginSettingsStore;
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
}
