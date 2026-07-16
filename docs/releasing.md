# Versioning and releases

JStremio uses Semantic Versioning. `Cargo.toml` is the application version source; the updater package version must match it, and Inno Setup reads the compiled executable version.

## Prepare a version

```powershell
.\scripts\set-version.ps1 -Version 1.3.1
```

Update `CHANGELOG.md`, run the full release build, then commit and tag:

```powershell
.\scripts\build-release.ps1
git tag -a v1.3.1 -m "JStremio 1.3.1"
git push origin HEAD
git push origin v1.3.1
```

The tag workflow rebuilds and verifies the app, portable ZIP, and single-EXE installer; writes `SHA256SUMS.txt`; and attaches all three to a GitHub Release. The application queries only the latest non-draft, non-prerelease release. It requires the exact x64 installer asset name, GitHub's `sha256:` digest, an accepted size, and a trusted GitHub download path.

## Release-channel visibility

Anonymous update checks work only when the GitHub repository containing the releases is public. GitHub's latest-release endpoint requires repository read authentication for private resources. Do not embed a maintainer token in JStremio. If development source remains private, use a public release-only repository and update both constants in `updater/src/lib.rs` plus `setup/installed-channel.json` before publishing.

## Signing

Current artifacts are intentionally named `-unsigned`. Windows SmartScreen can warn until a code-signing certificate is configured as a protected release secret. Never commit certificate files or passwords.
