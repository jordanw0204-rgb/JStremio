# JStremio

JStremio is a Windows desktop build based on the official `stremio-shell-ng`. It still loads `https://web.stremio.com/`, starts Stremio's bundled streaming server, and uses native MPV for playback. A small, origin-gated loader injects two trusted local extensions without rebuilding Stremio Web:

- **Local Reviews** — private 1–5 ratings and optional review text.
- **Timestamp Notes** — private notes captured at an on-demand playback position, with customizable marker colors, optional 1–5 ratings, clustering, and click-to-seek.

Both stores are human-readable JSON under `%LOCALAPPDATA%\JStremio\data`. Their content is not synchronized or sent to Stremio. JStremio has its own executable, WebView2 profile, IPC pipe, local data, portable package, installer AppId, and updater policy, so it can coexist with official Stremio.

## Build and run

Prerequisites are Windows 10/11, WebView2 Runtime, stable Rust with the `x86_64-pc-windows-msvc` target, Node.js 22 or newer, and Corepack.

```powershell
.\scripts\check.ps1
.\scripts\run-dev.ps1
```

The development command builds the trusted extension bundles, then launches a debug shell with the local extension directory. Production uses packaged resources beside `JStremio.exe` and does not accept a development directory.

Create a portable directory and optional ZIP:

```powershell
.\scripts\package-portable.ps1 -Zip
```

The optional installer requires Inno Setup 6 and is intentionally unsigned:

```powershell
.\scripts\package-installer.ps1
```

## Safe mode and independent enablement

```powershell
.\JStremio.exe --disable-extensions
.\JStremio.exe --disable-extension reviews
.\JStremio.exe --disable-extension timestamp-notes
```

Safe mode does not load the runtime or extension code and leaves the official UI/shell behavior in place. Debug-only CDP and development extension flags are rejected by release builds.

## Local data

- Reviews: `%LOCALAPPDATA%\JStremio\data\reviews.json`
- Timestamp notes: `%LOCALAPPDATA%\JStremio\data\timestamp-notes.json`
- Backups: the matching `.bak` file after replacement
- Bundled server cache/settings: `%LOCALAPPDATA%\JStremio\server`
- WebView2 profile: `%LOCALAPPDATA%\JStremio\webview2`

Back up the JSON files while JStremio is closed. A malformed or unsupported file is preserved and reported rather than overwritten. To validate and import the earlier Web UI prototype's reviews:

```powershell
.\scripts\import-legacy-reviews.ps1 -Source D:\path\to\reviews.json
```

See [installation and rollback](docs/installation.md), [data and privacy](docs/data-and-privacy.md), [testing](docs/testing.md), and [architecture](docs/architecture.md).

## Verification status

Automated native, TypeScript, Playwright, real WebView2 injection, safe-mode, IPC, privacy-sentinel, and restart-persistence checks are documented in [testing](docs/testing.md). Final sign-off still requires a person to confirm account login, real native MPV video, and audible output on the target Windows audio device.

## Upstream and license

The pinned upstream release and exact commits are in `upstream.lock.json`. JStremio is GPL-2.0, matching the upstream shell. Distributed builds must include the license and make the corresponding modified source/build instructions available. Stremio and its upstream source remain owned by their respective copyright holders.
