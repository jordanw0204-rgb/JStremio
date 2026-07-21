# Testing and verification

## Stable commands

```powershell
.\scripts\check.ps1
.\scripts\test-e2e.ps1
.\scripts\package-portable.ps1 -Zip
```

`check.ps1` runs Rust formatting/clippy/tests, TypeScript typecheck/unit tests, deterministic bundles, Playwright fixtures in installed Edge, and an optimized x64 compile.

## Automated evidence from 2026-07-21 (v1.7.1)

The v1.7.1 Quick Seek bottom-bar compatibility patch passed on Windows:

- The complete `check.ps1` gate passed Rust formatting and Clippy with warnings denied, all 54 native tests, strict TypeScript, all 52 web unit tests, all 12 installed-Edge Playwright scenarios, every updater test, deterministic extension bundles, and optimized x64 app/updater builds.
- The compatibility regression reproduces Stremio's production hierarchy with an earlier top navigation `role="toolbar"` and proves player discovery selects the hashed bottom `control-bar-buttons-container` instead.
- Browser coverage proves rewind appears immediately before Play and fast-forward immediately after Play, neither button leaks into the top toolbar, and both return to the bottom bar after a React-style control-bar replacement.
- Inno Setup built `JStremioSetup-v1.7.1_x64-unsigned.exe` at 71,287,849 bytes with local SHA-256 `D4B49A1F64CA8BB8D7436FFEBADEC9887DA5972E0BE12FC9291D461FA1AEDFA0`. The local portable ZIP is 92,777,816 bytes with SHA-256 `BAD1874F6B1234E9A539281408AEE953BC1D369E5D10A596CCEF12E40A3AA3A1`.
- Packaging did not replace or restart the active installation: `%LOCALAPPDATA%\Programs\JStremio\JStremio.exe` remains product/file version 1.7.0.

## Automated evidence from 2026-07-21 (v1.7.0)

The v1.7.0 BegoneMouse and Quick Seek release gate passed on Windows:

- The complete `check.ps1` gate passed Rust formatting and Clippy with warnings denied, all 54 native tests, strict TypeScript, all 51 web unit tests, all 12 installed-Edge Playwright scenarios, every updater test, deterministic extension bundles, and optimized x64 app/updater builds.
- Browser coverage proves independently configurable decimal rewind/fast-forward durations apply live to reference-style themed controls over the video and on both sides of Stremio's Play control; controls survive upstream remounts, accelerate while held, stop on release, clamp to playback bounds, and do not obstruct Timestamp popovers.
- BegoneMouse coverage proves a stationary pointer over either Quick Seek control or anywhere in the responsive bottom player-control band prevents idle hiding, while movement back to unprotected video restores the configured deadline.
- Inno Setup built `JStremioSetup-v1.7.0_x64-unsigned.exe` at 71,295,221 bytes with local SHA-256 `E912AB3C6E345B1EC87078E73F0C39B5179F684CE30DFD798BE787D3322E5DDB`. The local portable ZIP is 92,777,294 bytes with SHA-256 `316D128C03C45AE41B5ABAD14B1DA4FFEE1CD5676593778A70538D366F3657C9`.
- The installed copy was deliberately not upgraded: `%LOCALAPPDATA%\Programs\JStremio\JStremio.exe` remains product/file version 1.6.0 so its automatic Update prompt can be verified against the published v1.7.0 release.

## Automated evidence from 2026-07-20 (v1.6.0)

The v1.6.0 themed in-shell plugin navigation and customization gate passed on Windows:

- The full `build-release.ps1` gate passed Rust formatting and clippy with warnings denied, all 50 native tests, strict TypeScript with all 44 unit tests, all 11 installed-Edge Playwright scenarios, deterministic extension bundles, all updater tests, and optimized x64 app/updater builds.
- Browser coverage proves Plugins, Themes, Local Reviews, and Timestamp Notes stay beside the official sidebar; all six official navigation controls regain the selected Stremio page; custom buttons survive upstream remounts; player actions remain immediately clickable during delayed state resolution; and all plugin frames use the saved theme.
- Native and browser coverage proves backward-compatible 1–10 review/note ratings, validated custom theme presets, the Crimson preset, coordinated marker swatches/hex entry/full color picker behavior, and the console-free Windows application subsystem.
- Inno Setup built `JStremioSetup-v1.6.0_x64-unsigned.exe` at 71,282,081 bytes with local SHA-256 `AED0A8A0C378D71D2A83EE014C955AD762EA6BB6EFC92E3D92C5559D183B0602`. The local portable ZIP is 92,756,907 bytes with SHA-256 `CDC617433BD061C9E325F3B91DABA40195A1374EE27A448D4EF5132964937C46`.
- A real per-user installer upgrade from v1.5.2 returned exit code 0, installed product/file version 1.6.0, matched all 16 installed extension/runtime files to the verified resources, retained both shortcuts, preserved all 13 existing data/settings/custom-plugin files byte-for-byte, and relaunched a responding JStremio window.
- Branch CI, exact-tag CI, and the clean-runner release workflow passed for release commit `c8583e5`. The anonymous latest-release endpoint returns stable v1.6.0 with the installer, portable ZIP, and checksum assets.
- Published clean-runner digests are `41C12D79EBCFC8A0C18CFB580B0E93B4EEC500D634C9D6FB9904014EA504FFB6` for the 71,281,711-byte installer and `B6266BFB55E554C5FD984406F4487A66F43024841428BC70C50D75DEF717F496` for the 92,752,125-byte portable ZIP. The public checksum file matches both GitHub asset digests.

## Automated evidence from 2026-07-18 (v1.5.2)

The v1.5.2 native-player surface lifecycle and automatic-recovery gate passed on Windows:

- The full `check.ps1` gate passed Rust formatting and clippy with warnings denied, all 49 native tests, strict TypeScript with all 30 unit tests, all nine installed-Edge Playwright scenarios, deterministic extension bundles, all updater tests, and optimized x64 app/updater builds.
- WebView2 now consumes the parent window's real `WM_SIZE`, move, DPI, and display messages, updates visibility across minimize/restore, and is also synchronously refit after fullscreen, maximize, resize-end, focus restore, tray restore, and splash removal.
- The player watchdog recovers only active, visible, unpaused player routes after 15 seconds without position progress. It is bounded to one video-track reselection until progress resumes and retains a 30-second cooldown; focused fake-timer tests cover recovery, pause suppression, route suppression, and teardown.
- A real WebView2/native-MPV stress ran 20 fullscreen/restore cycles (40 viewport transitions) against a local byte-range H.264/AAC stream. Every transition filled the current client viewport, both player extension controls stayed visible, page-navigation controls stayed hidden, native video-track recovery logged no error, playback advanced afterward, and an OS-level capture showed a decoded frame filling the client area with no gray bands or leaked sidebar.
- Inno Setup built `JStremioSetup-v1.5.2_x64-unsigned.exe` at 71,274,175 bytes with local SHA-256 `592F03F52D5CD776C4EF77D291A3E11F39707B330DB8ACD1CD22149B89FE305F`. The local portable ZIP is 92,733,553 bytes with SHA-256 `54B84B6E85E42971CB0FDE620B51F11382127B6D9E1FBFFBBBD34D947EC95E96`.
- A real per-user installer upgrade returned exit code 0, installed product/file version 1.5.2, matched the installed executable to the optimized release build, matched all 16 installed extension/runtime files to the verified resources, retained both shortcuts, and preserved all 12 existing settings/data/custom-plugin files byte-for-byte.
- Branch CI and exact-tag CI passed for release commit `cf7cf12`. The clean-runner release workflow published stable v1.5.2 with three public assets; the recommended installer returns anonymous HTTP 200 at exactly 71,271,619 bytes.
- Published clean-runner digests are `841404D5E470B6699AA1E27D70A93D04E878F31887D7587228F98B4EA9ED017F` for the installer and `3F6625FC3771F132C155AE841AF157B02D3830BAC4992DA0A58724165FB446B9` for the portable ZIP. The public checksum file matches both GitHub asset digests, the repository remains public, and secret scanning reports zero open alerts.

## Automated evidence from 2026-07-17 (v1.5.1)

The v1.5.1 native-player visibility and extension-control regression gate passed on Windows:

- The full `check.ps1` gate passed Rust formatting and clippy with warnings denied, all 48 native tests, strict TypeScript with all 28 unit tests, all nine installed-Edge Playwright scenarios, deterministic extension bundles, all updater tests, and optimized x64 app/updater builds.
- Theme tests prove the configured gradient remains active outside playback while `#/player/...` routes synchronously mark the document and force the WebView body transparent. The native early-startup injection and normal runtime application both cover initial player launches and later hash-route changes.
- A new mutation-churn Playwright regression changes upstream player DOM every 5 ms while media-target lookup is asynchronous. Reviews and Timestamp Notes still resolve, enable, remain the center-point hit targets, and open through real pointer clicks.
- A real WebView2/native-MPV smoke used a local 90-second H.264/AAC fixture from a byte-range-capable server. The native position advanced, a real frame thumbnail was captured, both controls were enabled and pointer-clickable, Reviews opened, Timestamp Notes saved, fullscreen/immersed marker behavior passed, the WebView player surface computed transparent, and both synthetic notes were removed afterward.
- Inno Setup built `JStremioSetup-v1.5.1_x64-unsigned.exe` at 71,271,483 bytes with local SHA-256 `AAE68872EC0E529105A8FC0E2D2E76E5B529BD3C49D1B6A57D69FD57C27234FE`. The local portable ZIP is 92,731,724 bytes with SHA-256 `EBA27F92109D64BDF80D2110A90AEF8BE40AD034F95EE40C401FA02DEEC5524A`.
- A real per-user installer run upgraded the existing installation to product/file version 1.5.1 with exit code 0. Before/after SHA-256 comparison found all 11 files under the protected `data` and custom `plugins` trees byte-for-byte identical, both desktop and Start-menu shortcuts remained present, and all 16 installed extension/runtime files matched the verified build byte-for-byte.
- Production releases intentionally reject remote-debugging ports, so CDP was unavailable on the installed binary by design. The real native-player CDP smoke used the same release-built resources in the debug shell; the subsequent installed-resource hash comparison proved the packaged extension/runtime payload was identical.
- Branch CI, tag CI, and the clean-runner release workflow all passed for commit `3275039`. The public latest-release endpoint returns stable v1.5.1 with three labeled assets, and the recommended installer's direct anonymous download returns HTTP 200 at the exact published size.
- Published clean-runner digests are `4C02A729F4DC82F99D9D5C4804E283E65F008F353E4F0A8912ADB3E5CC2D5DFA` for the recommended installer and `3FDDB91E96F6ED13C2E68641F2B815CC20A94230A3AC33DCCFF710C935DFDE4C` for the portable ZIP. The public checksum file matches both GitHub asset digests, the repository remains public, and secret scanning reports zero open alerts.

## Automated evidence from 2026-07-17 (v1.5.0)

The v1.5.0 universal LastPlayed, Themes, and in-app branding release gate passed on Windows:

- The full `check.ps1` gate passed Rust formatting and clippy with warnings denied, all 48 native tests, strict TypeScript with all 28 unit tests, all eight installed-Edge Playwright scenarios, deterministic extension bundles, all updater tests, and optimized x64 app/updater builds.
- Native coverage proves validated and atomic theme persistence/reset, official startup CSS-variable generation, the fixed theme bridge contract, and the existing constrained LastPlayed/plugin/storage contracts. Browser coverage proves theme validation, presets, live preview, save/reset, startup restoration, remount resilience, and rollback of an unsaved preview.
- LastPlayed card coverage proves exact movie/episode matching, newest-episode fallback for series cards, exclusion of navigation/text/player links, per-poster placement for Stremio's direct-child card rows, React-style poster remount survival, body-level unclipped metadata tooltips, and navigation through the exact saved official player route.
- A real current-profile WebView2 smoke found two played cards, verified a visible viewport-contained tooltip populated from the locally saved provider/stream descriptor, confirmed the embedded blue JStremio mark replaced the official symbol with no duplicate, and proved an unsaved theme preview reverted on close. This smoke also caught and drove the fix for Stremio's wide direct-child poster-row layout before release.
- Inno Setup built `JStremioSetup-v1.5.0_x64-unsigned.exe` at 71,263,613 bytes with local SHA-256 `6E262794A90B04C3D5DBA4143AD190CF33B494A2DA64198433B44EADA503414E`. The local portable ZIP is 92,730,453 bytes with SHA-256 `0F2E58EE6E43C5B16FF8AD7E271D7207CFE39E3432DA03FDF5F5A5F6794D7984`.
- A real per-user installer run upgraded the existing installation from v1.4.0 to product/file version 1.5.0 with exit code 0. Before/after SHA-256 comparison found all 11 files under the protected `data` and custom `plugins` trees byte-for-byte identical, and both desktop and Start-menu shortcuts remained present.
- Branch CI, corrected tag CI, and the clean-runner release workflow all passed for commit `a9ab019`. The initial tag run exposed an asynchronous-thumbnail timing assumption in an older pinned-popover test; the assertion was narrowed to its actual x/y-position contract, the full local Playwright suite passed again, the unpublished run was canceled, and every corrected clean-runner job passed.
- The public repository is still public and GitHub secret scanning reports zero open alerts. The anonymous latest-release endpoint returns stable v1.5.0, and the direct installer download returns HTTP 200.
- Published clean-runner digests are `BF2A933C82A1B5644262EDA1EA3C34524BF131AD2E05A5031AEDFBDDA3628BE0` for the recommended installer and `C4CFB8D847499417556E1065B25D1675ACACA53C1B1DDFC7CC45EB0CDBE9838B` for the portable ZIP. The anonymous checksum file matches both GitHub asset digests.

## Automated evidence from 2026-07-17 (v1.4.0)

The v1.4.0 configurable-plugin-hotkey release gate passed on Windows:

- The full `check.ps1` gate passed Rust formatting and clippy with warnings denied, all 44 native tests, strict TypeScript with all 20 unit tests, all five installed-Edge Playwright scenarios, deterministic extension bundles, all updater tests, and the optimized x64 app/updater builds.
- Native tests prove backward-compatible loading of the existing plugin settings document, canonical hotkey persistence, clearing, duplicate-binding rejection, unsafe-key rejection, and the fixed `plugins/getHotkeys` / `plugins/setHotkey` bridge contract.
- Browser unit tests cover physical-key-code normalization, display labels, validation, and safe context suppression. Playwright proves the Reviews and Timestamp Notes controls cannot retain focus or activate from Arrow, Enter, Space, or programmatic keyboard-style clicks while real pointer clicks still work.
- The Plugins manager exposes Settings only for Local Reviews and Timestamp Notes. Playwright records `Ctrl+Shift+R` and `Ctrl+Alt+N`, rejects a cross-plugin conflict, suppresses configured hotkeys while an editable field owns input, and proves each binding opens the same corresponding player dialog as a pointer click.
- Inno Setup built `JStremioSetup-v1.4.0_x64-unsigned.exe` at 70,676,177 bytes with SHA-256 `58DEE3E0D109CC6FE3BAAA75A793E71EB60041AFC94D32D9A82D1AC3AA6D84FF`. The portable ZIP is 92,127,754 bytes with SHA-256 `00E375C01892076DB5DC86D9C1CB60BF4367D63E6315919248A55F21C073AD86`.
- A real per-user installer run upgraded the installed application to product/file version 1.4.0, returned exit code 0, preserved all nine files already present under the protected `data` and custom `plugins` trees byte-for-byte, and relaunched a responding JStremio process.
- The public repository remained public, changed-file credential-pattern scanning found no candidate secrets, and GitHub secret scanning reported zero open alerts before publication.
- Branch CI, tag CI, and the clean-runner release workflow all passed for commit `9de70bb`. The anonymous latest-release API returned v1.4.0 with three labeled assets, and the direct installer download returned HTTP 200.
- Published clean-runner digests are `6D8F9A12C3D29D0CB4E236DFAEF20B5EB5AC066BDF3C7823BD38CFFAFF792A7B` for the installer and `D8350D87C6639421D52C27E7ED6C767428D7558708829443D2426A889BA52195` for the portable ZIP. The anonymous checksum file matched GitHub's asset digests.

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
