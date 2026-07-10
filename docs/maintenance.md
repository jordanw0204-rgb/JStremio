# Upstream maintenance

Both upstream remotes are fetch-only in the development repository:

- `web-upstream` — official Stremio Web, used for compatibility research only.
- `shell-upstream` — official native shell.

Fetch a candidate stable shell tag with `scripts/update-upstream.ps1 -Release vX.Y.Z`. Create a dedicated update branch from that tag, update `upstream.lock.json`, and build/run the stock shell before replaying the small JStremio commits. Never build a release from a moving upstream branch.

Run the complete automated and manual matrices. Compare enabled and safe mode against the same pin. Update only the centralized compatibility adapter for live UI DOM changes; do not copy or patch Stremio React source.

The archived full-Web-UI prototype is preserved at branch `archive/web-prototype-2026-07-10`, tag `web-prototype-archive-2026-07-10`, and the verified bundle/checksum recorded in `upstream.lock.json`.
