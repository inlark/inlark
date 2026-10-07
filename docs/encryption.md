# Email encryption

Encryption is optional for each sending identity. Open **Settings → Encryption** and choose **Set up…** next to an address, then **Create a new key**, **Import an existing key** or **Transfer from another device**. inlark checks for published keys for your address before creating one; if it finds one, it suggests importing the original private key instead. Public keys let other people encrypt mail to you. Private keys unlock that mail and must stay protected. Each address has its own switch to turn encryption on or off, and a **Manage** menu for its key.

## Protect and recover your keys

inlark uses secure OS key storage to protect its local vault when available. Otherwise you must choose a vault password. Private keys are never saved unprotected, even if ordinary account credentials use the existing insecure-storage fallback. If secure storage becomes unavailable, inlark preserves the vault and asks you to restore access; it never creates a replacement automatically.

Setup ends by asking for a backup: a password-protected key file whose password you keep separately. **Back up later** requires acknowledging that losing the key can make encrypted mail permanently unreadable; a reminder remains in Settings and the sidebar until you back up. Resetting your email password cannot recover your private key or vault password. Import a backup using **Import an existing key**. An address's **Manage** menu offers **Back up key…**, **Export public key…**, **Move to another device…**, **Import an older key…** for historical mail, **Replace key…** (create or import) and **Revoke key…**. Replaced keys appear under **Older keys**, where they can still be backed up, exported or revoked. Replacing or revoking a key retains the original private key for historical decryption.

**Lock** under **Key storage**, or **Lock encryption keys** in the command menu, saves open drafts before locking. It clears decrypted messages, attachments and key state. Encrypted messages then show an **Unlock** button; keyring-protected keys unlock without a prompt, and password-protected vaults ask for the vault password. Encryption cannot protect content on an already compromised or unlocked device.

## Compose and read mail

For addresses with encryption set up, the composer toolbar offers **Encrypt** (which also signs), **Sign only** and **Don’t encrypt**; `Ctrl+Shift+E` (`⌘⇧E` on macOS) switches encryption on or off. While encrypting, a bar above the message says who it is encrypted for, recipient chips show a lock, and the send button reads **Send encrypted**. New conversations automatically select encryption only when your identity and every recipient prefer it and usable keys are available. Replies and forwards containing decrypted content start protected before their first autosave.

An encrypted send is blocked if any recipient's key is missing, expired, revoked, changed or conflicting. The bar names each affected recipient and the reason; select one to review their keys. inlark never silently switches to ordinary mail. Sending a previously protected draft or reply unencrypted requires an explicit change and confirmation.

Bodies, HTML, attachments and inline images are encrypted. Subjects, addresses, dates, message sizes and delivery information remain visible. Encrypted mail search uses visible metadata; decrypted bodies are not indexed. Sign-only messages remain readable by the mail server and recipients.

The reader labels encryption, signature validity and verified sender separately above the message; select the labels for an explanation of each and the signing key's fingerprint. A valid signature establishes that a key signed the content; it does not by itself establish who owns the key. Compare fingerprints through another channel and choose **It matches, mark as verified** when you have done so. Messages that can't be shown explain why: locked keys, a key missing from this device, or failed integrity. An integrity failure blocks content and attachments. Invalid signatures produce a warning. Decrypted HTML uses the normal reader sanitation, and remote content stays blocked until you explicitly permit it for that message.

## Drafts and sending

Only drafts with encryption selected are protected locally. Their bodies and staged attachments are saved in the main-process encrypted vault; their server copies are PGP/MIME encrypted to your own key. Ordinary drafts and sign-only drafts retain their existing storage behavior. The server draft's encrypted revision is compared without replacing ciphertext with an ordinary body.

If an earlier autosave was unencrypted, the composer warns you. Encrypting a replacement cannot erase server backups, revision history, other clients' caches or earlier deliveries. Original files you choose as attachments remain in their original location; inlark protects its staged copies. Explicitly saving a decrypted attachment exports ordinary content to the location you choose.

inlark encrypts outgoing mail to every recipient and your own key and signs it by default. Bcc addresses are removed from delivered headers and gossip, and recipient key IDs are anonymized when Bcc is used. SMTP and JMAP delivery use an explicit envelope. Prepared messages are persisted before submission. Existing partial-delivery, unconfirmed-send and Sent-copy recovery continue without automatic retransmission.

## Discovery and device transfer

inlark prefers your accepted key. Without one it checks the recipient's WKD directory, then available Autocrypt information. A first usable key can be used while labeled unconfirmed. Multiple candidates require a choice. A changed fingerprint always requires review; old keys are preserved. Refreshing the same fingerprint updates its certifications and revocations without treating it as a replacement.

For enabled identities, recipient checks can read Autocrypt headers from up to 40 recent matching messages, including unopened mail, without downloading their bodies. These lookups are cached for two minutes. **Settings → Encryption → Contacts’ keys** lists the keys found so far and looks up any address; a contact's key dialog shows where each key came from, lets you choose between changed or conflicting keys, mark a key as verified, and **Check again**. Disabled identities do not trigger automatic discovery.

Autocrypt advertises no encryption preference until you explicitly select **Prefer encrypted mail**. Peer state follows message chronology, ignores malformed or wrong-address headers and stops recommending stale preferences. Gossip is included only inside encrypted mail and only for visible recipients. inlark deliberately requires review for changed fingerprints, which is stricter than ordinary automatic Autocrypt key replacement.

**Move to another device…** exports an Autocrypt Setup Message only when you initiate it. Keep the generated numeric code separate from the message. On the other device, choose **Transfer from another device**, enter that code and choose the message to restore the key and its encryption preference. inlark never distributes private keys automatically.

WKD discovers public keys; inlark does not publish a directory. Domain administrators can use **Export public key…** and publish a binary key under the advanced or direct WKD path, together with the domain's policy file. Follow the [WKD discovery specification](https://www.ietf.org/archive/id/draft-koch-openpgp-webkey-service-20.html) for address hashing, directory layout and HTTPS requirements. Key exports are ASCII armored; convert to binary before publishing.

## Implementation and release checks

The shared `@inlark/crypto` package runs OpenPGP.js in a dedicated desktop worker. Private keys never enter the renderer. The versioned vault uses Node AES-256-GCM with a random 32-byte key, fresh 12-byte nonces, 16-byte authentication tags and authenticated vault/record identity and version. Password fallback uses asynchronous scrypt with a random 32-byte salt, `N=131072`, `r=8`, `p=1` and a 256 MiB memory allowance. Atomic writes authenticate all records before exposing plaintext.

MIME input and decompressed messages are bounded to 64 MiB, individual key input and WKD responses to 1 MiB, Autocrypt headers to 10 KiB, and the serialized local vault to 256 MiB. Content beyond these limits requires a smaller message or another client. No hosted service or telemetry is involved. S/MIME, hardware tokens, system GnuPG integration, subject encryption and encrypted-body search are outside this implementation.

Run:

```sh
pnpm check
pnpm test:packaged-crypto
pnpm test:crypto-interop    # requires GnuPG
pnpm test:stalwart         # disposable server; requires Podman or Docker
```

After building a Linux unpacked distribution, verify its ASAR worker with its own runtime:

```sh
INLARK_CRYPTO_WORKER_DIRECTORY=apps/desktop/release/linux-unpacked/resources/app.asar/out/main \
ELECTRON_RUN_AS_NODE=1 apps/desktop/release/linux-unpacked/inlark \
  scripts/test-crypto-worker.mjs --gnupg
```

Automated coverage includes GnuPG fixtures, hidden recipients, integrity and signature failures, retired keys, vault tampering and restoration, protected draft crash recovery and tombstones, WKD fallback and address matching, key-change blocking, stale Autocrypt state, and Setup Message restoration. Stalwart tests exercise raw encrypted MIME through IMAP APPEND/SMTP and JMAP upload/import/submission. Tests inspect protected draft uploads and persisted vault/stub files for plaintext markers.

Release remains gated on Thunderbird interoperability, packaged keyring/password/backup tests on Linux, Windows and macOS, and an end-to-end plaintext inspection of IndexedDB, notifications, diagnostics, attachment staging and network uploads in those packaged environments. The browser demo does not perform cryptography and cannot validate secure OS storage. Do not publish this feature as release-ready until those checks pass.
