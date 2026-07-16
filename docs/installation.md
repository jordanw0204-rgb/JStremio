# Installation, safe mode, and rollback

## Portable build

Extract the portable ZIP to a user-writable directory and run `JStremio.exe`. The first launch uses a new WebView2 profile, so sign into the same Stremio account once. Account, library, and add-on synchronization still use official Stremio services.

The portable directory does not contain reviews, timestamp notes, bundled-server cache/settings, login state, or the WebView2 profile. Those stay under `%LOCALAPPDATA%\JStremio`.

## One-click unsigned installer

The single setup executable has a JStremio-specific AppId and installs under the current user's Programs directory without an administrator prompt. It creates desktop and Start Menu shortcuts by default, bundles the native player/server and built-in plugins, installs WebView2 when required, and opens JStremio after setup. It does not claim `stremio:`, magnet, torrent, or media-file associations. Unless a code-signing certificate is supplied outside this repository, Windows SmartScreen may warn about an unknown publisher.

Account addons cannot be installed before Stremio sign-in. The versioned `setup/default-addons.json` manifest is intentionally empty until an approved list is supplied; future provisioning must use Stremio's official addon-install confirmation rather than editing account state directly.

## Automatic updates

Installer builds include a small update helper. On launch it checks the latest stable GitHub Release in the background, downloads only the exact matching x64 setup asset, and verifies the GitHub SHA-256 digest, declared size, and Windows executable signature before showing **Update JStremio**. Choosing Update closes JStremio cleanly, runs the upgrade, and reopens it.

Program files live under `%LOCALAPPDATA%\Programs\JStremio`. Persistent state lives separately under `%LOCALAPPDATA%\JStremio`, so account/profile state, account addons, server settings, reviews, notes, LastPlayed data, plugin enablement, thumbnails, and custom plugins are not replaced. Portable packages omit the automatic updater because a portable extraction directory has no reliable installation boundary.

## Rollback

1. Launch the same build with `--disable-extensions`.
2. If the shell itself regressed, close it and run the prior portable directory.
3. Keep the JSON data files in place unless a documented schema migration says otherwise.
4. To remove JStremio, delete the portable directory. Delete `%LOCALAPPDATA%\JStremio` only if reviews, notes, login/profile, and settings are no longer needed.

Official Stremio is not patched, updated, uninstalled, or profiled by JStremio.
