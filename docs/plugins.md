# Local plugins

JStremio loads built-in plugins from its packaged resources and discovers user plugins under:

```text
%LOCALAPPDATA%\JStremio\plugins\<plugin-id>
```

Local plugins are trusted JavaScript. They execute inside the official Stremio WebView and can read or change anything visible to that page, access JStremio's browser runtime and fixed local-data bridges, and make browser network requests. Install code only after reviewing it and trusting its author. JStremio does not download plugins or provide a remote marketplace.

## Install a plugin

1. Open **Plugins** from JStremio's sidebar.
2. Choose **Open plugins folder**.
3. Copy a complete plugin folder into that directory. The portable package includes `templates\hello-plugin` as a starter.
4. Fully restart JStremio. Newly discovered user plugins are disabled by default.
5. Open **Plugins**, enable the plugin, and restart JStremio again.

Removing a user plugin means closing JStremio and deleting its folder. Its saved enablement override is harmless and is ignored while the plugin is absent.

## Built-in plugin settings

Local Reviews and Timestamp Notes expose a **Settings** button on their cards in the Plugins screen. Select the hotkey field and press a supported letter, number, function key, or combination using Ctrl, Alt, and Shift. Choose **Save** to apply it immediately; a restart is not required.

Bindings must be unique. Modifier-only, Windows-key, Alt-only, navigation, playback, and unsafe system combinations are rejected. A configured hotkey works only while that plugin's matching player action is available, and it is ignored while typing or while a JStremio overlay/dialog is open. Use **Clear hotkey** and save to remove a binding.

BegoneMouse exposes its own **Settings** button. Enter the number of milliseconds the pointer must remain idle before the player interface and cursor disappear. Values from 0 through 600,000 are accepted, including decimals such as `0.05`; browser timer scheduling means a sub-millisecond value is applied on WebView's next available timer tick. The change applies immediately without restarting. A stationary pointer over either Quick Seek control or within the responsive bottom player-control band keeps the interface visible.

Quick Seek exposes independent **Rewind seconds** and **Fast-forward seconds** settings from 0.05 through 3600 seconds. Changes apply immediately to the large video controls and the compact controls mounted on either side of Stremio's Play button. The line icons and hover state follow the active theme. Holding any seek control repeats the configured seek and accelerates in multiples of that amount until release. Every seek remains clamped to the beginning or known end of the video.

Easy Sound Output opens a themed device menu when you right-click the official player volume button. Left-click a listed device to switch immediately; right-click it and choose **Always use this Device to play sound** to make it the preferred playback output. Its Plugins settings show the saved device and can clear it.

QOL Things enables **Remember player volume** by default. The last observed volume is stored locally and restored after JStremio closes, reopens, or restarts. Disable the setting to leave future sessions at the player's own value.

No Spoilers can independently blur plot summaries and artwork, replace a configurable percentage of title characters with `*`, and confirm forward timeline jumps larger than the configured number of minutes. A blocked jump never changes playback until **Skip** is chosen in the themed confirmation dialog.

Custom Captions applies subtitle styling directly to the native MPV player and stores the validated settings in `plugins.json`. Its editor includes five presets plus font, size, screen position, text/outline/background/shadow colors and opacity, outline width, shadow offset, letter spacing, bold, italic, and embedded ASS-style handling. Changes apply live and persist across restarts.

Intro & Credits Skipper stores private local skip ranges and can reuse them for one episode, a season, or an entire series. Its player prompt appears only while the current range is active. Credits may be anchored to the end of the current cut, and every saved range can be reviewed or deleted from the plugin's editor.

Playback Statistics records plausible active playback and presents private watch-time trends, streaks, completions, and favorite titles. Local Watch Journal uses the same single playback tracker and history document to build an automatic watch diary with notes, tags, favorites, search, and deletion. Enabling both plugins does not write duplicate sessions.

Always-on-Top Mini Player shrinks the native JStremio window into a resizable topmost player. Leaving mini-player mode restores the previous window placement, topmost state, and fullscreen state.

Phone Remote starts only when requested from its plugin surface. It displays a one-use pairing code and serves a dependency-free phone controller to another device on the same private LAN. Remote commands are authenticated and tightly limited to playback controls. The connection is unencrypted HTTP/WebSocket traffic, so use it only on a network you trust and stop the server when finished.

Themes is a protected built-in surface rather than a downloadable theme plugin. Its fixed native operations persist only the validated palette described in [Themes](themes.md). Use the Themes sidebar button to customize the app; do not install custom JavaScript merely to change basic colors.

## Plugin structure

```text
my-plugin\
  manifest.json
  index.js
  styles.css
```

The schema-1 manifest is deliberately small:

```json
{
  "schemaVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "styles": "styles.css",
  "enabledByDefault": false,
  "loadOrder": 500,
  "description": "What the plugin does.",
  "author": "Your name"
}
```

IDs use lowercase ASCII letters, digits, and interior hyphens. Entry and stylesheet paths must be relative, remain inside the plugin folder, and end in `.js` and `.css`. Remote URLs, traversal, absolute paths, oversized files, duplicate IDs, and more than 32 user-plugin folders are rejected. One malformed user plugin is reported in the manager without blocking valid plugins.

## Runtime lifecycle

The entry script calls `window.JStremio.registerExtension(manifest, activate)`. `activate` receives the frozen runtime and may return a cleanup function. Always remove DOM nodes, styles, observers, and listeners in cleanup.

Useful stable APIs include:

- `runtime.lifecycle.onReconcile(callback)` for upstream React remounts.
- `runtime.lifecycle.onRouteChange(callback)` for hash-route changes.
- `runtime.stremio.getCurrentMediaTarget()` for validated movie/episode identity.
- `runtime.player.getSnapshot()` and `subscribe()` for read-only playback state.
- `runtime.ui.openOverlay()` and `openDialog()` for isolated Shadow DOM surfaces.
- `runtime.plugins.getStyles(pluginId)` for the validated packaged stylesheet.
- `runtime.diagnostics.report(pluginId, error)` for content-free errors.

The generic runtime does not expose filesystem access, arbitrary native commands, or arbitrary MPV properties. Reviews, Timestamp Notes, playback history, skip segments, mini-player window control, and Phone Remote use fixed internal product APIs rather than a general plugin privilege surface. Local plugins remain trusted page JavaScript and retain the browser network access described above.

## Recovery

Use `JStremio.exe --disable-extensions` if a plugin prevents normal startup. Then remove or disable the plugin and restart normally. CLI `--disable-extension <id>` remains available for one-off troubleshooting.
