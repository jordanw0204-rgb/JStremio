use crate::storage::{JsonStore, StorageError, StoredDocument};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

const CONFIGURABLE_HOTKEY_PLUGINS: [&str; 2] = ["reviews", "timestamp-notes"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub enabled: HashMap<String, bool>,
    #[serde(default)]
    pub hotkeys: HashMap<String, String>,
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
    fn old_plugin_documents_gain_persisted_hotkeys_without_a_migration() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("plugins.json"),
            r#"{"schemaVersion":1,"revision":1,"enabled":{"reviews":true}}"#,
        )
        .unwrap();
        let store = PluginSettingsStore::new(directory.path());
        assert!(store.hotkeys().unwrap().is_empty());
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
}
