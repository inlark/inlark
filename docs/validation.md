# Validation record

This is an initial working implementation. The checks below establish a reproducible development baseline; they do not establish that every daily-driver acceptance criterion has passed.

## Automated checks

Verified on September 23, 2026, on x86_64 NixOS/Hyprland:

- TypeScript checks across all four workspaces and a production Electron build.
- 32 deterministic tests: domain isolation, identity selection, draft/send validation, full pagination and chronological merging of five 50,000-conversation accounts, bounded JMAP pages, full-history search filters, same-origin discovery, rate limits, per-object failures, stale state, private storage, interrupted sends, failure of local persistence after successful sending, submission reconciliation, draft conflicts, background draft synchronization, undo after external changes, one unavailable account, and anonymous resource boundaries.
- Real Stalwart 0.16.23 integration: provision a disposable server, create 61 messages, verify 50 + 11 pagination and ordering, fetch Unicode body content, search, change flags, upload/download an attachment, save and submit a draft to the same disposable account, reconcile delivery, rename/delete a folder, restart the server, and rediscover the same account. The script removes its exact container and anonymous volumes afterward.
- A pinned Nix package build, including offline typechecks, tests, and bundling.
- AppImage and `.deb` generation with electron-builder. These packages are unsigned development artifacts with reserved development metadata.
- AppImage extraction and native startup/IPC through this machine’s configured NixOS AppImage handler, with an isolated profile.
- Packaged `.deb` startup and IPC in the isolated Debian 12 smoke harness described below.
- Native Electron startup and sandboxed preload-to-main IPC on NixOS/Wayland, using an isolated profile. The available credential backend reported unavailable; the app correctly offered session-only login.

Run `pnpm check`, `pnpm test:stalwart`, `nix build path:.`, and `pnpm package:linux` to reproduce the respective checks. Integration tests are intentionally skipped during the normal deterministic suite. They never target your live mail unless you explicitly replace the disposable-server configuration.

The conventional-Linux smoke harness is `bash scripts/test-deb.sh`. It extracts the generated `.deb` in a non-root Debian 12 container and checks packaged renderer/preload/main startup under Xvfb. The runtime container has no network and mounts only release artifacts, read-only. Its test-only Chromium `--no-sandbox` flag accommodates nested container namespaces; this is not a substitute for testing normal desktop sandboxing on a Debian installation. Production launchers do not include that flag. Direct AppImage execution inside that container was blocked by the host’s registered `/run/binfmt/appimage_type_2` handler, which is not present in the container; the exact AppImage instead passed through the configured handler on the NixOS host. Normal FUSE-based launch on a conventional desktop remains unverified.

## IMAP/SMTP and automatic setup

Verified on September 26, 2026, on x86_64 NixOS/Hyprland:

- `pnpm check`: formatting, TypeScript in all five workspaces, 192 deterministic tests, production build.
- Deterministic coverage added for discovery precedence and privacy (directory only as a fallback, domain only), bounded redirects/sizes and hostile XML; TLS/STARTTLS policy with no plaintext fallback; separate incoming/outgoing credentials and checks; secret-free connection settings; the version 1 → 2 connections migration (backup kept, malformed or newer files untouched); folder mapping review, creation under the server's layout, and user overrides; UIDVALIDITY resets, relocation across confirmed moves (COPYUID and Message-ID fallback), threading across folders and late ancestors with alias resolution, keyset pagination during indexing, server search, CONDSTORE and non-CONDSTORE flag reconciliation, IDLE, reconnection, concurrent flag changes, MOVE/UIDPLUS fallbacks and refusal, exact UID EXPUNGE; MIME round trips with Unicode, inline images and attachments; Bcc only in the envelope; draft replacement and conflicts; SMTP rejection, partial acceptance, lost final responses, crashes around journal writes, and failed or ambiguous Sent APPENDs, with no automatic resend of accepted or uncertain mail. A SQLite index fixture of 50,000 messages checks query plans and paging.
- `pnpm test:stalwart` against disposable Stalwart 0.16.23 with a test CA certificate: implicit TLS and STARTTLS on both IMAP and SMTP, rejection of an untrusted certificate and wrong passwords, indexing and threading of 61 messages, Unicode bodies, server search, flags/moves/permanent deletion observed through JMAP, drafts, a real partial SMTP acceptance (unknown Bcc recipient), duplicate-free Sent filing, delivery back into Inbox without a Bcc header, plus the existing JMAP suite. This run found that Stalwart's header search lags behind a fresh APPEND; filing now also compares recent envelopes.
- `nix build path:.` with the updated dependency hash; native `--smoke-test` of the Nix package, and of the `.deb` in the Debian 12 harness, both starting the SQLite index worker.
- The setup, account, indexing, recovery and limited-action flows in the browser fixture at 900px in both themes, mostly by keyboard.

Not yet verified: providers other than Stalwart (Dovecot, Cyrus, hosted services with app passwords), real accounts with years of mail across many folders, IDLE across sleep/resume and flaky networks, IMAP servers without IDLE/CONDSTORE/MOVE/UIDPLUS (covered only by the fake server), and the setup flow in the native window with a Secret Service keyring.

## Interactive checks

Checked in the browser fixture workspace at the desktop's 1380 × 900 default size:

- Dark and light themes, collapsible navigation, account identity, a white transactional email inside the dark reader, conversation navigation, and reply identity/recipient selection.
- A 250,000-conversation unified inbox renders roughly 27–41 conversation rows for the viewport and overscan. It does not create 250,000 DOM rows.
- Pointer-opened conversation → next conversation → Escape restored the exact recorded list offset and keyboard focus. Rows are marked read on opening, not by keyboard focus alone.
- Composer initial focus, To/Subject/body editing, local draft save and reopening, Unicode, shortcut-safe text inputs, dialog controls, and keyboard return to the list.

One warm stress-preview sample reported first meaningful paint about 236 ms after navigation and approximately 25 MB JavaScript heap. This was a browser development build with cached modules and synthetic mail. It is not a cold-start benchmark, a sustained-memory measurement, or a five-live-account timing guarantee. The native empty-profile smoke finished in approximately one second; that does not measure an authenticated cached inbox.

## Before relying on it as your only mail client

The remaining acceptance work needs realistic live-account and desktop conditions:

- Sustained use with five accounts, cold/cached startup and navigation measurements, long scrolling sessions, huge conversations, and bulk changes while other clients modify the same mailbox.
- Sleep/resume, network flapping, changed credentials, missed push events, server throttling, initial notification suppression, real notification/tray interaction, and OS `mailto:` registration on the actual desktop.
- A secure Secret Service backend: remember, lock/unlock, restart, and reconnect. Only the unavailable-backend path was exercised on this machine.
- Broad rendering checks for newsletters, malformed HTML, inline images, quoted content, and large attachments; actual screen-reader and contrast auditing in both themes, plus reduced-motion operation.
- Failure injection for interrupted uploads and filesystem exhaustion, and draft conflict/recovery exercises across two independently running clients.
- Normal installed `.deb` and AppImage sessions on a conventional Linux desktop, including its Chromium sandbox and tray integration. ARM64 is declared in the Nix flake but has not been built here.
- Native Windows and macOS installation, startup, account connections, notifications, tray behavior, and `mailto:` registration on those desktops.

Current deliberate limits: authenticated JMAP endpoints must share the configured origin; IMAP accounts use password or app-password login and one sending address, and read mail from a local index that fills in over time; files over 100 MB cannot be attached/downloaded; server body values are capped at 5 MB; only previously fetched mail is available offline; and all-matching operations are limited to 250,000 conversations. Remote-image fetching blocks private-network resources and redirects. Search excludes junk/trash unless that folder is selected. Folder deletion does not implicitly delete contained messages; a server can refuse deletion of a populated folder.

Future schema versions need explicit migrations. Version 1 currently preserves and refuses unsupported/corrupt storage rather than attempting destructive repair. Ambiguous sends may remain unconfirmed if the server cannot provide evidence; inspect Sent/server logs before deliberately creating another message.
