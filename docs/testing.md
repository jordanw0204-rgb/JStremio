# Testing and verification

## Stable commands

```powershell
.\scripts\check.ps1
.\scripts\test-e2e.ps1
.\scripts\package-portable.ps1 -Zip
```

`check.ps1` runs Rust formatting/clippy/tests, TypeScript typecheck/unit tests, deterministic bundles, Playwright fixtures in installed Edge, and an optimized x64 compile.

## Automated evidence from 2026-07-17

The v1.4.0 configurable-plugin-hotkey release gate passed on Windows:

- The full `check.ps1` gate passed Rust formatting and clippy with warnings denied, all 44 native tests, strict TypeScript with all 20 unit tests, all five installed-Edge Playwright scenarios, deterministic extension bundles, all updater tests, and the optimized x64 app/updater builds.
- Native tests prove backward-compatible loading of the existing plugin settings document, canonical hotkey persistence, clearing, duplicate-binding rejection, unsafe-key rejection, and the fixed `plugins/getHotkeys` / `plugins/setHotkey` bridge contract.
- Browser unit tests cover physical-key-code normalization, display labels, validation, and safe context suppression. Playwright proves the Reviews and Timestamp Notes controls cannot retain focus or activate from Arrow, Enter, Space, or programmatic keyboard-style clicks while real pointer clicks still work.
- The Plugins manager exposes Settings only for Local Reviews and Timestamp Notes. Playwright records `Ctrl+Shift+R` and `Ctrl+Alt+N`, rejects a cross-plugin conflict, suppresses configured hotkeys while an editable field owns input, and proves each binding opens the same corresponding player dialog as a pointer click.
- Inno Setup built `JStremioSetup-v1.4.0_x64-unsigned.exe` at 70,676,177 bytes with SHA-256 `58DEE3E0D109CC6FE3BAAA75A793E71EB60041AFC94D32D9A82D1AC3AA6D84FF`. The portable ZIP is 92,127,754 bytes with SHA-256 `00E375C01892076DB5DC86D9C1CB60BF4367D63E6315919248A55F21C073AD86`.
- A real per-user installer run upgraded the installed application to product/file version 1.4.0, returned exit code 0, preserved all nine files already present under the protected `data` and custom `plugins` trees byte-for-byte, and relaunched a responding JStremio process.
- The public repository remained public, changed-file credential-pattern scanning found no candidate secrets, and GitHub secret scanning reported zero open alerts before publication.

## Automated evidence from 2026-07-16

The v1.3.0 installer/updater gate passed on Windows:

- The expanded full gate passed Rust formatting and clippy with warnings denied, all 41 native tests, strict TypeScript with all 16 unit tests, all four installed-Edge Playwright scenarios, deterministic bundles, and both optimized x64 binaries.
- The standalone updater passed three selection/integrity unit tests plus a local HTTP end-to-end test. The integration test served GitHub-shaped release JSON and a mock Windows installer, then proved semantic-version selection, exact asset naming, trusted loopback test policy, declared-size enforcement, PE signature validation, SHA-256 verification, atomic staging, and verified-cache reuse without a second download.
- Inno Setup 6.7.3 compiled the branded per-user installer with all four built-in plugin directories, native MPV/server dependencies, WebView2 bootstrap support, Start Menu and default desktop shortcuts, update helper, installed-channel metadata, and the empty future-addon manifest.
- A real clean per-user install created both shortcuts, installed JStremio and its updater under `%LOCALAPPDATA%\Programs\JStremio`, bundled four plugin directories, and launched installed v1.3.0.
- A real same-version `/JSTREMIOUPDATE=1` upgrade completed successfully and relaunched v1.3.0. Before/after SHA-256 comparison found zero changes and zero additions across all nine existing files under the protected `data` and custom `plugins` trees.
- Final artifacts: `JStremioSetup-v1.3.0_x64-unsigned.exe`, 70,667,814 bytes, SHA-256 `7BC87BAD4D21997D520EDD50A32F574703459DEB75EEB732C7A33FC90D13160A`; `JStremio-1.3.0-windows-x64-portable.zip`, 92,107,476 bytes, SHA-256 `35DDD49EFE1B9DF88D65D5A8A16CDD94D951F91ABEAAA345058B71B78CBFE882`.
- The repository was subsequently made public and its anonymous latest-release endpoint became the production update source; no GitHub credential is embedded.

Earlier v1.2.0 evidence follows for the LastPlayed/icon work included in this release.

The full `check.ps1` release gate passed on Windows after changing its browser-test invocation to the existing `test:e2e` package script. The prior `corepack pnpm@11.0.0 exec playwright test` form did not resolve the installed Playwright shim in this environment, while package-script execution supplied the correct local binary path.

- Rust formatting and clippy passed with warnings denied.
- All 40 native tests passed.
- Strict TypeScript checking and all 16 unit tests passed.
- All four Playwright scenarios passed in installed Edge.
- Deterministic extension bundles rebuilt successfully.
- The optimized x64 release build completed successfully.
- pnpm reported a non-fatal failure while checking online update metadata; the frozen locked install itself reported `Already up to date` and the complete gate passed.
- After the dedicated icon and LastPlayed 1.0.1 fixes, `JStremio-1.2.0-windows-x64-portable.zip` was rebuilt at 92,099,895 bytes with SHA-256 `BF0BE52D2740255CB1700D373718A9D9E457B9BD1ACDC5C3C3E42CE1C18692C4`.
- Windows successfully extracted the new icon from both the release executable and the packaged executable; the `.ico` contains 16, 24, 32, 48, 64, 128, and 256-pixel layers.
- LastPlayed 1.0.1 passed a current-profile WebView2/CDP regression on `series:tt2741602:5:15`: its control rendered at 224x34 pixels inside the 434-pixel stream panel, both stable saved description lines matched one refreshed stream row, clicking used that row's current official route instead of the changed saved URL, native MPV reported a duration, playback position advanced, and the proven active refreshed route was persisted before the smoke paused playback.
- The LastPlayed Playwright regression now covers browsing without playback, unrelated player-link decoys, current direct-anchor stream-list markup, refreshed-route fingerprint matching, compact placement, row promotion/labeling, and navigation through the matched current route.
- Every packaged runtime and extension file in the v1.2.0 portable directory matched the current built resources byte-for-byte.

This automated evidence does not replace the manual playback, audible-output, clean-profile, restart-persistence, safe-mode, or coexistence acceptance checks below. Tasks 11 and 12 remain in review until those checks are completed on the target Windows desktop.

## Automated evidence from 2026-07-10

The 2026-07-11 LastPlayed release passed 40 native tests, strict TypeScript checking with 16 unit tests, and four Playwright scenarios. New coverage verifies validated exact-stream persistence, torrent/direct-URL fingerprints, the native restart control, Continue Watching hover resume, exact stream promotion and labeling, and navigation through the stored official player route.

- Unmodified `v5.0.23`: 10 native tests and optimized x64 build passed.
- JStremio native layer: 37 tests passed, including first write, Windows replacement/backup, malformed/unsupported preservation, concurrency, abandoned temps, validation, persisted plugin enablement, disabled-by-default user-plugin discovery, malformed-plugin isolation, backward-compatible note customization, constrained native-frame thumbnail capture and replacement cleanup, CRUD, UUIDs, manifests, origins, fixed IPC, and the pinned shell handshake.
- TypeScript: strict typecheck and 14 unit tests passed, including the current official focusable-`div` controls, copied navigation presentation layers, immersed-player signal, and layered-slider fixture.
- Playwright: Plugins sidebar deduplication, built-in inventory, required-manager protection, persisted toggle and restart messaging, Reviews CRUD/privacy, movie/series collection grouping and drill-down for Reviews and Timestamp Notes, Back navigation, episode-specific detail rows, centered Reviews close control, Shadow DOM typing isolation from Stremio shortcuts, official navigation color/geometry and hover-only labels, extension dedup/remount, fully transparent body-level control hover reveal, timestamp capture, edit-time thumbnail replacement, larger management thumbnails and the accessible enlarged-image viewer, deletion without WebView2 script dialogs, optional frame thumbnails in marker popovers, pinned click-popover positioning, owned pause/resume, paused shell-fullscreen marker realignment, color/rating create-edit persistence, centered SVG close control, outside/Escape/X dismissal, immersed marker hiding, clustering, marker positioning/seeking, and pointer-transparent layer passed.
- Real WebView2 enabled: official URL plus dynamic server URL, frozen runtime, one Reviews item, and one Timestamp Notes item.
- Real official-player CDP smoke: generated H.264/AAC playback plus valid episode metadata produced both player buttons, kept timestamp typing from changing the owned paused state, persisted a custom marker color/rating, kept marker geometry aligned through shell fullscreen while paused, dismissed the popover outside and through its close button, hid marker UI while immersed, revealed the fully transparent pointer-active dock on hover, matched the official main-navigation button/icon geometry, color, and hover label, and reported no extension console failures.
- Real WebView2 safe mode: the exact same official/dynamic URL with no runtime or extension nodes.
- Bundled server isolation: `APP_PATH` resolved under the isolated `%LOCALAPPDATA%\JStremio\server` tree while official Stremio remained active on its own ports.
- Real native IPC: one Review and one Timestamp Note were created, found again after a full restart, and stored under the isolated JStremio data directory.
- Privacy sentinel: absent from real-shell logs and observed browser network requests.

## Manual playback sign-off

Automated checks cannot prove audible output on a person's selected Windows device. Before distributing a release, run the same portable build enabled and with `--disable-extensions`, then record:

- account login and library/add-ons;
- local/generated H.264/AAC plus another MPV-supported format;
- time and duration progression;
- Stremio seek and marker seek;
- pause/resume, subtitles, fullscreen, and next episode;
- audio track present, mute false, unchanged nonzero volume;
- audible sound by a human;
- no change to stream/audio/subtitle selection after review or note actions.

Do not sign off or publish if the unmodified pinned baseline fails the same media/device test.
