# Changelog

JStremio follows Semantic Versioning. Stable releases are tagged `vMAJOR.MINOR.PATCH` and published through GitHub Releases.

## 1.10.1 - 2026-07-24

- Add the built-in Stream Switcher player control: left-click selects the closest matching alternate provider/quality stream, right-click opens a compact themed stream picker, and successful replacements resume at the prior playback position and pause state.
- Prevent Watch Now transitions from carrying an ending timestamp into the following episode by tracking the outgoing media identity and rejecting inherited end positions during the player handoff.
- Keep automatic Local Reviews owned by the episode that actually ended, suppress duplicate dialogs throughout Watch Now transitions and remounted end cards, and require genuinely near-end playback before opening automatically.
- Make player media identity route-authoritative while Stremio preselects the next episode, preserving the correct title, season, episode, stream, review, and resume target across asynchronous route/core updates.
- Make Restart JStremio launch a detached replacement process reliably after the current WebView, server, profile, and IPC handles have closed.
- Add focused unit, repeated browser, and live smoke coverage for alternate-stream ranking/resume, inherited-end recovery, restart replacement, route-owned episode targeting, and remounted Watch Next prompts at `00:00`.

## 1.10.0 - 2026-07-22

- Make No Spoilers target only spoiler-bearing detail and player surfaces, leaving home/catalog artwork and the main series title untouched while correctly blurring detail summaries, backgrounds, episode-list thumbnails, and episode tooltips.
- Mask episode names consistently in detail headers, episode lists, the player header, and Stremio's current next-video popup while preserving series names and season/episode numbers; add themed click-to-reveal confirmations for summaries and player/next-episode names.
- Detect Stremio's current hashed next-video popup structure through a shared compatibility adapter so Local Reviews reliably opens alongside it; retain the persistent default-on Reviews setting and verify that disabling it prevents automatic opening.
- Apply the active JStremio theme to LastPlayed buttons and metadata popovers, including accent, surface, text, border, and hover states.
- Add focused masking/compatibility tests plus real WebView smoke coverage for detail-page protection, player-title reveal, next-video masking/reveal, Reviews automatic opening, the Reviews off toggle, and non-spoiler home artwork.

## 1.9.0 - 2026-07-21

- Add the Easy Sound Output built-in plugin with a themed right-click menu on the player volume control, live MPV audio-device switching, a per-device preferred-output action, and persistent settings with a clear option.
- Add the QOL Things built-in plugin with default-on, restart-persistent player volume restoration.
- Add the No Spoilers built-in plugin with independently configurable summary and artwork blur, percentage-based title masking, and a maximum forward-skip guard with an explicit themed Skip override.
- Extend the narrow player runtime with validated volume/audio-device properties and composable seek guards, while keeping arbitrary MPV properties and commands unavailable.
- Add native persistence/property-contract coverage and an integrated browser regression spanning device switching, volume persistence, spoiler concealment, timeline interception, and settings management.

## 1.8.0 - 2026-07-21

- Make Quick Seek's compact bottom-bar controls fully interactive by removing Stremio's copied disabled state, preserving click and accelerating hold gestures across React control-bar remounts, and retaining themed hover, active, and hold feedback.
- Automatically open Local Reviews alongside Stremio's end-of-episode Next episode prompt, with a persistent default-on toggle in the plugin settings.
- Apply the saved theme's surface and text colors to the native Windows title bar at startup and immediately after theme saves or resets.
- Add real-player interaction coverage, a remount-during-hold browser regression, end-prompt settings coverage, and native rendered-title-bar verification.

## 1.7.2 - 2026-07-21

- Fix Quick Seek's compact controls being captured by the hidden search toolbar before Stremio's real player bar mounts, which made them absent from the visible bottom frame.
- Revalidate and relocate both compact controls around the current Play/Pause control whenever the official player bar appears or remounts.
- Add a late-player-mount browser regression plus a real-WebView CDP smoke test that verifies visible, stable placement in the production control bar.

## 1.7.1 - 2026-07-21

- Mount Quick Seek's compact rewind and fast-forward controls in Stremio's actual bottom player-control bar even when an earlier top navigation toolbar is present.
- Add compatibility and browser regressions for the production toolbar hierarchy, exact placement around Play, and React control-bar remounts.

## 1.7.0 - 2026-07-21

- Add the BegoneMouse built-in plugin with an immediately applied, persistent player-interface idle delay configurable in decimal milliseconds; keep the interface visible over Quick Seek and throughout the bottom player-control region.
- Add the Quick Seek built-in plugin with theme-aware reference-style line icons over the video and around the official Play control, independently configurable rewind/fast-forward amounts, accelerating press-and-hold, release cancellation, and playback-bound clamping.
- Add native validation plus unit and browser regression coverage for decimal idle/seek settings, protected pointer regions, bottom-bar remounts, theme integration, upstream overlay timing, exact seeking, and extension remounts.

## 1.6.0 - 2026-07-20

- Move Plugins, Themes, Local Reviews, and Timestamp Notes into a shared in-shell page surface that keeps Stremio's official sidebar visible and hands every official navigation click back to Stremio.
- Keep all custom navigation and player controls mounted, themed, immediately responsive, and reliably clickable across upstream route and DOM remounts.
- Apply the active theme to every plugin page, dialog, card, frame, input, marker popover, and player control; add the Crimson preset plus reusable custom theme presets.
- Redesign timestamp marker-color selection with coordinated swatches, hexadecimal entry, and a full custom color picker while keeping marker and rating fields visually uniform.
- Expand Local Reviews and Timestamp Notes ratings from five to ten stars with backward-compatible native validation and persistence.
- Prevent the Windows console window from opening alongside JStremio and expand browser regression coverage for page hosting, official/custom navigation, color selection, ratings, and delayed upstream player state.

## 1.5.2 - 2026-07-18

- Keep WebView2 and native MPV surfaces synchronized through fullscreen, restore, maximize, minimize, resize, move, display, and DPI transitions.
- Detect genuinely stalled active playback and perform one bounded MPV video-pipeline recovery without changing the stream, position, pause state, or display/HDR configuration.
- Hide JStremio page-navigation actions explicitly on player routes so stale upstream layouts cannot leak the sidebar over video.
- Add deterministic player-stall unit coverage and a real-shell 20-cycle fullscreen/restore surface stress test.

## 1.5.1 - 2026-07-17

- Keep the themed web surface transparent on player routes so native MPV video remains visible while retaining the configured gradient throughout the rest of the app.
- Make Reviews and Timestamp Notes player-target resolution resilient to the official player's continuous DOM mutation stream, preventing missing or permanently disabled controls.
- Add a deterministic range-capable native-player smoke fixture and verify both extension controls with real pointer clicks under mutation churn.

## 1.5.0 - 2026-07-17

- Add a LastPlayed action to every visual movie or series card with saved playback history, including the newest saved episode for series-level cards.
- Add an accessible LastPlayed hover/focus panel that displays the exact saved episode, provider, stream name, full add-on description, file size/seeder details when supplied by the add-on, resume position, and save time.
- Add a required Themes page with live editing for both gradient colors, gradient angle, accent, surface, and text colors; include four presets plus validated Save and Reset actions.
- Persist themes atomically and inject the saved palette before the Stremio application root paints so route changes and restarts do not flash back to the default palette.
- Replace Stremio's upper-left web mark with the existing blue JStremio icon while preserving its original link, dimensions, and remount behavior.

## 1.4.0 - 2026-07-17

- Make the Reviews and Timestamp Notes player actions mouse-click-only so Stremio arrow-key navigation cannot select or activate them.
- Add Settings buttons for Local Reviews and Timestamp Notes in the Plugins manager.
- Add validated, persistent per-plugin hotkey recording with conflict detection, safe input/dialog suppression, and immediate application without a restart.
- Preserve older `plugins.json` files while storing hotkeys alongside existing plugin enablement settings.

## 1.3.0 - 2026-07-16

- Add a one-click, per-user Windows installer with JStremio branding, desktop and Start Menu shortcuts, built-in plugins, WebView2 bootstrap support, and post-install launch.
- Add a background stable-release checker and verified installer staging. Updates require GitHub's SHA-256 digest and exact asset size before prompting.
- Preserve the Stremio account/profile, installed account addons, JStremio settings/data, and custom plugins across upgrades.
- Add repeatable version, release-package, checksum, and GitHub release automation.
- Add a versioned empty required-addon manifest ready for the future approved addon list.

## 1.2.0

- Add the LastPlayed built-in plugin with exact logical stream resume.

## 1.1.0

- Add the trusted local plugin platform and Plugins manager.

## 1.0.0

- Initial JStremio shell release with Local Reviews and Timestamp Notes.
