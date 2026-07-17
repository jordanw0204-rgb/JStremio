# Themes

The built-in **Themes** page is available from the palette button in JStremio's main navigation. It can customize:

- the background gradient's start color, end color, and angle;
- the primary accent color;
- elevated surface and dialog colors;
- primary text and icon color.

Changes appear immediately in both the live preview and the Stremio interface. Select **Save theme** to keep the current palette, or **Reset to defaults** to restore Stremio's standard colors. The Stremio, Midnight, Ocean, and Aurora presets provide accessible starting points.

## Local storage and startup

The palette is stored atomically at `%LOCALAPPDATA%\JStremio\data\themes.json`. A previous version is retained as `themes.json.bak` after replacement. Theme changes do not modify plugin settings, local reviews, timestamp notes, last-played history, Stremio add-ons, or account data.

JStremio injects the saved palette at document creation, before the Stremio application root is rendered. It reapplies the same validated palette after route reconciliation, so normal navigation does not reset it.

Only opaque six-digit hexadecimal colors such as `#4B8CFF` and whole-number gradient angles from `0` through `360` are accepted. The native bridge exposes only fixed `get`, `set`, and `reset` theme operations; it does not expose generic file access.
