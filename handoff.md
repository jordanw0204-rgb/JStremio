# JStremio handoff

Updated: 2026-07-29
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

Use CodeGraph before structural code exploration. A persistent project overview is available at `.codex/project-overview/project-overview.md`; it was refreshed on 2026-07-29 and indexed 1,942 files.

## Current Git state

- Branch: `feature/jstremio-extensions`
- Upstream: `origin/feature/jstremio-extensions`
- Public repository: `https://github.com/jordanw0204-rgb/JStremio`
- Latest release tag: `v1.11.3` (release commit `5f1baab`; use `git log -1` for the current branch commit)
- Current application version: `1.11.3`
- Pinned shell upstream: `Stremio/stremio-shell-ng` release `v5.0.23`
- Pinned upstream commit: `5b1f341dbd9e1959f824436c70aa7410c159f684`
- Observed official web build: `b6298c68d27602564ed16edd0f44aa09cd8bacb4` on 2026-07-10
- Pin/archive details are in `upstream.lock.json`.

Recent commits:

```text
5f1baab release: publish JStremio v1.11.3
4a6c3d1 release: prepare v1.10.1
5fa3c79 release: publish spoiler and review compatibility v1.10.0
b178a13 feat: add player quality-of-life plugins
2695a68 release: add interactive player workflows and themed title bar
f44a42d fix: relocate Quick Seek after player bar mounts
9c71907 fix: mount Quick Seek controls in player bar
55f0f8b release: add BegoneMouse and configurable Quick Seek
2545c53 docs: record v1.6.0 release verification
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
- The official in-web Stremio symbol is replaced idempotently with the embedded blue JStremio mark while preserving its existing navigation element and route behavior.

### Local Reviews

- Reviews navigation item with an icon matching the official navigation geometry/style.
- Private local 1-5 rating and text review editor.
- Player-level review action for the current movie or episode.
- Collection view grouped by movie/series, then drill-down to movie/episode entries.
- Search, edit, delete, restart persistence, accessible dialog behavior, and failure isolation.
- Review actions are designed never to change playback state or stream selection.
- The player action is pointer-click-only and cannot be selected or activated by Stremio's arrow/Enter/Space keyboard handling.
- An optional user-recorded hotkey opens the same validated current-media review dialog.

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
- The player action is pointer-click-only; an optional user-recorded hotkey opens the same validated timestamp-note capture flow.

### Plugins manager

- Plugins navigation item and management screen.
- Built-in extensions can be toggled independently; the required manager is protected.
- Trusted local plugins can be discovered from `%LOCALAPPDATA%\JStremio\plugins`.
- User plugins are disabled by default and execute as trusted local code when explicitly enabled.
- A starter plugin exists at `templates/hello-plugin`.
- A native restart action applies enablement changes cleanly.
- Local Reviews and Timestamp Notes cards expose Settings dialogs that record, validate, persist, clear, and apply per-plugin hotkeys immediately without a restart.
- Hotkeys are suppressed for editable fields, open JStremio dialogs, unavailable player actions, repeats/composition, unsafe navigation/playback keys, and duplicate bindings.

### Themes

- A dedicated Themes navigation page provides live color and gradient preview for the official Stremio interface.
- Users can configure gradient start/end, angle, accent, surface, and primary text colors or select Stremio, Midnight, Ocean, and Aurora presets.
- Validated settings persist atomically under JStremio's isolated profile, apply before the web application paints on startup, and survive official React route remounts.
- Save and Reset are explicit; closing with an unsaved preview restores the last saved palette.

### LastPlayed

- Stores the exact selected add-on stream for watched media using validated local descriptors/fingerprints.
- Adds a per-poster Last played action to every movie or series card with saved playback, including Continue Watching and ordinary catalog rows.
- Hover/focus details show the exact saved movie/episode, provider, stream name, full saved descriptor (including file size/seed information when the add-on supplied it), position, and save time without a network lookup.
- Card actions survive upstream poster remounts, remain scoped to individual posters in Stremio's wide scrolling rows, and use a body-level viewport-clamped tooltip so global overflow rules cannot clip it.
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
src/themes/                     Validated theme model, persistence, startup CSS
src/stremio_app/                Pinned official shell integration

web/src/runtime/                Browser runtime, lifecycle, adapters, bridge
web/src/extensions/reviews/     Reviews UI and behavior
web/src/extensions/timestamp-notes/
                                Timestamp UI, markers, playback resume logic
web/src/extensions/plugin-manager/
                                Plugins manager UI
web/src/extensions/last-played/ LastPlayed browser integration
web/src/extensions/themes/      Themes page and live-preview controls
web/src/runtime/branding.ts     Idempotent in-web JStremio mark replacement

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
data\themes.json
data\timestamp-thumbnails\
plugins\
webview2\
server\
```

Private review/note text must never be added to logs, telemetry, URL parameters, official Stremio state, or network requests. Preserve atomic writes, backup/corruption handling, validation caps, and the narrow IPC allowlist. Do not commit a real `%LOCALAPPDATA%\JStremio` profile or user data.

## Task Master status

Task Master tag: `master`

- Total: 31
- Done: 29
- Review: 2
- In progress: 0
- Pending/blocked: 0
- Reported completion: 94%

Tasks 1-10 and 13-31 are done. Tasks 11 and 12 remain in review.

Task 25 is complete. The repository is public, the v1.3.0 release exposes the installer, portable ZIP, and checksums anonymously, and the installer is labeled as the recommended download. The anonymous latest-release endpoint returns the expected installer size and GitHub SHA-256 digest. GitHub secret scanning and push protection are enabled with zero open alerts after a tracked-tree/history credential audit.

Task 26 is complete. Reviews and Timestamp Notes player controls are click-only, each plugin has a hotkey recorder in Plugins > Settings, canonical bindings persist through the constrained native bridge, and safe global handlers open the exact same validated dialog flows. The v1.4.0 clean-runner release, branch CI, and tag CI all passed; the public assets and anonymous update metadata were verified after publication.

Task 27 is complete. Universal per-poster LastPlayed actions, saved-source metadata tooltips, the persisted Themes page, and in-web JStremio branding shipped in v1.5.0. The full local gate, current-profile WebView2 smoke, byte-for-byte protected-profile upgrade check, branch CI, corrected tag CI, clean-runner release, public asset/checksum verification, direct installer HTTP check, and zero-open-secret-alert check all passed.

Task 28 is complete. v1.5.1 keeps the themed WebView transparent over native MPV on player routes and makes Reviews/Timestamp Notes target resolution monotonic within a route so continuous official-player DOM mutations cannot starve either control. The full local gate, range-backed real MPV/CDP smoke, exact protected-profile upgrade comparison, branch/tag CI, clean-runner release, public asset/checksum verification, direct installer HTTP check, and zero-open-secret-alert check all passed.

Task 29 is complete. v1.5.2 keeps WebView2/native MPV bounds synchronized through the real Win32 size/move/fullscreen lifecycle, hides page navigation explicitly during playback, and adds a bounded 15-second stall watchdog that reselects the active video track without changing the logical stream or playback position. The full local gate, error-free 20-cycle real MPV/fullscreen stress, OS-level decoded-frame capture, 12-file protected-profile comparison, branch/tag CI, clean-runner release, public asset/checksum verification, direct installer HTTP check, and zero-open-secret-alert check all passed.

Task 30 is complete. A real interrupted v1.11.3 upgrade proved the installer deleted `resources\extensions` before a locked DLL replacement could finish, causing the next launch to fall back to the plain Stremio UI. The matching portable resources restored all 55 files and 17 manifests without changing profile data; the installer now retains the old extension tree until transactional replacement and rejects the unsafe deletion rule during packaging.

Task 31 is complete. Release commit `5f1baab` is pushed and tagged `v1.11.3`; branch CI, tag CI, and release publication all passed. GitHub's anonymous latest-release endpoint returns the installer, portable ZIP, and checksum asset, and the checksum entries match GitHub's published SHA-256 digests.

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

The most recent documented automated evidence is in `docs/testing.md`. On 2026-07-29 the full v1.11.3 `check.ps1` gate passed 90 native tests, strict TypeScript checking with 89 browser unit tests, all 19 Playwright scenarios, deterministic bundles, updater tests, and optimized x64 app/updater builds. Release packaging produced a runtime plus all 17 extension manifests, and focused coverage proves the Intro & Credits control resolves across startup/route races even while player telemetry is not ready.

Safe-mode commands:

```powershell
.\target\release\JStremio.exe --disable-extensions
.\target\release\JStremio.exe --disable-extension reviews
.\target\release\JStremio.exe --disable-extension timestamp-notes
```

## Current packaged artifacts

```text
Path:   installer\JStremioSetup-v1.11.3_x64-unsigned.exe
Size:   71,783,189 bytes
SHA256: 6119C999BE0B72BCD4A8DC6A3344BDBA82103FB7F407AD16AFBED29B1014FA34

Path:   artifacts\JStremio-1.11.3-windows-x64-portable.zip
Size:   93,573,834 bytes
SHA256: 47D139CD5ED09EB78B80528EAAED5F3708F625B574F0A3DE74CAC1598020CAAF
```

These hashes apply only to the current artifacts. Recompute them after any package rebuild.

GitHub Actions rebuilt the public assets on a clean runner. The published installer is 71,778,596 bytes with SHA-256 `599C18750C786B36811AD6E443B3116C193DDC981EEA7417BD0EBDD94544BD76`; the portable ZIP is 93,569,997 bytes with SHA-256 `B534F22CC2B66986630D67463CDCE4B19DCF866AADEB995E2C8D1DB778AE347D`. The public `SHA256SUMS.txt` matches both GitHub asset digests.

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

Continue Tasks 11 and 12:

1. Use the current v1.5.2 installer/portable hashes recorded above.
2. Complete the enabled-versus-safe-mode real playback and audible-audio checklist on the user's actual Windows output device.
3. Complete the remaining clean-profile/restart/coexistence acceptance work.
4. Record objective results in `docs/testing.md` and Task Master.
5. Mark Tasks 11 and 12 done only after every remaining acceptance item is proven.

If the user instead asks for a new feature, first query CodeGraph for the relevant runtime/extension/native bridge flow and assess the blast radius before editing. Use Context7 only when current third-party library/API documentation is relevant, and use Playwright plus focused native/unit tests for verification.
