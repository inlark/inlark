# Flatpak packaging

inlark publishes standalone x86_64 `.flatpak` bundles on GitHub Releases. There is
no Flathub submission, publishing token or hosted inlark Flatpak repository.
Installation and updates are described in the [root README](../../../../README.md#flatpak).

The app ID is `com.inlark.Inlark`, preserving the identity of the original
packaging. Display names and release filenames use lowercase `inlark`.

## Build and test

Install Node 24, pnpm 12.3.4, Flatpak and flatpak-builder, then run:

```sh
pnpm install --frozen-lockfile
pnpm package:flatpak
```

The output is `apps/desktop/release/inlark-<version>-x64.flatpak`. The recipe
packages an unpacked Electron build, with a SHA-256-pinned archive. It uses
Freedesktop 25.08 and the matching Electron BaseApp, obtained from Flathub.
Keep the runtime and BaseApp versions current together. Zypak launches Electron
with Chromium's sandbox enabled; do not add `--no-sandbox`.

With Xvfb, xauth and a D-Bus session available, run:

```sh
pnpm test:flatpak
# Or test a specific downloaded release:
bash scripts/test-flatpak.sh /path/to/inlark-<version>-x64.flatpak
```

The smoke test uses a temporary user Flatpak installation and disposable app
data. It does not replace an existing inlark installation or read real accounts.
It checks the renderer/preload IPC bridge and SQLite worker, requires an explicit
success message, and removes the temporary installation afterward. Runtime
downloads require network access.

## Desktop integration

The manifest grants network access for mail servers, display and GPU access,
Secret Service/KWallet access for the OS keyring, and StatusNotifier access for the tray.
File selection, opening links and notifications use desktop portals. There is no
blanket home-directory access. Electron's desktop identity matches the Flatpak
desktop file; the existing credential identity remains unchanged.

Before publishing packaging changes, check on both GNOME and KDE, with Wayland
and X11 where available:

- Connect to a JMAP or IMAP/SMTP server, send mail, and reconnect after restarting.
- Save a login with the OS keyring unlocked, then confirm it is readable after a restart.
- Add, save and open attachments; import and export OpenPGP keys through file dialogs.
- Check notifications, tray behavior, external links, `mailto:` links and the system title bar preference.
- Reinstall a newer bundle and confirm that accounts, drafts and settings survive.

Flatpak app data lives under `~/.var/app/com.inlark.Inlark/config/Inlark`, separate
from native installations. The Electron installer updater is disabled under
Flatpak. Users must download and reinstall newer bundles; `flatpak update` only
updates dependencies from their configured repositories.

## Release automation

`.github/workflows/flatpak.yml` builds the directory archive and generated
manifest, validates desktop/AppStream metadata, builds the bundle and runs the
installed application smoke test. It runs for relevant PRs, supports manual
dispatch, and is called by the tag release workflow with the tag's version.

The release workflow waits for Flatpak validation and publishes the tested bundle
alongside native installers. Both stable and prerelease tags produce bundles.
There is no dependency on Flathub app review or repository access. A signed
inlark update repository can be added later using the same application ID.

Startup uses the desktop’s Background portal, which may ask for permission on first launch.
Settings → General lets you enable or disable startup and choose between the tray and an open window.
Declining the request leaves startup off; inlark does not ask again automatically. The desktop must
provide a Background portal backend. If it cannot grant permission, Settings reports the failure and
lets you retry. The switch reflects the last portal response; permissions revoked outside inlark
remain controlled by the desktop.
