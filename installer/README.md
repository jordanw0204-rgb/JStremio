# JStremio installer output

`scripts/package-installer.ps1` writes the single Windows setup executable here. Generated `.exe` files are intentionally ignored by Git.

The installer bundles JStremio, the streaming server, native MPV, WebView2 bootstrap support, built-in plugins, and the update helper. Stremio account addons are provisioned only through Stremio's official install confirmation after login; add their public manifest URLs to `setup/default-addons.json` in a future release.
