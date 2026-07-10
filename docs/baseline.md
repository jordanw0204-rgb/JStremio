# Pinned shell baseline

Date: 2026-07-10

- Upstream release: `stremio-shell-ng` `v5.0.23`
- Commit: `5b1f341dbd9e1959f824436c70aa7410c159f684`
- Rust: `rustc 1.97.0`, `cargo 1.97.0`
- Native unit tests: 10 passed
- Optimized x64 build: passed with `--locked`
- Isolated portable startup: shell, WebView2, and bundled `stremio-runtime` started
- Server listeners: 11470 and 12470
- WebView2 profile: isolated beside the temporary baseline executable
- Live official Web UI build: `b6298c68d27602564ed16edd0f44aa09cd8bacb4`
- Process cleanup: shell and server child both stopped
- Enabled JStremio live smoke: official URL and dynamic server handoff preserved; frozen runtime and both navigation entries present
- Safe-mode live smoke: same official URL and dynamic server URL; runtime and extension nodes absent
- Native bridge restart smoke: one review and one timestamp note persisted across a full restart
- Privacy smoke: sentinel text absent from observed network requests and shell logs

The test used isolated `APPDATA` and `LOCALAPPDATA` directories and an unreachable updater endpoint. Interactive Stremio sign-in, real native MPV playback, and audible-output confirmation remain manual baseline checks.
