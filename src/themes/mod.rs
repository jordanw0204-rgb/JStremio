use crate::storage::{JsonStore, StorageError, StoredDocument};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

const THEME_FILE: &str = "themes.json";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeSettings {
    pub background_start: String,
    pub background_end: String,
    pub accent: String,
    pub surface: String,
    pub text: String,
    pub gradient_angle: u16,
}

impl ThemeSettings {
    pub fn validate(&self) -> Result<(), StorageError> {
        for (field, color) in [
            ("backgroundStart", &self.background_start),
            ("backgroundEnd", &self.background_end),
            ("accent", &self.accent),
            ("surface", &self.surface),
            ("text", &self.text),
        ] {
            if !valid_hex_color(color) {
                return Err(StorageError::invalid(
                    "theme",
                    format!("{field} must be a six-digit hexadecimal color"),
                ));
            }
        }
        if self.gradient_angle > 360 {
            return Err(StorageError::invalid(
                "theme",
                "gradientAngle must be between 0 and 360",
            ));
        }
        Ok(())
    }

    /// Generates the smallest document-created script necessary to apply the
    /// persisted palette before Stremio paints its application root.
    pub fn startup_script(&self) -> Result<String, serde_json::Error> {
        let settings = serde_json::to_string(self)?;
        Ok(format!(
            r#";/* JStremio early theme */
(()=>{{
  const theme={settings};
  const install=()=>{{
    const root=document.documentElement;
    if(!root)return false;
    const set=(name,value)=>root.style.setProperty(name,value);
    set("--jstremio-background-start",theme.backgroundStart);
    set("--jstremio-background-end",theme.backgroundEnd);
    set("--jstremio-gradient-angle",`${{theme.gradientAngle}}deg`);
    set("--jstremio-accent-color",theme.accent);
    set("--jstremio-surface-color",theme.surface);
    set("--jstremio-text-color",theme.text);
    set("--primary-background-color",theme.backgroundStart);
    set("--secondary-background-color",theme.backgroundEnd);
    set("--primary-accent-color",theme.accent);
    set("--modal-background-color",theme.surface);
    set("--primary-foreground-color",theme.text);
    set("--overlay-color",`color-mix(in srgb, ${{theme.text}} 6%, transparent)`);
    set("--outer-glow",`0 0 15px color-mix(in srgb, ${{theme.accent}} 37%, transparent)`);
    let style=document.getElementById("jstremio-theme-runtime-style");
    if(!style){{style=document.createElement("style");style.id="jstremio-theme-runtime-style";root.append(style);}}
    style.textContent="html body{{background:linear-gradient(var(--jstremio-gradient-angle),var(--jstremio-background-start) 0%,var(--jstremio-background-end) 100%)!important;color:var(--jstremio-text-color)}}html[data-jstremio-player-route] body{{background:transparent!important}}";
    const syncRoute=()=>root.toggleAttribute("data-jstremio-player-route",/^#\/player(?:\/|$)/i.test(location.hash));
    syncRoute();
    if(!window.__jstremioThemeRouteSync){{window.addEventListener("hashchange",syncRoute);window.__jstremioThemeRouteSync=true;}}
    root.dataset.jstremioTheme="active";
    return true;
  }};
  if(!install()){{const observer=new MutationObserver(()=>{{if(install())observer.disconnect();}});observer.observe(document,{{childList:true,subtree:true}});}}
}})();
"#
        ))
    }
}

impl Default for ThemeSettings {
    fn default() -> Self {
        // These are the current Stremio Web defaults, expressed as opaque hex
        // colors so every picker and native validation path agrees.
        Self {
            background_start: "#0C0B11".into(),
            background_end: "#1A173E".into(),
            accent: "#7B5BF5".into(),
            surface: "#0F0D20".into(),
            text: "#E6E6E6".into(),
            gradient_angle: 41,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemePreset {
    pub id: String,
    pub name: String,
    pub theme: ThemeSettings,
}

impl ThemePreset {
    fn validate(&self) -> Result<(), StorageError> {
        if Uuid::parse_str(&self.id).is_err() {
            return Err(StorageError::invalid("preset", "id must be a UUID"));
        }
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 48 {
            return Err(StorageError::invalid(
                "preset",
                "name must contain between 1 and 48 characters",
            ));
        }
        self.theme.validate()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemeDocument {
    schema_version: u32,
    revision: u64,
    settings: ThemeSettings,
    #[serde(default)]
    presets: Vec<ThemePreset>,
}

impl Default for ThemeDocument {
    fn default() -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            revision: 0,
            settings: ThemeSettings::default(),
            presets: Vec::new(),
        }
    }
}

impl StoredDocument for ThemeDocument {
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
        self.settings.validate()?;
        if self.presets.len() > 50 {
            return Err(StorageError::invalid(
                "presets",
                "no more than 50 custom presets can be saved",
            ));
        }
        let mut ids = HashSet::with_capacity(self.presets.len());
        for preset in &self.presets {
            preset.validate()?;
            if !ids.insert(&preset.id) {
                return Err(StorageError::invalid(
                    "presets",
                    "preset ids must be unique",
                ));
            }
        }
        Ok(())
    }
}

pub struct ThemeStore {
    store: JsonStore<ThemeDocument>,
}

impl ThemeStore {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            store: JsonStore::new(data_directory.join(THEME_FILE)),
        }
    }

    pub fn get(&self) -> Result<ThemeSettings, StorageError> {
        self.store.read().map(|document| document.settings)
    }

    pub fn set(&self, settings: ThemeSettings) -> Result<ThemeSettings, StorageError> {
        settings.validate()?;
        self.store.mutate(|document| {
            document.settings = settings;
            document.revision = document.revision.saturating_add(1);
            Ok(document.settings.clone())
        })
    }

    pub fn reset(&self) -> Result<ThemeSettings, StorageError> {
        self.set(ThemeSettings::default())
    }

    pub fn presets(&self) -> Result<Vec<ThemePreset>, StorageError> {
        self.store.read().map(|document| document.presets)
    }

    pub fn create_preset(&self, theme: ThemeSettings) -> Result<ThemePreset, StorageError> {
        theme.validate()?;
        self.store.mutate(|document| {
            if document.presets.len() >= 50 {
                return Err(StorageError::invalid(
                    "presets",
                    "no more than 50 custom presets can be saved",
                ));
            }
            let name = next_custom_name(&document.presets);
            let preset = ThemePreset {
                id: Uuid::new_v4().to_string(),
                name,
                theme,
            };
            document.presets.push(preset.clone());
            document.revision = document.revision.saturating_add(1);
            Ok(preset)
        })
    }

    pub fn delete_preset(&self, id: &str) -> Result<bool, StorageError> {
        self.store.mutate(|document| {
            let original_len = document.presets.len();
            document.presets.retain(|preset| preset.id != id);
            let deleted = document.presets.len() != original_len;
            if deleted {
                document.revision = document.revision.saturating_add(1);
            }
            Ok(deleted)
        })
    }
}

fn next_custom_name(presets: &[ThemePreset]) -> String {
    let used = presets
        .iter()
        .filter_map(|preset| preset.name.strip_prefix("Custom "))
        .filter_map(|suffix| suffix.parse::<usize>().ok())
        .collect::<HashSet<_>>();
    let number = (1..).find(|number| !used.contains(number)).unwrap_or(1);
    format!("Custom {number}")
}

fn valid_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::{ThemeSettings, ThemeStore, THEME_FILE};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn theme_settings_persist_atomically_and_reset() {
        let directory = tempdir().unwrap();
        let store = ThemeStore::new(directory.path());
        let custom = ThemeSettings {
            background_start: "#001122".into(),
            background_end: "#223344".into(),
            accent: "#55AAFF".into(),
            surface: "#101820".into(),
            text: "#F4F8FF".into(),
            gradient_angle: 125,
        };
        assert_eq!(store.set(custom.clone()).unwrap(), custom);
        assert_eq!(ThemeStore::new(directory.path()).get().unwrap(), custom);
        assert!(directory.path().join(THEME_FILE).is_file());
        assert_eq!(store.reset().unwrap(), ThemeSettings::default());
        assert!(directory.path().join("themes.json.bak").is_file());
    }

    #[test]
    fn invalid_theme_is_rejected_without_overwriting_the_previous_palette() {
        let directory = tempdir().unwrap();
        let store = ThemeStore::new(directory.path());
        store.set(ThemeSettings::default()).unwrap();
        let before = fs::read(directory.path().join(THEME_FILE)).unwrap();
        let invalid = ThemeSettings {
            accent: "url(javascript:bad)".into(),
            ..ThemeSettings::default()
        };
        assert!(store.set(invalid).is_err());
        assert_eq!(fs::read(directory.path().join(THEME_FILE)).unwrap(), before);
    }

    #[test]
    fn custom_presets_persist_use_stable_names_and_can_be_deleted() {
        let directory = tempdir().unwrap();
        let store = ThemeStore::new(directory.path());
        let first_theme = ThemeSettings {
            accent: "#AA2233".into(),
            ..ThemeSettings::default()
        };
        let first = store.create_preset(first_theme.clone()).unwrap();
        let second = store.create_preset(ThemeSettings::default()).unwrap();
        assert_eq!(first.name, "Custom 1");
        assert_eq!(second.name, "Custom 2");
        assert_eq!(
            ThemeStore::new(directory.path()).presets().unwrap().len(),
            2
        );
        assert_eq!(store.presets().unwrap()[0].theme, first_theme);

        assert!(store.delete_preset(&first.id).unwrap());
        assert!(!store.delete_preset(&first.id).unwrap());
        assert_eq!(
            store.create_preset(ThemeSettings::default()).unwrap().name,
            "Custom 1"
        );
    }

    #[test]
    fn startup_script_contains_validated_official_variables() {
        let script = ThemeSettings::default().startup_script().unwrap();
        assert!(script.contains("--primary-background-color"));
        assert!(script.contains("--primary-accent-color"));
        assert!(script.contains("--modal-background-color"));
        assert!(script.contains("data-jstremio-player-route"));
        assert!(script.contains("background:transparent!important"));
        assert!(script.contains("\"gradientAngle\":41"));
        assert!(script.contains("MutationObserver"));
    }
}
