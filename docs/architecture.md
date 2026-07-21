# Architecture

JStremio is a small fork of the native Windows shell, not a fork or local replacement of Stremio Web.

```text
https://web.stremio.com/ (unchanged)
       |
       v
JStremio WebView2 shell ---- bundled Stremio server
       |
       +---- native MPV (existing Stremio messages)
       |
       +---- origin-gated runtime
               |---- Plugin Manager --- plugins.json / user plugins
               |---- Themes ----------- themes.json
               |---- Local Reviews ---- reviews.json
               |---- Timestamp Notes -- timestamp-notes.json
               |---- LastPlayed ------- last-played.json
               |---- BegoneMouse ------ plugins.json
               `---- Quick Seek ------- guarded player seek API
```

## Native boundary

`src/extensions` validates schema-v1 manifests, rejects absolute/traversing/remote paths, applies file/count caps, sorts by load order and ID, and composes the runtime before plugin bundles. Production combines built-ins from `resources/extensions` beside the executable with explicitly enabled user plugins under `%LOCALAPPDATA%\JStremio\plugins`. User plugins begin disabled, invalid folders are isolated, duplicate IDs cannot override built-ins, and settings changes apply after restart. `--extensions-dir` and loopback CDP work only in debug builds. `--disable-extensions` constructs no plugin host.

Web messages retain Stremio's existing `{id,args}` envelope. Custom messages are handled only when the sender and current top-level document have the same approved HTTP(S) origin. Fixed namespaces expose Reviews, Timestamp Notes, LastPlayed, Themes, and narrow plugin-manager operations. No generic path, command, key/value, or MPV bridge exists.

The native updater trigger was removed. The app name, pipe, window settings directory, bundled-server cache/settings path, WebView2 profile, executable, installer AppId, and local data directory are JStremio-specific.

## Browser boundary

`window.JStremio` is defined once per document and is frozen with frozen sub-APIs. One `MutationObserver` debounces reconciliation. Extension-owned surfaces use a Shadow DOM host; small navigation/player/timeline integration nodes are marked with `data-jstremio-*` attributes and remount idempotently. Player buttons and timeline markers live in body-level overlays positioned against the discovered controls, so React cannot delete them while reconciling its own child lists.

The validated saved theme is serialized into the origin-gated document-start injection ahead of the browser runtime. It overrides Stremio's published root color variables and one body-gradient rule before the application root paints. The branding adapter changes only the official `/images/stremio_symbol.png` image source, preserves the upstream element/link/layout, and reapplies the local icon after React remounts or source resets.

The compatibility adapter owns upstream assumptions. It prefers roles/accessible names, known Library/Calendar hrefs, neighboring controls, and slider structure. Feature code does not contain CSS-module hashes.

MPV property events are observed alongside Stremio's listener. `time-pos` and `duration` seconds become integer milliseconds; pause and seeking remain booleans. Media changes reset the snapshot. The public player API can set only `time-pos` and `pause`, validates the current media, clamps seeks to duration, and requires browser user activation for seeking.

## Extension behavior

Reviews never call the player API. Timestamp capture reads the latest position before pausing, records the media and duration, and conditionally resumes only a pause it owns on the same media without a manual pause-state change.

LastPlayed observes the selected player stream, persists its exact official player deep link and stream fingerprint, and augments visual media cards plus stream-selection surfaces without modifying Stremio React code. Series-level cards choose the most recently saved episode; exact video links prefer their exact entry. Hover details reuse only the saved add-on/stream description. Resume actions navigate through Stremio's existing player route; they do not reconstruct or substitute a source.

BegoneMouse observes pointer position and activity and reuses Stremio's own overlay-hidden state, with a narrow fallback selector for player controls while the upstream class name is being learned. Its validated decimal-millisecond delay is stored with plugin settings; Quick Seek hover and the responsive bottom player band are protected from idle hiding. Quick Seek renders body-level themed controls, mirrors compact controls around the official Play control, and reads two independently validated local seek durations. It uses the runtime's user-activation-guarded player seek operation and cannot issue arbitrary MPV properties or commands.

Markers are current-media-only, pointer-transparent outside explicit buttons, positioned against the current duration, hidden when out of range, and clustered within approximately ten physical pixels. Absolute timestamps are never ratio-scaled for alternate cuts.
