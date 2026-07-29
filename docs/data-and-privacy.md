# Data, recovery, and privacy

## Documents

Reviews use `reviews.json`; timestamp notes use `timestamp-notes.json`. Both documents contain `schemaVersion`, an incrementing `revision`, and a feature-specific array. Reviews use stable `<mediaType>:<videoId>` IDs. Timestamp notes use native UUIDs and also store the stable media key, absolute integer milliseconds, duration observed at creation, an optional `#RRGGBB` marker color, and an optional 1–10 rating. Existing schema-v1 notes without color or rating remain valid and use the default teal marker.

Review text is optional and limited to 5,000 Unicode characters. Timestamp-note text is required after trimming and has the same limit. Marker colors must use six-digit hexadecimal notation and ratings, when present, must be integers from 1 through 10. Native validation repeats every browser-side check.

LastPlayed uses `last-played.json`. It stores the selected video's metadata, playback position, add-on label, stream fingerprint, and official Stremio player deep link. A deep link can contain a direct-stream URL or torrent identity supplied by an installed add-on. It remains local and is used only to reopen the exact source through Stremio's normal player route.

Themes use `themes.json`. The document stores five validated opaque `#RRGGBB` colors and a whole-number gradient angle from 0 through 360. It contains no account, playback, add-on, or media information. Theme settings are injected only into the local Stremio WebView and are never sent to an add-on or remote theme service.

Playback Statistics and Local Watch Journal share `playback-history.json`.
Sessions contain validated media identity, start/last-seen/end timestamps,
observed positions and duration, plausible active watch time, completion state,
and optional journal text, tags, and favorite status. Zero-watch player opens
are not persisted. Collection uses one shared writer even when both plugins are
enabled, checkpoints at most once per minute during continuous playback, and
also persists on pause or finalization. Paginated readers use a document
revision and restart if the history changes between pages.

Intro & Credits Skipper uses `skip-segments.json`. Credits shared across a
season or series retain their distance from the end, so different episode
durations do not rewrite the saved offset. Always-on-Top Mini Player uses
`mini-player.json` for validated screen bounds only; it contains no media data.

## File safety

Each store owns a mutex. A mutation reads and validates the primary file, writes a UUID-named temporary file in the same directory, flushes it, creates a known-good `.bak` from the previous validated primary, and uses Windows `ReplaceFileW` with write-through semantics. The first write uses a same-volume rename. Abandoned temp files are ignored.

Malformed, oversized, duplicate-ID, or unsupported-schema primary files are not overwritten. Use **Open data folder**, close JStremio, and recover from the `.bak` or an external backup. JStremio does not silently replace a bad primary with its backup.

History deletion is intentionally different from ordinary recovery writes.
Deleting an entry or choosing **Clear history** commits the privacy-sensitive
mutation without retaining the prior history in `playback-history.json.bak`;
clear also invalidates queued browser writes so the pre-clear active session
cannot be resurrected.

## Privacy boundary

Text is sent only through the local WebView2 host channel and written to the fixed JStremio data directory. It is not placed in URLs, logs, Stremio APIs, add-on calls, analytics, or crash reports. Native errors use content-free codes/messages. Automated fixture and real-shell probes use sentinel text to verify network and log absence.

The WebView2 profile contains ordinary Stremio login/session data and should be protected like a browser profile. It is separate from official Stremio and is never included in portable packages.

The bundled streaming server stores its cache and settings under `%LOCALAPPDATA%\JStremio\server`, separate from official Stremio's server state. Neither that directory nor the WebView2 profile is included in portable packages.

Phone Remote is opt-in and keeps pairing/session secrets in memory only. It
binds to one user-selected RFC1918 IPv4 interface, accepts an exact Host and
Origin, uses one-use pairing codes, and revokes connected sockets when stopped
or disconnected. Playback metadata and commands travel over plain local
HTTP/WebSocket, not TLS, so another party capable of observing an untrusted
network could read or replay a session. Use it only on a trusted home/private
network; JStremio never creates a Windows Firewall rule automatically.

## Local plugin trust boundary

The privacy guarantees above apply to JStremio's built-in code. An enabled user plugin is trusted JavaScript executing in the same WebView as Stremio and the JStremio runtime. It can inspect page state, call browser networking, and invoke exposed fixed bridges, including reading locally stored reviews, notes, playback history, or journal annotations. “Local” describes built-in storage behavior; it is not isolation from another enabled plugin. Review user-plugin source before enabling it. Safe mode prevents all plugin injection, and no remote marketplace or automatic downloader is included.

Plugin enablement overrides, optional hotkeys, player timing preferences, the preferred MPV audio-device name/description, the last volume level, and No Spoilers choices are stored in `%LOCALAPPDATA%\JStremio\data\plugins.json`. They contain no audio, browsing history, device telemetry, or typed text. Hotkeys are canonical key identifiers only and do not retain a keyboard history.
