# Installation, safe mode, and rollback

## Portable build

Extract the portable ZIP to a user-writable directory and run `JStremio.exe`. The first launch uses a new WebView2 profile, so sign into the same Stremio account once. Account, library, and add-on synchronization still use official Stremio services.

The portable directory does not contain reviews, timestamp notes, bundled-server cache/settings, login state, or the WebView2 profile. Those stay under `%LOCALAPPDATA%\JStremio`.

## Unsigned installer

The optional installer has a JStremio-specific AppId and installs under the current user's Programs directory. It does not claim `stremio:`, magnet, torrent, or media-file associations. Unless a code-signing certificate is supplied outside this repository, Windows SmartScreen may warn about an unknown publisher.

## Rollback

1. Launch the same build with `--disable-extensions`.
2. If the shell itself regressed, close it and run the prior portable directory.
3. Keep the JSON data files in place unless a documented schema migration says otherwise.
4. To remove JStremio, delete the portable directory. Delete `%LOCALAPPDATA%\JStremio` only if reviews, notes, login/profile, and settings are no longer needed.

Official Stremio is not patched, updated, uninstalled, or profiled by JStremio.
