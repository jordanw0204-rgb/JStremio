use anyhow::{anyhow, bail, Context, Result};
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use url::Url;

pub const RELEASE_API_URL: &str =
    "https://api.github.com/repos/jordanw0204-rgb/JStremio/releases/latest";
const RELEASE_DOWNLOAD_PREFIX: &str = "/jordanw0204-rgb/JStremio/releases/download/";
const MAX_INSTALLER_BYTES: u64 = 750 * 1024 * 1024;
const MIN_INSTALLER_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
    pub digest: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub html_url: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SelectedUpdate {
    pub version: Version,
    pub release_url: String,
    pub notes: String,
    pub asset_name: String,
    pub download_url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StagedUpdate {
    pub selected: SelectedUpdate,
    pub installer_path: PathBuf,
}

pub fn select_update(
    release: GitHubRelease,
    current_version: &Version,
) -> Result<Option<SelectedUpdate>> {
    if release.draft || release.prerelease {
        return Ok(None);
    }
    let version_text = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let version =
        Version::parse(version_text).context("latest release tag is not semantic versioning")?;
    if version <= *current_version {
        return Ok(None);
    }

    let expected_name = format!("JStremioSetup-v{version}_x64-unsigned.exe");
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == expected_name)
        .ok_or_else(|| anyhow!("latest release is missing {expected_name}"))?;
    if !(MIN_INSTALLER_BYTES..=MAX_INSTALLER_BYTES).contains(&asset.size) {
        bail!("release installer size is outside the accepted range");
    }
    let digest = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .ok_or_else(|| anyhow!("release installer has no GitHub SHA-256 digest"))?
        .to_ascii_lowercase();
    if digest.len() != 64 || !digest.bytes().all(|value| value.is_ascii_hexdigit()) {
        bail!("release installer SHA-256 digest is invalid");
    }

    Ok(Some(SelectedUpdate {
        version,
        release_url: release.html_url,
        notes: release.body,
        asset_name: asset.name,
        download_url: asset.browser_download_url,
        size: asset.size,
        sha256: digest,
    }))
}

pub fn check_and_stage(
    api_url: &str,
    current_version: &Version,
    updates_directory: &Path,
    allow_loopback_test: bool,
) -> Result<Option<StagedUpdate>> {
    validate_api_url(api_url, allow_loopback_test)?;
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15 * 60)))
        .user_agent(format!("JStremioUpdater/{}", env!("CARGO_PKG_VERSION")))
        .build();
    let agent: ureq::Agent = config.into();
    let mut response = agent
        .get(api_url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .context("GitHub release check failed")?;
    let release: GitHubRelease = response
        .body_mut()
        .read_json()
        .context("GitHub release response was invalid")?;
    let Some(selected) = select_update(release, current_version)? else {
        return Ok(None);
    };
    validate_download_url(&selected.download_url, allow_loopback_test)?;

    let version_directory = updates_directory.join(selected.version.to_string());
    fs::create_dir_all(&version_directory)
        .context("could not create the update staging directory")?;
    let installer_path = version_directory.join(&selected.asset_name);
    if installer_path.is_file()
        && verify_installer(&installer_path, selected.size, &selected.sha256).is_ok()
    {
        return Ok(Some(StagedUpdate {
            selected,
            installer_path,
        }));
    }
    let _ = fs::remove_file(&installer_path);

    let partial_path = version_directory.join(format!(
        ".{}.{}.part",
        selected.asset_name,
        std::process::id()
    ));
    let download_result = download_installer(&agent, &selected, &partial_path)
        .and_then(|_| verify_installer(&partial_path, selected.size, &selected.sha256));
    if let Err(error) = download_result {
        let _ = fs::remove_file(&partial_path);
        return Err(error);
    }
    fs::rename(&partial_path, &installer_path)
        .context("could not finalize the staged installer")?;
    Ok(Some(StagedUpdate {
        selected,
        installer_path,
    }))
}

fn download_installer(
    agent: &ureq::Agent,
    selected: &SelectedUpdate,
    destination: &Path,
) -> Result<()> {
    let response = agent
        .get(&selected.download_url)
        .header("Accept", "application/octet-stream")
        .call()
        .context("release installer download failed")?;
    let (_, body) = response.into_parts();
    let mut reader = body.into_reader();
    let mut file = File::create(destination).context("could not create the staged installer")?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut written = 0_u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .context("release installer download was interrupted")?;
        if read == 0 {
            break;
        }
        written = written.saturating_add(read as u64);
        if written > selected.size || written > MAX_INSTALLER_BYTES {
            bail!("release installer exceeded its declared size");
        }
        file.write_all(&buffer[..read])
            .context("could not write the staged installer")?;
    }
    file.flush()
        .context("could not flush the staged installer")?;
    file.sync_all()
        .context("could not sync the staged installer")?;
    if written != selected.size {
        bail!("release installer size did not match GitHub metadata");
    }
    Ok(())
}

pub fn verify_installer(path: &Path, expected_size: u64, expected_sha256: &str) -> Result<()> {
    let metadata = fs::metadata(path).context("staged installer metadata is unavailable")?;
    if metadata.len() != expected_size {
        bail!("staged installer size is invalid");
    }
    let mut file = File::open(path).context("staged installer could not be opened")?;
    let mut signature = [0_u8; 2];
    file.read_exact(&mut signature)
        .context("staged installer is truncated")?;
    if signature != *b"MZ" {
        bail!("staged installer is not a Windows executable");
    }
    let actual = hash_reader(File::open(path).context("staged installer could not be hashed")?)?;
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        bail!("staged installer SHA-256 did not match GitHub metadata");
    }
    Ok(())
}

fn hash_reader(mut reader: impl Read) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .context("could not hash staged installer")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_api_url(value: &str, allow_loopback_test: bool) -> Result<()> {
    if value == RELEASE_API_URL {
        return Ok(());
    }
    let parsed = Url::parse(value).context("release API URL is invalid")?;
    if allow_loopback_test
        && matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(is_loopback_host)
    {
        return Ok(());
    }
    bail!("release API URL is not trusted")
}

fn validate_download_url(value: &str, allow_loopback_test: bool) -> Result<()> {
    let parsed = Url::parse(value).context("release download URL is invalid")?;
    let production = parsed.scheme() == "https"
        && parsed.host_str() == Some("github.com")
        && parsed.path().starts_with(RELEASE_DOWNLOAD_PREFIX);
    let test = allow_loopback_test
        && matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(is_loopback_host);
    if production || test {
        Ok(())
    } else {
        bail!("release download URL is not trusted")
    }
}

fn is_loopback_host(value: &str) -> bool {
    value.eq_ignore_ascii_case("localhost") || value == "127.0.0.1" || value == "::1"
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tempfile::tempdir;

    fn release(version: &str, size: u64, digest: &str) -> GitHubRelease {
        GitHubRelease {
            tag_name: format!("v{version}"),
            html_url: format!("https://github.com/jordanw0204-rgb/JStremio/releases/tag/v{version}"),
            body: "Release notes".into(),
            draft: false,
            prerelease: false,
            assets: vec![ReleaseAsset {
                name: format!("JStremioSetup-v{version}_x64-unsigned.exe"),
                browser_download_url: format!(
                    "https://github.com/jordanw0204-rgb/JStremio/releases/download/v{version}/JStremioSetup-v{version}_x64-unsigned.exe"
                ),
                size,
                digest: Some(format!("sha256:{digest}")),
            }],
        }
    }

    #[test]
    fn selects_only_a_newer_stable_release_with_exact_asset() {
        let digest = "a".repeat(64);
        assert!(select_update(
            release("1.3.0", MIN_INSTALLER_BYTES, &digest),
            &Version::parse("1.2.0").unwrap()
        )
        .unwrap()
        .is_some());
        assert!(select_update(
            release("1.2.0", MIN_INSTALLER_BYTES, &digest),
            &Version::parse("1.2.0").unwrap()
        )
        .unwrap()
        .is_none());
        let mut prerelease = release("1.4.0", MIN_INSTALLER_BYTES, &digest);
        prerelease.prerelease = true;
        assert!(select_update(prerelease, &Version::parse("1.2.0").unwrap())
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_missing_digest_wrong_asset_and_unsafe_urls() {
        let digest = "b".repeat(64);
        let mut missing = release("1.3.0", MIN_INSTALLER_BYTES, &digest);
        missing.assets[0].digest = None;
        assert!(select_update(missing, &Version::parse("1.2.0").unwrap()).is_err());
        let mut wrong = release("1.3.0", MIN_INSTALLER_BYTES, &digest);
        wrong.assets[0].name = "other.exe".into();
        assert!(select_update(wrong, &Version::parse("1.2.0").unwrap()).is_err());
        assert!(validate_api_url("https://evil.invalid/latest", false).is_err());
        assert!(validate_download_url("https://evil.invalid/setup.exe", false).is_err());
        assert!(validate_api_url("http://127.0.0.1:1234/release", true).is_ok());
    }

    #[test]
    fn verifies_size_pe_signature_and_sha256() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("setup.exe");
        let mut bytes = vec![0_u8; 4096];
        bytes[0..2].copy_from_slice(b"MZ");
        File::create(&path).unwrap().write_all(&bytes).unwrap();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        verify_installer(&path, bytes.len() as u64, &digest).unwrap();
        assert!(verify_installer(&path, bytes.len() as u64 + 1, &digest).is_err());
        assert!(verify_installer(&path, bytes.len() as u64, &"0".repeat(64)).is_err());
    }
}
