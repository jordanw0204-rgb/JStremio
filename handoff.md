# JStremio handoff

Updated: 2026-07-16  
Repository: `D:\Dev\JStremio`

## Read this first

This repository is no longer the abandoned attempt to rebuild Stremio's web frontend. It is a Windows desktop fork of the official `stremio-shell-ng` that loads the official `https://web.stremio.com/` application and adds a constrained local extension layer around it. Official Stremio account login, library/add-on synchronization, bundled streaming server, and native MPV playback remain in use.

The original web-frontend prototype was archived and must not be restored as the active architecture. The current design is the closest practical equivalent to a Spicetify/Vencord-style customization system without modifying an installed official Stremio binary in place.

Start a new chat by reading, in order:

1. `D:\Dev\AGENTS.md`
2. this file
3. `README.md`
4. `IMPLEMENTATION_PLAN.md`
5. `docs/architecture.md`
6. `docs/testing.md`
7. `.taskmaster/tasks/tasks.json`, or query Task Master directly

Use CodeGraph before structural code exploration. A persistent project overview is available at `.codex/project-overview/project-overview.md`; it was refreshed on 2026-07-16 and indexed 542 files with no source changes detected.

## Current Git state

- Branch: `feature/jstremio-extensions`
- Upstream: `origin/feature/jstremio-extensions`
- Latest release tag: `v1.3.0` (use `git log -1` for the current commit)
- Working tree was clean immediately before this handoff was created. Resumed work on 2026-07-16 added the expected uncommitted handoff/testing/check-script changes plus a dedicated JStremio icon wired into the executable and installer.
- Current application version: `1.3.0`
- Pinned shell upstream: `Stremio/stremio-shell-ng` release `v5.0.23`
- Pinned upstream commit: `5b1f341dbd9e1959f824436c70aa7410c159f684`
- Observed official web build: `b6298c68d27602564ed16edd0f44aa09cd8bacb4` on 2026-07-10
- Pin/archive details are in `upstream.lock.json`.

Recent commits:

```text
f375699 feat: add exact-stream LastPlayed resume
e7d6f22 feat: add local plugin platform
0870bd9 feat: group local media entries by title
2a9797c fix: repair timestamp note management
906da98 feat: add timestamp frame thumbnails
b6c46db fix: clamp timestamp popovers
6724160 fix: improve dense timestamp marker picker
c13eeff fix: isolate dialog keys and fullscreen markers
dc65582 fix: refine extension control styling
3b5392f feat: polish timestamp marker interactions
45fd79c fix: keep player extensions outside React ownership
d46611c fix: discover current Stremio player controls
```

## What is implemented

### Shell and extension platform

- Official Stremio Web UI loaded inside the official Rust/WebView2 shell design.
- Official bundled streaming server and native MPV player retained.
- A manifest-driven extension loader injects only local packaged or trusted user extensions.
- Fixed, origin-gated IPC operations expose only the capabilities each extension needs; there is no generic filesystem, command, network, or MPV bridge.
- Independent extension enablement is persisted locally.
- Safe mode can disable all extensions or named extensions.
- JStremio has an isolated identity, WebView2 profile, server directory, data directory, and installer AppId, so it can coexist with official Stremio.

### Local Reviews

- Reviews navigation item with an icon matching the official navigation geometry/style.
- Private local 1-5 rating and text review editor.
- Player-level review action for the current movie or episode.
- Collection view grouped by movie/series, then drill-down to movie/episode entries.
- Search, edit, delete, restart persistence, accessible dialog behavior, and failure isolation.
- Review actions are designed never to change playback state or stream selection.

### Timestamp Notes

- Add a note at the current playback timestamp.
- Optional color, 1-5 rating, and local native-video-frame thumbnail.
- Notes are grouped by title in the management view while retaining episode-specific metadata.
- Timeline markers are rendered on the official player seek bar.
- Nearby markers cluster into a picker; individual and clustered markers support hover/focus details.
- Clicking a timestamp seeks through the constrained player adapter.
- Create, edit, delete, search, thumbnail replacement/cleanup, enlarged thumbnail viewer, and restart persistence.
- Marker layout follows WebView/fullscreen/viewport changes, hides with immersed controls, and avoids blocking the official seek bar.
- Live, external, or insufficiently identified playback is rejected with an explanation.

### Plugins manager

- Plugins navigation item and management screen.
- Built-in extensions can be toggled independently; the required manager is protected.
- Trusted local plugins can be discovered from `%LOCALAPPDATA%\JStremio\plugins`.
- User plugins are disabled by default and execute as trusted local code when explicitly enabled.
- A starter plugin exists at `templates/hello-plugin`.
- A native restart action applies enablement changes cleanly.

### LastPlayed

- Stores the exact selected add-on stream for watched media using validated local descriptors/fingerprints.
- Adds resume behavior to Continue Watching cards.
- Promotes and labels a matching prior source in stream selection.
- Re-enters playback through official Stremio navigation/player paths instead of opening its own player.
- Version 1.0.1 records only a stream proven active by a fresh MPV snapshot on the matching player route, keeps its control compact in the current direct-anchor stream DOM, and resolves renewed debrid URLs by stable saved description lines before using the matched row's fresh official route.

## Important implementation locations

```text
src/extensions/                 Native extension manifests/settings/discovery
src/storage/mod.rs              Shared atomic, versioned JSON storage
src/bridge.rs                   Fixed origin-gated native IPC
src/reviews/                    Reviews model and store
src/timestamp_notes/            Timestamp-note model and store
src/last_played/                LastPlayed model and store
src/stremio_app/                Pinned official shell integration

web/src/runtime/                Browser runtime, lifecycle, adapters, bridge
web/src/extensions/reviews/     Reviews UI and behavior
web/src/extensions/timestamp-notes/
                                Timestamp UI, markers, playback resume logic
web/src/extensions/plugin-manager/
                                Plugins manager UI
web/src/extensions/last-played/ LastPlayed browser integration

web/tests/                      Vitest and Playwright coverage
scripts/                        Check, development, E2E, and packaging commands
docs/                           Architecture, testing, privacy, plugins, maintenance
setup/JStremio.iss              Optional unsigned installer definition
artifacts/                      Generated portable releases
```

## Local data and privacy

All feature data stays under `%LOCALAPPDATA%\JStremio`:

```text
data\reviews.json
data\timestamp-notes.json
data\last-played.json
data\plugins.json
data\timestamp-thumbnails\
plugins\
webview2\
server\
```

Private review/note text must never be added to logs, telemetry, URL parameters, official Stremio state, or network requests. Preserve atomic writes, backup/corruption handling, validation caps, and the narrow IPC allowlist. Do not commit a real `%LOCALAPPDATA%\JStremio` profile or user data.

## Task Master status

Task Master tag: `master`

- Total: 25
- Done: 22
- Review: 3
- Pending/in progress/blocked: 0
- Reported completion: 88%

Tasks 1-10 and 13-24 are done. Tasks 11, 12, and 25 remain in review:

### Task 25 - Ship one-click installer, versioned releases, and safe auto-updater

The v1.3.0 code, versioning/release scripts, branded single-EXE installer, updater, local HTTP staging test, final artifacts, clean install, same-version upgrade, shortcut/relaunch proof, and protected-file hash comparison are complete. Production anonymous updates remain gated on a repository visibility decision: the existing GitHub repository is private, so either make it public or point the updater at a new public release-only repository. Never embed a maintainer GitHub token in the app.

### Task 11 - Add checks, fixtures, and real-shell regression workflow

The scripts, legal deterministic fixtures, automated WebView2/CDP checks, and regression records exist. The remaining release gate is primarily human playback/audio confirmation on the target Windows device:

- Sign in and verify the account, library, and add-ons.
- Play generated/local H.264/AAC plus another MPV-supported format.
- Confirm time/duration progression, ordinary seek, marker seek, pause/resume, subtitles, fullscreen, and next episode.
- Confirm an audio track is present, mute is false, volume is nonzero, and sound is actually audible to a human.
- Repeat the same build with extensions enabled and `--disable-extensions`.
- Confirm review/note actions do not change stream, audio track, subtitle selection, mute, or volume.
- If the same media/device fails in the pinned unmodified baseline, do not attribute the failure to extensions and do not sign off the release.

### Task 12 - Package and document JStremio

Portable packaging and documentation exist. Before marking this done, perform and record:

- Portable launch against a clean JStremio profile.
- First-login behavior.
- Review, note, thumbnail, plugin toggle, and LastPlayed persistence after a full restart.
- Safe-mode launch and rollback behavior.
- Coexistence while official Stremio is installed/running.
- Confirm no file/protocol associations or official profile are claimed.
- Optional unsigned installer smoke if the installer is going to be distributed.
- Verify final artifact hash and packaged manifest after any rebuild.

Do not mark Tasks 11 or 12 done just because automated tests pass; their remaining checks include human/device and clean-profile acceptance.

## Verification commands

Run from `D:\Dev\JStremio`:

```powershell
.\scripts\check.ps1
.\scripts\test-e2e.ps1
.\scripts\run-dev.ps1
.\scripts\package-portable.ps1 -Zip
.\scripts\package-installer.ps1
```

`check.ps1` is the main automated gate. It runs Rust formatting, clippy, tests, strict TypeScript checks/unit tests, deterministic browser bundles, Playwright fixtures in Edge, and an optimized x64 compile.

The most recent documented automated evidence is in `docs/testing.md`. On 2026-07-16 the full `check.ps1` gate passed 40 native tests, strict TypeScript checking with 16 unit tests, four Playwright scenarios, deterministic bundles, and the optimized x64 compile. The gate now calls the existing `test:e2e` package script because pinned `pnpm exec playwright test` did not resolve the installed Windows shim in this environment. Earlier real WebView2, MPV/CDP, IPC restart, safe-mode, server-isolation, and privacy evidence remains dated 2026-07-10/11.

Safe-mode commands:

```powershell
.\target\release\JStremio.exe --disable-extensions
.\target\release\JStremio.exe --disable-extension reviews
.\target\release\JStremio.exe --disable-extension timestamp-notes
```

## Current packaged artifacts

```text
Path:   installer\JStremioSetup-v1.3.0_x64-unsigned.exe
Size:   70,667,814 bytes
SHA256: 7BC87BAD4D21997D520EDD50A32F574703459DEB75EEB732C7A33FC90D13160A

Path:   artifacts\JStremio-1.3.0-windows-x64-portable.zip
Size:   92,107,476 bytes
SHA256: 35DDD49EFE1B9DF88D65D5A8A16CDD94D951F91ABEAAA345058B71B78CBFE882
```

These hashes apply only to the current artifacts. Recompute them after any package rebuild.

## Architecture constraints that must not regress

- Do not return to maintaining a complete fork of `stremio-web`.
- Do not patch the user's installed official Stremio application in place.
- Do not replace official account/login, add-on, library, streaming-server, or MPV behavior.
- Do not route video through a normal browser `<video>` element or a new proxy/transcoding layer.
- Do not add generic filesystem, arbitrary command, arbitrary network, or general MPV APIs to the browser bridge.
- Keep extension DOM integration centralized in the compatibility adapter; expect official hashed CSS classes and markup to change.
- Keep extension UI idempotent and resilient to React route remounts without mutating React-owned nodes in unsafe ways.
- Preserve independent feature failure isolation and `--disable-extensions` recovery.
- Treat local plugins as explicitly trusted code and keep them disabled by default.
- Preserve JStremio's separate `%LOCALAPPDATA%\JStremio` profile and identity.

## Prototype archive

The old full-web-frontend prototype is preserved for reference only:

```text
Branch: archive/web-prototype-2026-07-10
Tag:    web-prototype-archive-2026-07-10
Commit: 424cb93b3574a0bf6f57ae138b654eaace148a28
Bundle: D:\Dev\JStremio-web-prototype-archive-2026-07-10-final.bundle
SHA256: 2B0F7BBFA438456B985346D0D5BDC62118566A3DE5D8E06789358FA30E24D5F4
```

Do not switch the working branch to this archive unless the user explicitly asks to inspect the abandoned prototype.

## Recommended next action

Resolve Task 25's release-channel visibility, then continue Tasks 11 and 12:

1. Make the existing release repository public or configure a public release-only repository, then publish v1.3.0 and verify an anonymous latest-release request exposes the installer digest.
2. Use the current v1.3.0 installer/portable hashes recorded above.
3. Complete the enabled-versus-safe-mode real playback and audible-audio checklist on the user's actual Windows output device.
4. Complete the remaining clean-profile/restart/coexistence acceptance work.
5. Record objective results in `docs/testing.md` and Task Master.
6. Mark Tasks 11, 12, and 25 done only after every remaining acceptance item is proven.

If the user instead asks for a new feature, first query CodeGraph for the relevant runtime/extension/native bridge flow and assess the blast radius before editing. Use Context7 only when current third-party library/API documentation is relevant, and use Playwright plus focused native/unit tests for verification.
