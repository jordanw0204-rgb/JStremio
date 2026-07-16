use std::{env, io, path::PathBuf};

pub const PRODUCT_DIRECTORY: &str = "JStremio";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppPaths {
    pub root: PathBuf,
    pub data: PathBuf,
    pub server: PathBuf,
    pub webview2: PathBuf,
    pub plugins: PathBuf,
    pub updates: PathBuf,
}

impl AppPaths {
    pub fn discover() -> io::Result<Self> {
        let local_app_data = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is unavailable")
            })?;
        Ok(Self::from_local_app_data(local_app_data))
    }

    pub fn from_local_app_data(local_app_data: PathBuf) -> Self {
        let root = local_app_data.join(PRODUCT_DIRECTORY);
        Self {
            data: root.join("data"),
            server: root.join("server"),
            webview2: root.join("webview2"),
            plugins: root.join("plugins"),
            updates: root.join("updates"),
            root,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppPaths;
    use std::path::PathBuf;

    #[test]
    fn paths_are_isolated_under_jstremio() {
        let paths = AppPaths::from_local_app_data(PathBuf::from(r"C:\Users\test\AppData\Local"));
        assert!(paths.root.ends_with("JStremio"));
        assert!(paths.data.ends_with(r"JStremio\data"));
        assert!(paths.server.ends_with(r"JStremio\server"));
        assert!(paths.webview2.ends_with(r"JStremio\webview2"));
        assert!(paths.plugins.ends_with(r"JStremio\plugins"));
        assert!(paths.updates.ends_with(r"JStremio\updates"));
    }
}
