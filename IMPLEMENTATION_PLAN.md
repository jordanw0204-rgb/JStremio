# JStremio extension loader implementation plan

JStremio is a minimal Windows fork of `stremio-shell-ng`. It continues to load the official `https://web.stremio.com/` application and preserves the bundled streaming server, WebView2 transport, and native MPV player. It adds an origin-gated local extension runtime and two independently enabled packaged extensions: Local Reviews and Timestamp Notes.

The product does not rebuild `stremio-web`, proxy media, replace the player, expose generic filesystem/MPV APIs, patch an installed Stremio executable, or share the official Stremio profile. `--disable-extensions` restores stock shell behavior.

## Implementation sequence

1. Preserve the prior Web UI prototype on an archive branch, dated tag, and verified external bundle.
2. Pin and build the newest verified stable shell release without changes; record its official Web UI build and native startup evidence.
3. Add strict local manifests, deterministic TypeScript bundles, a separate WebView2 profile, safe mode, origin-gated injection, lifecycle cleanup, and debug-only CDP.
4. Add shared, versioned JSON storage with serialized operations, bounded validation, same-directory temporary writes, flush, Windows-safe replacement, one known-good backup, and corruption-preserving errors.
5. Add fixed Reviews and Timestamp Notes IPC operations. No request accepts a path, command, URL fetch, or arbitrary MPV property.
6. Add the frozen, idempotent `window.JStremio` runtime, centralized Stremio compatibility adapter, MPV observation, validated seek/pause adapter, Shadow DOM overlay/dialog host, and one debounced DOM reconciler.
7. Implement Reviews navigation, management overlay, current-media player button, accessible 1–5 rating editor, and persistent CRUD.
8. Implement Timestamp Notes navigation, search/management overlay, capture-before-pause workflow, conditional resume, accessible editor, current-media marker overlay, clustering, tooltips/popovers, and click-to-seek.
9. Test malformed storage, missing core/shell signals, live/unknown-duration/external playback, DOM replacement, extension failure, IPC timeout, out-of-range timestamps, privacy, and safe mode.
10. Produce a separate portable JStremio package, then an optional unsigned installer, with update, rollback, backup/import, SmartScreen, and GPL documentation.

## Required data and browser contracts

- Reviews: `%LOCALAPPDATA%\JStremio\data\reviews.json`.
- Timestamp notes: `%LOCALAPPDATA%\JStremio\data\timestamp-notes.json`.
- Browser profile: `%LOCALAPPDATA%\JStremio\webview2`.
- Reviews operations: `health`, `list`, `get`, `upsert`, `delete`, `openDataFolder`.
- Timestamp operations: `health`, `listAll`, `listForMedia`, `get`, `create`, `update`, `delete`, `openDataFolder`.
- Playback observation: `time-pos`, `duration`, `pause`, and `seeking` MPV property-change events.
- Playback control: validated `time-pos` and `pause` writes only, issued through Stremio's existing `mpv-set-prop` message.

Notes use UUIDs assigned by native code, integer absolute milliseconds, required trimmed text up to 5,000 Unicode characters, and a duration snapshot. They are never rescaled for alternate cuts. Out-of-range notes stay manageable but are not drawn on the current timeline.

## Completion gate

Completion requires independent extension enablement, stock safe mode, restart-persistent CRUD, correct current-video markers and clustering, non-blocking normal seek behavior, graceful unsupported playback, preserved corrupt files, local-only private text, unchanged volume/mute/audio/subtitle/stream behavior, native playback and audible audio with extensions both disabled and enabled, a separate updater/profile/product identity, and no Stremio Web source modification.
