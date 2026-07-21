<div align="center">
  <img src="images/jstremio.png" alt="JStremio logo" width="112">
  <h1>JStremio</h1>
  <p><strong>Stremio for Windows, with useful local plugins built in.</strong></p>

  <p>
    <a href="https://github.com/jordanw0204-rgb/JStremio/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/jordanw0204-rgb/JStremio?display_name=tag&sort=semver&style=flat-square&color=1687ff"></a>
    <a href="https://github.com/jordanw0204-rgb/JStremio/actions/workflows/test.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/jordanw0204-rgb/JStremio/test.yml?branch=feature%2Fjstremio-extensions&style=flat-square"></a>
    <a href="LICENSE.md"><img alt="GPL-2.0 license" src="https://img.shields.io/badge/license-GPL--2.0-1687ff?style=flat-square"></a>
  </p>

  <p><a href="https://github.com/jordanw0204-rgb/JStremio/releases/latest"><strong>Download JStremio for Windows</strong></a></p>
</div>

JStremio is a Windows desktop build based on the official
[`stremio-shell-ng`](https://github.com/Stremio/stremio-shell-ng). It keeps
Stremio's account, library, add-on, streaming-server, and native MPV playback
experience while adding optional features that store their data locally.

> [!IMPORTANT]
> JStremio is an unofficial community project and is not affiliated with or
> endorsed by Stremio. It installs separately and does not replace or modify
> the official Stremio app.

## Install JStremio

JStremio currently supports 64-bit Windows 10 (version 1809 or newer) and
Windows 11.

1. Open the [latest JStremio release](https://github.com/jordanw0204-rgb/JStremio/releases/latest).
2. Expand **Assets** and download **`JStremioSetup-vX.Y.Z_x64-unsigned.exe`**.
   This is the recommended one-click installer. You do not need the files named
   "Source code."
3. Open the downloaded installer. It installs JStremio for your Windows user,
   creates Desktop and Start Menu shortcuts, and opens the app when setup is
   finished.
4. Sign in with your Stremio account to restore your library and account
   add-ons. JStremio uses a separate local profile, so the first sign-in is
   independent from the official desktop app.

The installer includes the native player, streaming server, built-in JStremio
plugins, and a WebView2 bootstrapper for systems that need it. It does not
require users to copy files or run terminal commands.

### Windows SmartScreen notice

The current installer is not code-signed, so Windows may display **Windows
protected your PC** or identify the publisher as unknown. If you downloaded the
installer from this repository's Releases page, select **More info**, verify the
app name is JStremio, and select **Run anyway**.

Release checksums are published beside every installer as `SHA256SUMS.txt`.

## Built-in features

| Feature | What it does |
| --- | --- |
| **LastPlayed** | Adds exact-stream resume to every played movie/series card and shows the saved provider, episode, stream description, size, and seeders when available. |
| **Themes** | Customizes the app gradient, accent, surfaces, and text with live preview, presets, and restart-persistent settings. |
| **Local Reviews** | Saves private 1-10 star ratings and optional review text for movies and series. |
| **Timestamp Notes** | Adds private, color-coded notes and optional thumbnails at exact playback positions. |
| **BegoneMouse** | Lets you choose the player interface and cursor idle-hide delay while protecting hovered seek controls and the bottom player region. |
| **Quick Seek** | Adds configurable themed rewind/fast-forward controls over the video and beside Play, with accelerating press-and-hold. |
| **Easy Sound Output** | Adds a themed output-device menu to right-click on the player volume button and can prefer one device for playback. |
| **QOL Things** | Remembers and restores the player volume across closing, reopening, and restarting JStremio. |
| **No Spoilers** | Conceals summaries, artwork, and title text and confirms accidental large forward skips. |
| **Plugins** | Lets you enable built-in features and trusted local plugins independently. |

Built-in features can be managed from **Plugins** inside JStremio. Custom local
plugins are discovered from `%LOCALAPPDATA%\JStremio\plugins` and start disabled
until you explicitly enable them.

Local Reviews, Timestamp Notes, BegoneMouse, Quick Seek, Easy Sound Output, QOL Things,
and No Spoilers also have a **Settings** button
in the Plugins screen. Reviews and Timestamp Notes accept optional player-action
hotkeys. BegoneMouse accepts an idle delay from 0 through 600,000 milliseconds,
including decimal values such as `0.05`; sub-millisecond delays run on WebView's
next available timer tick. Quick Seek stores independent rewind and fast-forward
amounts from `0.05` through `3600` seconds and applies them immediately.
Easy Sound Output stores only the selected MPV device name and description. QOL Things
stores the last volume level when enabled. No Spoilers independently configures summary
blur, artwork blur, title masking from 0–100%, and a forward-skip confirmation threshold.

Open **Themes** from the palette button in the sidebar to adjust both background
gradient colors, the gradient angle, accent color, elevated surfaces, and
primary text. Preview changes live, then choose **Save theme** to keep them or
**Reset to defaults** to restore Stremio's palette. Theme data stays local and
is applied before the normal interface renders on later launches. See
[Themes](docs/themes.md) for details.

> [!WARNING]
> A custom plugin is trusted JavaScript running inside the Stremio page. Install
> local plugins only when you have reviewed the code and trust its author.

## Automatic updates

Installer builds check the latest stable GitHub Release in the background when
JStremio starts. When a newer version is available, JStremio shows an **Update
JStremio** prompt:

- Choose **Update** to install the verified release and reopen JStremio.
- Choose **No** to keep the current version. You can continue using the app and
  will be offered the update again on a later launch.

The updater accepts only the expected Windows installer from this repository
and verifies its GitHub-provided SHA-256 digest, declared size, trusted download
path, and Windows executable signature before it can run.

Updates replace only program files. Your Stremio login, account add-ons,
settings, server data, reviews, notes, thumbnails, LastPlayed history, themes,
plugin settings, and custom plugins remain untouched under `%LOCALAPPDATA%\JStremio`.

## Portable version

Every release also includes
`JStremio-X.Y.Z-windows-x64-portable.zip`. Extract the entire ZIP to a writable
folder and run `JStremio.exe` from that folder.

The portable package is useful when you do not want shortcuts or an installed
application. It intentionally does not perform automatic updates because a
portable folder has no reliable installation boundary. Download and extract a
new portable release to update it; your profile and feature data remain in
`%LOCALAPPDATA%\JStremio`.

## Add-ons and local data

JStremio continues to use Stremio's normal account add-on system. Sign in and
manage catalog and streaming add-ons through Stremio as usual. JStremio does
not silently edit your account or install account add-ons without Stremio's
confirmation.

JStremio-specific data stays on your computer:

| Data | Location |
| --- | --- |
| Reviews, notes, LastPlayed, themes, and plugin settings | `%LOCALAPPDATA%\JStremio\data` |
| Custom local plugins | `%LOCALAPPDATA%\JStremio\plugins` |
| Stremio login/profile data | `%LOCALAPPDATA%\JStremio\webview2` |
| Bundled server cache and settings | `%LOCALAPPDATA%\JStremio\server` |

Read [Data, recovery, and privacy](docs/data-and-privacy.md) for the complete
privacy and backup model.

## Uninstall

Open **Windows Settings > Apps > Installed apps**, find **JStremio**, and choose
**Uninstall**. The uninstaller removes the app and shortcuts but leaves
`%LOCALAPPDATA%\JStremio` in place so an uninstall or reinstall cannot erase
your profile and feature data. Delete that folder manually only if you also
want to permanently remove all JStremio data.

## Troubleshooting

- **The app will not start:** install or repair the
  [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
- **A plugin breaks the interface:** run `JStremio.exe --disable-extensions`,
  then disable the problem plugin from the Plugins screen.
- **You need to roll back:** use the portable ZIP from an older release. Do not
  delete `%LOCALAPPDATA%\JStremio`.
- **Playback or an account add-on fails:** check whether the same media and
  add-on work in official Stremio before opening an issue.

More detail is available in [Installation, safe mode, and rollback](docs/installation.md)
and [Plugin installation and development](docs/plugins.md).

## Build from source

Building is optional; ordinary users should use the installer above. Development
requires Windows 10/11, Git, Node.js 22 or newer with Corepack, stable Rust with
the `x86_64-pc-windows-msvc` target, and Inno Setup 6 for installer builds. No
API key or credential is required to build or run JStremio.

```powershell
git clone https://github.com/jordanw0204-rgb/JStremio.git
Set-Location JStremio
corepack enable
pnpm --dir web install --frozen-lockfile
.\scripts\check.ps1
.\scripts\run-dev.ps1
```

Create distributable packages with:

```powershell
.\scripts\package-portable.ps1 -Zip
.\scripts\package-installer.ps1
```

See [Architecture](docs/architecture.md), [Testing](docs/testing.md), and
[Versioning and releases](docs/releasing.md) before contributing a change.

## License and upstream

JStremio is distributed under [GPL-2.0](LICENSE.md), matching the upstream
shell. The pinned upstream release and commit are recorded in
[`upstream.lock.json`](upstream.lock.json). Stremio and its trademarks remain
the property of their respective owners.
