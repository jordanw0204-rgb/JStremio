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

## Public release channel

Stable releases are published from the public [`jordanw0204-rgb/JStremio`](https://github.com/jordanw0204-rgb/JStremio) repository. This lets an installed copy query the latest-release endpoint and download a verified installer without storing a GitHub credential. GitHub secret scanning and push protection are enabled on the repository.

If the repository is ever made private, renamed, or replaced with a release-only repository, update both release constants in `updater/src/lib.rs` and `setup/installed-channel.json` before publishing the next version. Never embed a maintainer token in JStremio.

## Signing

Current artifacts are intentionally named `-unsigned`. Windows SmartScreen can warn until a code-signing certificate is configured as a protected release secret. Never commit certificate files or passwords.
