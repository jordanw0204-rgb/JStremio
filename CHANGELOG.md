# Changelog

JStremio follows Semantic Versioning. Stable releases are tagged `vMAJOR.MINOR.PATCH` and published through GitHub Releases.

## 1.3.0 - 2026-07-16

- Add a one-click, per-user Windows installer with JStremio branding, desktop and Start Menu shortcuts, built-in plugins, WebView2 bootstrap support, and post-install launch.
- Add a background stable-release checker and verified installer staging. Updates require GitHub's SHA-256 digest and exact asset size before prompting.
- Preserve the Stremio account/profile, installed account addons, JStremio settings/data, and custom plugins across upgrades.
- Add repeatable version, release-package, checksum, and GitHub release automation.
- Add a versioned empty required-addon manifest ready for the future approved addon list.

## 1.2.0

- Add the LastPlayed built-in plugin with exact logical stream resume.

## 1.1.0

- Add the trusted local plugin platform and Plugins manager.

## 1.0.0

- Initial JStremio shell release with Local Reviews and Timestamp Notes.
