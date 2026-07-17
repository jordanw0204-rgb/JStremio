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

The generic runtime does not expose filesystem access, network requests, arbitrary native commands, or arbitrary MPV properties. The Reviews and Timestamp Notes native namespaces remain fixed internal product APIs rather than a general plugin privilege surface.

## Recovery

Use `JStremio.exe --disable-extensions` if a plugin prevents normal startup. Then remove or disable the plugin and restart normally. CLI `--disable-extension <id>` remains available for one-off troubleshooting.
