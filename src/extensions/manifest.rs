use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use thiserror::Error;

const MANIFEST_SCHEMA_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_RUNTIME_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_STYLE_BYTES: u64 = 512 * 1024;
const MAX_EXTENSIONS: usize = 32;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub entry: String,
    pub styles: String,
    pub enabled_by_default: bool,
    pub load_order: i32,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub core: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub built_in: bool,
    pub enabled: bool,
    pub core: bool,
    pub error: Option<String>,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("extension resources are unavailable: {0}")]
    Io(#[from] std::io::Error),
    #[error("extension manifest is malformed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
}

#[derive(Clone)]
pub struct ExtensionLoader {
    injection_script: Arc<str>,
    loaded_ids: Arc<Vec<String>>,
    plugins: Arc<Vec<PluginDescriptor>>,
}

struct LoadedExtension {
    manifest: ExtensionManifest,
    entry: String,
    styles: String,
}

impl ExtensionLoader {
    #[cfg(test)]
    pub fn load(root: &Path, disabled_ids: &HashSet<String>) -> Result<Self, ManifestError> {
        Self::load_with_user(root, None, disabled_ids, &HashMap::new())
    }

    pub fn load_with_user(
        root: &Path,
        user_root: Option<&Path>,
        disabled_ids: &HashSet<String>,
        overrides: &HashMap<String, bool>,
    ) -> Result<Self, ManifestError> {
        let canonical_root = fs::canonicalize(root)?;
        if !canonical_root.is_dir() {
            return Err(ManifestError::Invalid(
                "the extensions resource path is not a directory".into(),
            ));
        }

        let runtime_path = canonical_root.join("runtime.js");
        let runtime = read_limited(&runtime_path, MAX_RUNTIME_BYTES)?;
        let mut extensions = Vec::new();
        let mut plugins = Vec::new();
        let mut seen = HashSet::new();

        let mut directories = fs::read_dir(&canonical_root)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .collect::<Vec<_>>();
        directories.sort_by_key(|entry| entry.file_name());
        if directories.len() > MAX_EXTENSIONS {
            return Err(ManifestError::Invalid(format!(
                "no more than {MAX_EXTENSIONS} packaged extensions are allowed"
            )));
        }

        for directory in directories {
            let manifest_path = directory.path().join("manifest.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest_source = read_limited(&manifest_path, MAX_MANIFEST_BYTES)?;
            let manifest: ExtensionManifest = serde_json::from_str(&manifest_source)?;
            validate_manifest(&manifest)?;
            if !seen.insert(manifest.id.clone()) {
                return Err(ManifestError::Invalid(format!(
                    "duplicate extension ID '{}'",
                    manifest.id
                )));
            }

            let extension_root = fs::canonicalize(directory.path())?;
            if !extension_root.starts_with(&canonical_root) {
                return Err(ManifestError::Invalid(
                    "an extension directory escapes the resource root".into(),
                ));
            }
            let entry_path = resolve_packaged_file(&extension_root, &manifest.entry, "js")?;
            let style_path = resolve_packaged_file(&extension_root, &manifest.styles, "css")?;
            let entry = read_limited(&entry_path, MAX_ENTRY_BYTES)?;
            let styles = read_limited(&style_path, MAX_STYLE_BYTES)?;

            let enabled = manifest.core
                || (overrides
                    .get(&manifest.id)
                    .copied()
                    .unwrap_or(manifest.enabled_by_default)
                    && !disabled_ids.contains(&manifest.id));
            plugins.push(descriptor(&manifest, true, enabled, None));
            if enabled {
                extensions.push(LoadedExtension {
                    manifest,
                    entry,
                    styles,
                });
            }
        }

        if let Some(user_root) = user_root {
            fs::create_dir_all(user_root)?;
            let canonical_user_root = fs::canonicalize(user_root)?;
            let mut user_directories = fs::read_dir(&canonical_user_root)?
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .collect::<Vec<_>>();
            user_directories.sort_by_key(|entry| entry.file_name());
            if user_directories.len() > MAX_EXTENSIONS {
                return Err(ManifestError::Invalid(format!(
                    "no more than {MAX_EXTENSIONS} user plugins are allowed"
                )));
            }
            for directory in user_directories {
                let folder_name = directory.file_name().to_string_lossy().to_string();
                let loaded = (|| -> Result<(ExtensionManifest, String, String), ManifestError> {
                    let manifest_source =
                        read_limited(&directory.path().join("manifest.json"), MAX_MANIFEST_BYTES)?;
                    let manifest: ExtensionManifest = serde_json::from_str(&manifest_source)?;
                    validate_manifest(&manifest)?;
                    if manifest.core {
                        return Err(ManifestError::Invalid(
                            "user plugins cannot declare themselves core".into(),
                        ));
                    }
                    if !seen.insert(manifest.id.clone()) {
                        return Err(ManifestError::Invalid(format!(
                            "duplicate plugin ID '{}'",
                            manifest.id
                        )));
                    }
                    let extension_root = fs::canonicalize(directory.path())?;
                    if !extension_root.starts_with(&canonical_user_root) {
                        return Err(ManifestError::Invalid(
                            "a user plugin directory escapes the plugin root".into(),
                        ));
                    }
                    let entry_path = resolve_packaged_file(&extension_root, &manifest.entry, "js")?;
                    let style_path =
                        resolve_packaged_file(&extension_root, &manifest.styles, "css")?;
                    let entry = read_limited(&entry_path, MAX_ENTRY_BYTES)?;
                    let styles = read_limited(&style_path, MAX_STYLE_BYTES)?;
                    Ok((manifest, entry, styles))
                })();
                match loaded {
                    Ok((manifest, entry, styles)) => {
                        let enabled = overrides.get(&manifest.id).copied() == Some(true)
                            && !disabled_ids.contains(&manifest.id);
                        plugins.push(descriptor(&manifest, false, enabled, None));
                        if enabled {
                            extensions.push(LoadedExtension {
                                manifest,
                                entry,
                                styles,
                            });
                        }
                    }
                    Err(error) => plugins.push(PluginDescriptor {
                        id: format!("invalid-{folder_name}"),
                        name: folder_name,
                        version: String::new(),
                        description: String::new(),
                        author: String::new(),
                        built_in: false,
                        enabled: false,
                        core: false,
                        error: Some(error.to_string()),
                    }),
                }
            }
        }

        extensions.sort_by(|left, right| {
            left.manifest
                .load_order
                .cmp(&right.manifest.load_order)
                .then_with(|| left.manifest.id.cmp(&right.manifest.id))
        });

        let loaded_ids = extensions
            .iter()
            .map(|extension| extension.manifest.id.clone())
            .collect::<Vec<_>>();
        let mut injection_script = String::with_capacity(
            runtime.len()
                + extensions
                    .iter()
                    .map(|item| item.entry.len())
                    .sum::<usize>(),
        );
        injection_script.push_str(";/* JStremio runtime */\n");
        let style_map = extensions
            .iter()
            .map(|extension| (extension.manifest.id.clone(), extension.styles.clone()))
            .collect::<HashMap<_, _>>();
        injection_script.push_str("window.__JSTREMIO_PLUGIN_STYLES__=Object.freeze(");
        injection_script.push_str(&serde_json::to_string(&style_map)?);
        injection_script.push_str(");\n");
        injection_script.push_str(&runtime);
        injection_script.push('\n');
        for extension in extensions {
            injection_script.push_str(&format!(
                ";/* JStremio extension: {} */\n;(()=>{{try{{\n",
                extension.manifest.id
            ));
            injection_script.push_str(&extension.entry);
            injection_script.push_str(&format!(
                "\n}}catch(error){{window.JStremio?.diagnostics?.report({}, error);}}}})();\n",
                serde_json::to_string(&extension.manifest.id)?
            ));
        }

        Ok(Self {
            injection_script: Arc::from(injection_script),
            loaded_ids: Arc::new(loaded_ids),
            plugins: Arc::new(plugins),
        })
    }

    pub fn injection_script(&self) -> &str {
        &self.injection_script
    }

    pub fn loaded_ids(&self) -> &[String] {
        &self.loaded_ids
    }

    pub fn plugins(&self) -> &[PluginDescriptor] {
        &self.plugins
    }
}

fn descriptor(
    manifest: &ExtensionManifest,
    built_in: bool,
    enabled: bool,
    error: Option<String>,
) -> PluginDescriptor {
    PluginDescriptor {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        author: manifest.author.clone(),
        built_in,
        enabled,
        core: manifest.core,
        error,
    }
}

fn validate_manifest(manifest: &ExtensionManifest) -> Result<(), ManifestError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(ManifestError::Invalid(format!(
            "extension '{}' uses unsupported schema version {}",
            manifest.id, manifest.schema_version
        )));
    }
    let id_valid = !manifest.id.is_empty()
        && manifest.id.len() <= 64
        && !manifest.id.starts_with('-')
        && !manifest.id.ends_with('-')
        && manifest
            .id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !id_valid {
        return Err(ManifestError::Invalid(
            "extension IDs must use 1-64 lowercase ASCII letters, digits, or interior hyphens"
                .into(),
        ));
    }
    if manifest.name.trim().is_empty() || manifest.name.chars().count() > 128 {
        return Err(ManifestError::Invalid(format!(
            "extension '{}' has an invalid name",
            manifest.id
        )));
    }
    if manifest.version.trim().is_empty() || manifest.version.len() > 64 {
        return Err(ManifestError::Invalid(format!(
            "extension '{}' has an invalid version",
            manifest.id
        )));
    }
    validate_relative_path(&manifest.entry, "js")?;
    validate_relative_path(&manifest.styles, "css")?;
    Ok(())
}

fn validate_relative_path(value: &str, extension: &str) -> Result<(), ManifestError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || path.extension().and_then(|value| value.to_str()) != Some(extension)
    {
        return Err(ManifestError::Invalid(format!(
            "packaged path '{value}' must be a relative .{extension} path without traversal"
        )));
    }
    Ok(())
}

fn resolve_packaged_file(
    extension_root: &Path,
    relative: &str,
    extension: &str,
) -> Result<PathBuf, ManifestError> {
    validate_relative_path(relative, extension)?;
    let resolved = fs::canonicalize(extension_root.join(relative))?;
    if !resolved.starts_with(extension_root) || !resolved.is_file() {
        return Err(ManifestError::Invalid(format!(
            "packaged path '{relative}' escapes its extension directory"
        )));
    }
    Ok(resolved)
}

fn read_limited(path: &Path, limit: u64) -> Result<String, ManifestError> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(ManifestError::Invalid(format!(
            "packaged file '{}' is missing or exceeds {limit} bytes",
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("unknown")
        )));
    }
    Ok(fs::read_to_string(path)?)
}

#[cfg(test)]
mod tests {
    use super::ExtensionLoader;
    use std::{
        collections::{HashMap, HashSet},
        fs,
    };
    use tempfile::tempdir;

    fn extension(root: &std::path::Path, id: &str, order: i32) {
        let directory = root.join(id);
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("manifest.json"),
            format!(
                r#"{{"schemaVersion":1,"id":"{id}","name":"{id}","version":"1.0.0","entry":"index.js","styles":"styles.css","enabledByDefault":true,"loadOrder":{order}}}"#
            ),
        )
        .unwrap();
        fs::write(
            directory.join("index.js"),
            format!("window.order.push('{id}')"),
        )
        .unwrap();
        fs::write(directory.join("styles.css"), "button { color: white; }").unwrap();
    }

    #[test]
    fn loads_in_deterministic_order_and_supports_independent_disablement() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("runtime.js"), "window.order=[]").unwrap();
        extension(directory.path(), "later", 20);
        extension(directory.path(), "earlier", 10);
        let mut disabled = HashSet::new();
        disabled.insert("later".into());
        let loader = ExtensionLoader::load(directory.path(), &disabled).unwrap();
        assert_eq!(loader.loaded_ids(), &["earlier"]);
        assert!(loader.injection_script().contains("window.order=[]"));
    }

    #[test]
    fn rejects_traversal_and_duplicate_ids() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("runtime.js"), "").unwrap();
        extension(directory.path(), "one", 1);
        let manifest = directory.path().join("one").join("manifest.json");
        let source = fs::read_to_string(&manifest)
            .unwrap()
            .replace("index.js", "../index.js");
        fs::write(manifest, source).unwrap();
        assert!(ExtensionLoader::load(directory.path(), &HashSet::new()).is_err());
    }

    #[test]
    fn user_plugins_start_disabled_and_invalid_plugins_are_isolated() {
        let packaged = tempdir().unwrap();
        fs::write(packaged.path().join("runtime.js"), "window.order=[]").unwrap();
        extension(packaged.path(), "built-in", 10);
        let user = tempdir().unwrap();
        extension(user.path(), "custom-one", 20);
        fs::create_dir_all(user.path().join("broken")).unwrap();
        fs::write(user.path().join("broken").join("manifest.json"), "{").unwrap();

        let disabled = ExtensionLoader::load_with_user(
            packaged.path(),
            Some(user.path()),
            &HashSet::new(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(disabled.loaded_ids(), &["built-in"]);
        assert!(disabled
            .plugins()
            .iter()
            .any(|plugin| plugin.id == "custom-one" && !plugin.enabled));
        assert!(disabled
            .plugins()
            .iter()
            .any(|plugin| plugin.error.is_some()));

        let enabled = ExtensionLoader::load_with_user(
            packaged.path(),
            Some(user.path()),
            &HashSet::new(),
            &HashMap::from([("custom-one".to_string(), true)]),
        )
        .unwrap();
        assert!(enabled.loaded_ids().contains(&"custom-one".to_string()));
        assert!(enabled
            .injection_script()
            .contains("__JSTREMIO_PLUGIN_STYLES__"));
    }
}
