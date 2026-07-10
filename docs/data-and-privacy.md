# Data, recovery, and privacy

## Documents

Reviews use `reviews.json`; timestamp notes use `timestamp-notes.json`. Both documents contain `schemaVersion`, an incrementing `revision`, and a feature-specific array. Reviews use stable `<mediaType>:<videoId>` IDs. Timestamp notes use native UUIDs and also store the stable media key, absolute integer milliseconds, and duration observed at creation.

Review text is optional and limited to 5,000 Unicode characters. Timestamp-note text is required after trimming and has the same limit. Native validation repeats every browser-side check.

## File safety

Each store owns a mutex. A mutation reads and validates the primary file, writes a UUID-named temporary file in the same directory, flushes it, creates a known-good `.bak` from the previous validated primary, and uses Windows `ReplaceFileW` with write-through semantics. The first write uses a same-volume rename. Abandoned temp files are ignored.

Malformed, oversized, duplicate-ID, or unsupported-schema primary files are not overwritten. Use **Open data folder**, close JStremio, and recover from the `.bak` or an external backup. JStremio does not silently replace a bad primary with its backup.

## Privacy boundary

Text is sent only through the local WebView2 host channel and written to the fixed JStremio data directory. It is not placed in URLs, logs, Stremio APIs, add-on calls, analytics, or crash reports. Native errors use content-free codes/messages. Automated fixture and real-shell probes use sentinel text to verify network and log absence.

The WebView2 profile contains ordinary Stremio login/session data and should be protected like a browser profile. It is separate from official Stremio and is never included in portable packages.
