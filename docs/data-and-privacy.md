# Data, recovery, and privacy

## Documents

Reviews use `reviews.json`; timestamp notes use `timestamp-notes.json`. Both documents contain `schemaVersion`, an incrementing `revision`, and a feature-specific array. Reviews use stable `<mediaType>:<videoId>` IDs. Timestamp notes use native UUIDs and also store the stable media key, absolute integer milliseconds, duration observed at creation, an optional `#RRGGBB` marker color, and an optional 1–5 rating. Existing schema-v1 notes without color or rating remain valid and use the default teal marker.

Review text is optional and limited to 5,000 Unicode characters. Timestamp-note text is required after trimming and has the same limit. Marker colors must use six-digit hexadecimal notation and ratings, when present, must be integers from 1 through 5. Native validation repeats every browser-side check.

## File safety

Each store owns a mutex. A mutation reads and validates the primary file, writes a UUID-named temporary file in the same directory, flushes it, creates a known-good `.bak` from the previous validated primary, and uses Windows `ReplaceFileW` with write-through semantics. The first write uses a same-volume rename. Abandoned temp files are ignored.

Malformed, oversized, duplicate-ID, or unsupported-schema primary files are not overwritten. Use **Open data folder**, close JStremio, and recover from the `.bak` or an external backup. JStremio does not silently replace a bad primary with its backup.

## Privacy boundary

Text is sent only through the local WebView2 host channel and written to the fixed JStremio data directory. It is not placed in URLs, logs, Stremio APIs, add-on calls, analytics, or crash reports. Native errors use content-free codes/messages. Automated fixture and real-shell probes use sentinel text to verify network and log absence.

The WebView2 profile contains ordinary Stremio login/session data and should be protected like a browser profile. It is separate from official Stremio and is never included in portable packages.

The bundled streaming server stores its cache and settings under `%LOCALAPPDATA%\JStremio\server`, separate from official Stremio's server state. Neither that directory nor the WebView2 profile is included in portable packages.

## Local plugin trust boundary

The privacy guarantees above apply to JStremio's built-in code. An enabled user plugin is trusted JavaScript executing in the same WebView as Stremio and the JStremio runtime. It can inspect page state, call browser networking, and invoke exposed fixed bridges, including reading locally stored review or note data. Review user-plugin source before enabling it. Safe mode prevents all plugin injection, and no remote marketplace or automatic downloader is included.
