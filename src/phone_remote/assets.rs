use super::model::PhoneRemoteError;
use std::{fs, path::Path, sync::Arc};

const MAX_ASSET_BYTES: u64 = 512 * 1024;

#[derive(Clone)]
pub(crate) struct RemoteAssets {
    pub html: Arc<[u8]>,
    pub javascript: Arc<[u8]>,
    pub css: Arc<[u8]>,
}

impl RemoteAssets {
    pub fn load(directory: &Path) -> Result<Self, PhoneRemoteError> {
        Ok(Self {
            html: read_fixed_asset(directory, "index.html")?,
            javascript: read_fixed_asset(directory, "app.js")?,
            css: read_fixed_asset(directory, "styles.css")?,
        })
    }
}

fn read_fixed_asset(directory: &Path, name: &str) -> Result<Arc<[u8]>, PhoneRemoteError> {
    let path = directory.join(name);
    let metadata = fs::metadata(&path).map_err(|_| PhoneRemoteError::AssetsUnavailable)?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES {
        return Err(PhoneRemoteError::AssetsUnavailable);
    }
    let bytes = fs::read(path).map_err(|_| PhoneRemoteError::AssetsUnavailable)?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err(PhoneRemoteError::AssetsUnavailable);
    }
    Ok(Arc::from(bytes))
}
