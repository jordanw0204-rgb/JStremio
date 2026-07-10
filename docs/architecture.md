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
               |---- Local Reviews ---- reviews.json
               `---- Timestamp Notes -- timestamp-notes.json
```

## Native boundary

`src/extensions` validates local schema-v1 manifests, rejects absolute/traversing/remote paths, applies file/count caps, sorts by load order and ID, and composes the runtime before feature bundles. Production reads only `resources/extensions` beside the executable. `--extensions-dir` and loopback CDP work only in debug builds. `--disable-extensions` constructs no extension host.

Web messages retain Stremio's existing `{id,args}` envelope. Custom messages are handled only when the sender and current top-level document have the same approved HTTP(S) origin. Fixed namespaces expose only Reviews and Timestamp Notes operations. No generic path, command, network, key/value, or MPV bridge exists.

The native updater trigger was removed. The app name, pipe, window settings directory, bundled-server cache/settings path, WebView2 profile, executable, installer AppId, and local data directory are JStremio-specific.

## Browser boundary

`window.JStremio` is defined once per document and is frozen with frozen sub-APIs. One `MutationObserver` debounces reconciliation. Extension-owned surfaces use a Shadow DOM host; small navigation/player/timeline integration nodes are marked with `data-jstremio-*` attributes and remount idempotently. Player buttons and timeline markers live in body-level overlays positioned against the discovered controls, so React cannot delete them while reconciling its own child lists.

The compatibility adapter owns upstream assumptions. It prefers roles/accessible names, known Library/Calendar hrefs, neighboring controls, and slider structure. Feature code does not contain CSS-module hashes.

MPV property events are observed alongside Stremio's listener. `time-pos` and `duration` seconds become integer milliseconds; pause and seeking remain booleans. Media changes reset the snapshot. The public player API can set only `time-pos` and `pause`, validates the current media, clamps seeks to duration, and requires browser user activation for seeking.

## Extension behavior

Reviews never call the player API. Timestamp capture reads the latest position before pausing, records the media and duration, and conditionally resumes only a pause it owns on the same media without a manual pause-state change.

Markers are current-media-only, pointer-transparent outside explicit buttons, positioned against the current duration, hidden when out of range, and clustered within approximately ten physical pixels. Absolute timestamps are never ratio-scaled for alternate cuts.
