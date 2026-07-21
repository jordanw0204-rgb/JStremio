mod manifest;
mod settings;

pub use manifest::{ExtensionLoader, ManifestError, PluginDescriptor};
pub use settings::{PluginSettingsStore, PreferredAudioDevice};

use crate::bridge::{BridgeResponse, NativeBridge};
use crate::themes::ThemeStore;
use serde_json::Value;
use std::{collections::HashSet, path::Path, sync::Arc};
use url::Url;

pub const MAX_CUSTOM_MESSAGE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct OriginPolicy {
    approved: Arc<HashSet<String>>,
}

impl OriginPolicy {
    pub fn new(allow_staging: bool, allow_loopback: bool) -> Self {
        let mut approved = HashSet::from(["https://web.stremio.com".to_string()]);
        if allow_staging {
            approved.insert("https://staging.strem.io".into());
        }
        if allow_loopback {
            approved.extend([
                "http://127.0.0.1:11470".into(),
                "http://localhost:11470".into(),
            ]);
        }
        Self {
            approved: Arc::new(approved),
        }
    }

    pub fn allows(&self, source: &str, top_level_source: &str) -> bool {
        let source_origin = normalized_origin(source);
        let top_level_origin = normalized_origin(top_level_source);
        matches!((source_origin, top_level_origin), (Some(source), Some(top)) if source == top && self.approved.contains(&source))
    }

    pub fn allows_top_level(&self, source: &str) -> bool {
        normalized_origin(source)
            .map(|origin| self.approved.contains(&origin))
            .unwrap_or(false)
    }
}

pub struct ExtensionHost {
    loader: ExtensionLoader,
    bridge: NativeBridge,
    origins: OriginPolicy,
    injection_script: Arc<str>,
}

impl ExtensionHost {
    pub fn load(
        extensions_directory: &Path,
        user_plugins_directory: &Path,
        data_directory: &Path,
        disabled_ids: &HashSet<String>,
        origins: OriginPolicy,
    ) -> Result<Self, ManifestError> {
        let overrides = PluginSettingsStore::new(data_directory)
            .overrides()
            .unwrap_or_default();
        let loader = ExtensionLoader::load_with_user(
            extensions_directory,
            Some(user_plugins_directory),
            disabled_ids,
            &overrides,
        )?;
        let early_theme = ThemeStore::new(data_directory)
            .get()
            .unwrap_or_default()
            .startup_script()
            .unwrap_or_default();
        let injection_script =
            Arc::<str>::from(format!("{early_theme}{}", loader.injection_script()));
        let bridge = NativeBridge::new_with_plugins(
            data_directory,
            user_plugins_directory,
            loader.plugins().to_vec(),
        );
        Ok(Self {
            loader,
            bridge,
            origins,
            injection_script,
        })
    }

    pub fn loaded_ids(&self) -> &[String] {
        self.loader.loaded_ids()
    }

    pub fn injection_script_for(&self, top_level_source: &str) -> Option<&str> {
        self.origins
            .allows_top_level(top_level_source)
            .then(|| self.injection_script.as_ref())
    }

    pub fn handle_bridge_message(
        &self,
        method: &str,
        request_id: u64,
        params: Option<&Value>,
        raw_message_bytes: usize,
        source: &str,
        top_level_source: &str,
    ) -> Option<BridgeResponse> {
        if !NativeBridge::supports(method) || !self.origins.allows(source, top_level_source) {
            return None;
        }
        if raw_message_bytes > MAX_CUSTOM_MESSAGE_BYTES {
            return Some(NativeBridge::error(
                method,
                request_id,
                "message_too_large",
                "The request exceeds the native message limit.",
            ));
        }
        Some(self.bridge.handle(method, request_id, params))
    }
}

fn normalized_origin(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::OriginPolicy;

    #[test]
    fn only_matching_approved_top_level_origins_are_allowed() {
        let policy = OriginPolicy::new(false, false);
        assert!(policy.allows(
            "https://web.stremio.com/player",
            "https://web.stremio.com/#/player"
        ));
        assert!(!policy.allows("https://evil.invalid/frame", "https://web.stremio.com/"));
        assert!(!policy.allows("https://staging.strem.io/", "https://staging.strem.io/"));
    }
}
