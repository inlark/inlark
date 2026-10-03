# Flatpak and Flathub

Inlark's Flatpak ID is `com.inlark.Inlark`. The first version supports x86_64,
matching the other Linux release installers. It uses Freedesktop 25.08 and the
Electron BaseApp, which provides Zypak for Chromium's sandbox.

The Flatpak recipe repackages the same Electron directory build used by the
native installers. Builds need no network after Flatpak has downloaded the
runtime, BaseApp, and checksum-pinned release archive. File selection and opening
links use desktop portals; the app has no blanket home-directory access. Network
access connects to mail servers, Secret Service access enables the OS keyring,
and the notification and StatusNotifier permissions support desktop notifications
and the tray. Flatpak owns updates; the in-app installer updater is disabled.

## Build and test locally

Install Node 24, pnpm 12.3.4, Flatpak, flatpak-builder, Xvfb, and xauth. Then run:

```sh
pnpm install --frozen-lockfile
pnpm package:flatpak
pnpm test:flatpak
```

The bundle is `apps/desktop/release/Inlark-<version>-x64.flatpak`. The smoke test
installs the bundle in the user installation and checks the renderer/preload IPC
bridge and SQLite worker using disposable sandbox data. It retains Chromium's
sandbox. Launch normally with `flatpak run com.inlark.Inlark`.

`scripts/prepare-flatpak.mjs <version> <archive> [output-directory]` creates two
recipes: `local/` reads the local archive, and `flathub/` downloads its immutable
GitHub release URL. Both pin the same SHA-256. The generated MetaInfo includes
the release version, date, and screenshots pinned to that tag. Set `RELEASE_DATE`
to an ISO date to reproduce the metadata. The files in this directory are
templates; submit the generated `flathub/` files rather than the templates.

## Release pipeline

The reusable `.github/workflows/flatpak.yml` builds the archive and Flatpak,
validates the desktop entry and AppStream metadata, and runs the installed app's
smoke test on an ordinary Linux runner. It also runs on relevant pull requests and can be dispatched manually.
The tag release workflow waits for it to pass before publishing anything.

Every GitHub release includes the `.flatpak` bundle and Linux `.tar.gz` archive,
alongside the existing installers. The workflow's `flathub-manifest` artifact
contains the submission-ready recipe, metadata, icon, and wrapper.

## First Flathub submission and credentials

Flathub approval and repository access cannot be created by this release workflow.
Complete these steps once:

1. Publish a stable GitHub release with the new pipeline. Download that run's
   `flathub-manifest` artifact and follow the [Flathub submission process](https://docs.flathub.org/docs/for-app-authors/submission)
   to submit its contents as `com.inlark.Inlark`. Validate the generated recipe
   with `org.flatpak.Builder` and fix any additional Flathub review requirements.
2. After acceptance, obtain collaborator access to `flathub/com.inlark.Inlark`.
   [Verify the app](https://docs.flathub.org/docs/for-app-authors/verification)
   using the `inlark.com` domain and [request GitHub automerge](https://docs.flathub.org/docs/for-app-authors/maintenance#automerge-request)
   from Flathub. Automerge requires Flathub approval; without it, the workflow
   leaves an update PR and reports failure when requesting automerge.
3. Add an upstream repository Actions secret named `FLATHUB_TOKEN`, containing a
   maintainer token accepted by the Flathub organisation with **Contents: write**
   and **Pull requests: write** access to `flathub/com.inlark.Inlark` (and read
   access to this public repository). The upstream `GITHUB_TOKEN` cannot write
   to a different repository. Do not grant stable-branch protection bypass.
4. Set the upstream Actions variable `FLATHUB_PUBLISH` to `true`. Rerun the
   `flathub` release job for the latest stable release, or publish the next tag.

For every subsequent stable release, `scripts/publish-flathub.sh` copies the
tested recipe into a release-specific branch of the Flathub app repository,
creates or reuses its update PR, and enables GitHub automerge. Flathub's required
checks and reviews must pass before merging; Flathub then builds and publishes
the update. Prereleases are bundled on GitHub but never published to stable
Flathub. Old release reruns are skipped, and older pending automation PRs are
closed to prevent a delayed downgrade. Retrying an already merged update is a
no-op. The script does not push directly to the protected stable branch.

The recipe disables Flathub's external data checker because upstream releases
already create update PRs; two independent update bots would duplicate work.
Keep the runtime and BaseApp versions current together.

Until submission is accepted, install the bundle from GitHub. After Flathub
publishes the app, installation becomes `flatpak install flathub com.inlark.Inlark`.
Flatpak data lives under `~/.var/app/com.inlark.Inlark/config/Inlark`; it is separate
from native Inlark installations. The app does not silently migrate credentials
or drafts from another installation.
