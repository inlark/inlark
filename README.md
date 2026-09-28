# Inlark

A focused email client for Linux, Windows, and macOS with JMAP and IMAP/SMTP accounts. Built with Electron, React, TypeScript, Tailwind CSS, Base UI, TanStack libraries, and Turborepo. Connects directly to your server; no hosted account or telemetry.

This is an initial implementation, not a claim of production readiness. The working client includes account setup, a unified inbox, server search, conversation reading, organization and undo, folders, composition, attachments, local/server drafts, sending, themes, keyboard navigation, notifications, and a tray. See [validation and remaining acceptance work](docs/validation.md) before adopting it as your only mail client.

## Run

Download the desktop app for Linux, Windows, or macOS from the [latest release](https://github.com/inlark/inlark/releases/latest). Releases include a Windows installer, macOS DMG and ZIP files for Intel and Apple Silicon, and Linux AppImage, Debian, and RPM packages. Windows and macOS builds are currently unsigned, so your system may ask you to approve them before opening.

For development on Windows, macOS, or a conventional Linux distribution, install Node 24 and pnpm 12.3.4, then run `pnpm install --frozen-lockfile` and `pnpm dev`.

### Nix and NixOS

To install the desktop app from this checkout on NixOS or another Linux system with Nix:

```sh
nix profile install path:.#inlark
inlark
```

The flake provides x86_64 and aarch64 Linux packages, including the application launcher, desktop entry, icon, and `mailto:` handler. To add it declaratively to a NixOS flake configuration, add Inlark as an input and enable its module:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.inlark.url = "github:inlark/inlark/v0.1.0";

  outputs = { nixpkgs, inlark, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        inlark.nixosModules.default
        ./configuration.nix
        { programs.inlark.enable = true; }
      ];
    };
  };
}
```

Replace `my-host` with your NixOS host name. The `v0.1.0` segment pins the installation to that release; omit it to follow the default branch. For a direct profile install from the release tag, run `nix profile install 'github:inlark/inlark/v0.1.0#inlark'`. For development on NixOS:

```sh
nix develop path:.
pnpm install --frozen-lockfile
pnpm dev
```

The shell selects Nix's Electron executable and skips the incompatible downloaded binary.

For a browser preview with sample mail:

```sh
pnpm dev:web
```

Open the printed localhost URL. Append `?stress=1` for five synthetic 50,000-message inboxes. The browser preview cannot connect to real accounts, access native files, or send email. Demo storage is separate from real account storage. A native sample workspace is available with `pnpm dev -- --demo` (or run the packaged app with `--demo`).

Sample messages use fictional content with real sender domains, so both demo modes can show sender pictures when **Load remote images** is enabled. The browser preview resolves pictures through its local development server; the native demo uses the same resolver as connected mail.

### Marketing site on Cloudflare Workers

The Astro marketing app lives in `apps/marketing`. Run its landing page with `pnpm dev:marketing`; `pnpm --filter @inlark/marketing build` creates the static site in `apps/marketing/dist`.

The marketing app is configured as a static Workers Assets project in `apps/marketing/wrangler.jsonc`. It does not need a server adapter. To test the built site locally with Wrangler, run `pnpm --filter @inlark/marketing preview:workers`. When ready to publish, run `pnpm --filter @inlark/marketing deploy` after authenticating Wrangler; this builds the site before uploading it.

For Cloudflare Workers Builds, connect this repository to a Worker named `inlark-marketing` and set the root directory to `apps/marketing`, build command to `pnpm build`, and deploy command to `pnpm exec wrangler deploy`. Set the build variable `PNPM_VERSION` to `12.3.4` to match the workspace lockfile. The Worker serves `apps/marketing/dist` as static assets.

## Connect your account

Open **Settings → Accounts → Add account** and enter your email address. Inlark looks up the settings your domain publishes and shows the protocol, servers, ports and security before asking for a password. It checks JMAP (DNS SRV, then `/.well-known/jmap`) first and prefers it; IMAP/SMTP comes from your domain's Thunderbird-style configuration file or DNS SRV records. Only when your domain publishes nothing does it ask Thunderbird's public settings directory, and then only the domain is sent. Discovery never carries credentials. **Set up manually** is always available.

For JMAP, enter your server URL or session endpoint. Use the canonical origin advertised by your server: authenticated endpoints on a different origin are deliberately rejected so credentials are never sent to another host.

For IMAP/SMTP, incoming and outgoing servers have their own host, port, username and password; the outgoing login defaults to the incoming one. Security is implicit TLS or required STARTTLS, always with certificate verification, never a plaintext fallback. Inlark signs in to both servers separately, without sending a message, and only saves the account when both succeed. If Sent, Drafts, Archive, Junk or Trash cannot be identified from the server's special-use flags, you choose or create them; **Folders…** and **Edit connection…** in the account menu change them later. An authentication failure is shown on the settings you chose; no other candidate is tried with your password.

IMAP mail is read from a local metadata index built in the background, newest Inbox mail first. While it catches up, lists say that older mail may be missing, and searches still run on the server. Message bodies and attachments are fetched when opened. Actions a server cannot do safely (moving without MOVE or UIDPLUS, permanent deletion without UIDPLUS) are turned off with an explanation.

When an OS keyring is available, remembered passwords use Electron's secure storage. Without a keyring, you can explicitly choose to remember a login on this device; its password is then stored unencrypted in the app's owner-only local data file. Leave **Remember this login** unchecked for session-only login. Set up GNOME Keyring or another Secret Service provider on Hyprland if you prefer encrypted storage. A locally stored password moves to secure storage on the next successful reconnect when a keyring becomes available.

Mail organization and sending require a connection. Previously fetched pages and messages can be read from the bounded cache. Local drafts and staged attachments persist independently of the read cache. A send whose response was lost stays **unconfirmed** until reconciled; it is never automatically retried. For IMAP accounts the SMTP acceptance is recorded before the Sent copy is filed, so a failed copy shows as “Sent · Sent copy pending” and only the copy is retried. A partially accepted message lists the refused recipients and offers a new draft addressed only to them.

## Build and verify

```sh
pnpm check              # Formatting, TypeScript, deterministic tests, production build
pnpm test:stalwart      # disposable Stalwart 0.16.23 over JMAP, IMAP and SMTP; requires Podman (or CONTAINER_RUNTIME=docker)
nix build path:.        # Nix package; ./result/bin/inlark
pnpm package:linux      # AppImage + .deb + .rpm in apps/desktop/release
pnpm test:deb           # isolated Debian packaging smoke; requires Podman
```

The Nix build is pinned by `flake.lock`, `pnpm-lock.yaml`, and the dependency-store hash. It runs typechecking and deterministic tests offline during the build. After changing dependencies, update the hash in `nix/package.nix` using the mismatch reported by Nix.

The Linux packaging script selects a Nix-compatible `fpm` on NixOS. Packages currently contain reserved `.localhost`/`.invalid` development metadata. Replace that metadata before public distribution.

Pushing a `v<version>` tag matching `apps/desktop/package.json` runs the [desktop release workflow](.github/workflows/release.yml). It builds an x64 Windows installer, Intel and Apple Silicon macOS DMG/ZIP files, and x64 Linux AppImage, Debian, and RPM packages. It also checks that the Nix flake builds and installs before publishing the GitHub Release. The macOS and Windows builds are unsigned; they may require the user to approve them through the operating system's security prompts until signing and macOS notarization are configured.

To check native preload/IPC and SQLite-worker startup in the Nix package without opening a window:

```sh
INLARK_DATA_DIR="$(mktemp -d)" ./result/bin/inlark --smoke-test --ozone-platform=wayland
```

Only use `INLARK_DATA_DIR` for a separate test profile. Normal application storage lives in Electron's `userData` directory, typically `~/.config/Inlark`. [Troubleshooting](docs/troubleshooting.md) explains recovery and diagnostics.

## Workspace

| Location                    | Responsibility                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main`     | Authenticated network access, credentials, drafts/submission journal, discovery, IMAP index worker, files, notifications, and native lifecycle |
| `apps/desktop/src/preload`  | Fixed, validated `DesktopMailAPI` bridge                                                                                                       |
| `apps/desktop/src/renderer` | React application, typed routes, query cache, virtual list, reader, composer, preferences                                                      |
| `packages/core`             | Platform-independent domain types, validation, search, identity selection, provider contract, merge logic                                      |
| `packages/jmap`             | JMAP provider; injectable fetch and no Electron/DOM/filesystem dependency                                                                      |
| `packages/imap`             | IMAP/SMTP provider (ImapFlow, Nodemailer, MailParser); injected index and attachment access                                                    |
| `packages/ui`               | Customized Base UI components and shared Tailwind theme                                                                                        |
| `tests`                     | Domain, protocol, storage/submission, network-boundary, and real-server tests                                                                  |

Read [architecture](docs/architecture.md) for extension points. Mobile, OAuth sign-in (Gmail, Microsoft), sending aliases, full offline downloads, offline change queues, AI, scheduling, snooze, rules, calendar, and a full address book are outside this version.

## License

Copyright (C) 2026 Paul Koeck. Inlark is licensed under the [GNU Affero General Public License version 3](LICENSE) (`AGPL-3.0-only`). The bundled Inter font retains its [SIL Open Font License](packages/ui/src/fonts/OFL.txt).
