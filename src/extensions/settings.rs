use crate::storage::{JsonStore, StorageError, StoredDocument};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub enabled: HashMap<String, bool>,
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
        Ok(())
    }
}

impl Default for PluginSettingsDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            enabled: HashMap::new(),
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
}

#[cfg(test)]
mod tests {
    use super::PluginSettingsStore;
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
}
