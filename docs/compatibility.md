# Stremio Web compatibility

Pinned shell: see `upstream.lock.json`. Official Web UI build observed on 2026-07-10: `b6298c68d27602564ed16edd0f44aa09cd8bacb4`.

The runtime depends on two versioned inputs:

- `window.core.getState("player")` for stable movie/episode identity.
- Existing native `mpv-prop-change` events for `time-pos`, `duration`, `pause`, and `seeking`.

DOM discovery is centralized in `web/src/runtime/compatibility.ts`. It uses semantic navigation/toolbar/slider roles and known Library/Calendar hrefs before structural neighbors. Complete CSS-module hashes are forbidden.

The current official player renders its reusable `Button` as a focusable `div` and its `Slider` as layered `div` elements without ARIA slider semantics. The adapter therefore recognizes titled/focusable controls, relates the button row to the neighboring seek bar, and identifies the seek slider through its inline mask/thumb positioning. Partial class-name hints are last-resort fallbacks; complete generated hashes remain forbidden.

Discovered upstream nodes are measurement/templates only. Custom player buttons and markers are mounted under `document.body` and visually positioned with fixed overlays; they are never inserted into React-owned control or slider child lists.

The player dock remains a pointer-active, faint hover target while Stremio is immersed and returns to full opacity on hover or keyboard focus. Marker layers follow Stremio's `overlayHidden` compatibility signal: ticks and popovers disappear with the official controls, and an open popover is dismissed on the next playback update so it cannot reappear unexpectedly.

If `window.core`, the shell channel, player time/duration, or a supported seek slider is absent, only the affected button/marker is disabled. Live and remote/cast playback do not offer timestamp capture. A bundle exception is caught per extension.

For each new live Web UI build, run unit fixtures, Playwright remount tests, a debug-CDP live smoke, and the manual playback matrix before updating `lastCompatibilityTest` in `upstream.lock.json`.
