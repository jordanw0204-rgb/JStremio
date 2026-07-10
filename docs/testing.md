# Testing and verification

## Stable commands

```powershell
.\scripts\check.ps1
.\scripts\test-e2e.ps1
.\scripts\package-portable.ps1 -Zip
```

`check.ps1` runs Rust formatting/clippy/tests, TypeScript typecheck/unit tests, deterministic bundles, Playwright fixtures in installed Edge, and an optimized x64 compile.

## Automated evidence from 2026-07-10

- Unmodified `v5.0.23`: 10 native tests and optimized x64 build passed.
- JStremio native layer: 29 tests passed, including first write, Windows replacement/backup, malformed/unsupported preservation, concurrency, abandoned temps, validation, CRUD, UUIDs, manifests, origins, fixed IPC, and the pinned shell handshake.
- TypeScript: strict typecheck and 12 unit tests passed, including the current official focusable-`div` controls and layered-slider fixture.
- Playwright: Reviews CRUD/privacy, both-extension dedup/remount, body-level control ownership, timestamp capture, owned pause/resume, clustering, marker positioning/seeking, and pointer-transparent layer passed.
- Real WebView2 enabled: official URL plus dynamic server URL, frozen runtime, one Reviews item, and one Timestamp Notes item.
- Real official-player CDP smoke: generated H.264/AAC playback plus valid episode metadata produced both visible player buttons in the body-owned dock; the body-owned marker layer matched the live seek slider's left, top, and width with no extension console failures.
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
