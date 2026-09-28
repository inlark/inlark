# Troubleshooting

## Connection

Use an HTTPS server URL reachable from this desktop. HTTP is accepted only for localhost test servers. Verify that Stalwart advertises the same public origin as the URL you entered, including its port. On current Stalwart, `STALWART_PUBLIC_URL` controls advertised endpoints behind a proxy. Configure the server; do not disable TLS verification or forward passwords to an unexpected origin.

Settings → Accounts shows each account's connection state and offers reconnect/sign-in. A failed account does not block successful accounts. “Mail changed on the server” means the write's state token no longer matches; refresh before trying again. Rate limits and per-message failures are displayed. A missing special-folder role must be configured on a JMAP server before the associated operation works; for IMAP accounts choose it under **Folders…**.

## IMAP and SMTP

If discovery finds nothing, use **Set up manually** with the settings from your provider. Inlark offers only implicit TLS (usually ports 993 and 465) and STARTTLS (usually 143 and 587). A certificate error means the server's certificate does not match its name or is not trusted by this system; fix the certificate or trust its CA system-wide rather than looking for a way to disable verification.

The connection check reports the incoming and outgoing servers separately. “Sending unavailable” on an account means only the outgoing login failed: mail can still be read, and **Sign in again** updates the outgoing password. Many providers need an app password when two-factor authentication is on.

“Still indexing — older mail may be missing” is expected after adding a large account; progress is shown in Settings → Accounts. Removing the account deletes its local index. If moving or permanent deletion is turned off for an account, the server lacks MOVE/UIDPLUS; ask its administrator, because the alternative could erase messages another app marked for deletion.

## NixOS and Wayland

Use `nix develop path:.` and the supplied `ELECTRON_EXEC_PATH`, or the Nix package. npm's generic Linux Electron binary usually needs a conventional Linux runtime. The Nix package uses the Nixpkgs Electron runtime and adapts to Wayland; pass `--ozone-platform=wayland` to force it for testing.

Use a StatusNotifier tray host (for example, a configured Waybar tray module) for close-to-tray. If a desktop accepts a tray object but has no visible tray host, disable “Keep running in the tray” in Settings. Without a Secret Service provider, you can choose to remember a password in the app's owner-only local data file; it is unencrypted. Leave the option unchecked for session-only login.

The `.deb` builder's downloaded Ruby/fpm may not execute on NixOS. `pnpm package:linux` uses Nix's fpm automatically. AppImage and `.deb` are intended for conventional Linux distributions; the Nix package is the preferred NixOS installation.

A NixOS AppImage `binfmt_misc` handler also applies to containers using the same kernel. If a present, executable AppImage reports “not found” inside a conventional Linux container, inspect the registered interpreter path: the container may not contain that host path. The native Nix package or the configured host AppImage handler avoids that container mismatch.

## Drafts and sending

Never delete the application storage directory to fix a draft or delivery problem. Local drafts, staged attachment files, outgoing MIME awaiting its Sent copy, submission records, and IMAP indexes live under the `mail` subdirectory of Electron's `userData`. The renderer keeps a separate IndexedDB copy of drafts. Cached mail can expire; drafts do not expire with it.

If sending fails, reopen the draft. Unresolved sends are listed under **Send status** in the sidebar. If delivery is **unconfirmed**, use **Check again**; SMTP servers cannot confirm delivery later, so for IMAP accounts check with a recipient or the server log. **Send a replacement…** creates a new draft and keeps the unconfirmed record. The app will not send that attempt again automatically. “Sent · Sent copy pending” means the outgoing server accepted the message; **Retry filing** only saves the copy. For a partial send, **Create draft to refused recipients** addresses only the refused recipients. If the server no longer retains enough evidence, inspect Sent and server logs before deliberately creating a replacement. Local drafts that conflict with a remote edit are kept; resolve the conflict before syncing over the server version.

If a storage file cannot be read or has a newer version, the application preserves it and refuses to overwrite it. Make a private backup of the complete profile before repair. Do not paste that backup into an issue: it contains mail and draft content.

## Diagnostics

Settings → About → Copy diagnostics includes application/runtime versions, connection statuses, and generic event codes. It excludes credentials, server addresses, email addresses, and message content. Review even redacted diagnostics before sharing. Main-process stderr may include a generic failed IPC method, but protocol bodies are not logged.

A native smoke test needs a fresh, explicitly separate `INLARK_DATA_DIR`. `--smoke-test` tests renderer-to-main IPC and starts the SQLite index worker, prints a compact result, and exits; it does not connect accounts or send mail.
