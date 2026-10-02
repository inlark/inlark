# Desktop releases

Push a `v<version>` tag to run `.github/workflows/release.yml`. The workflow sets
the desktop package version from the tag, builds the platform installers and
publishes a GitHub Release after every build and verification succeeds.
Prerelease tags produce prereleases and their own update channel metadata.

## Windows signing with Certum

Inlark uses the same Certum SimplySign certificate and automation as BlinkDisk.
Add these repository secrets in
[GitHub Actions settings](https://github.com/inlark/inlark/settings/secrets/actions),
using the same values as BlinkDisk:

| Secret                    | Value                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `CERTUM_USERNAME`         | SimplySign account username                                     |
| `CERTUM_OTP_URI`          | Full `otpauth://totp/…` URI used by BlinkDisk's automated login |
| `CERTUM_CERTIFICATE_SHA1` | SHA-1 thumbprint of the code signing certificate                |

GitHub cannot return existing secret values. Retrieve them from the original
credential storage or configure a shared organization secret if both repositories
can access it. Keep the OTP URI out of source control and build logs; it contains
the secret needed to generate login codes.

The optional repository variable `CERTUM_TIMESTAMP_SERVER` overrides the RFC 3161
timestamp service. It defaults to BlinkDisk's `http://time.certum.pl`.

The Windows release job:

1. Installs SimplySign Desktop **9.4.3.90**, checking the same pinned SHA-256
   checksum as BlinkDisk.
2. Applies BlinkDisk's registry settings, opens the login dialog and submits the
   username and a generated TOTP code. The SHA-256 TOTP default matches BlinkDisk;
   explicit algorithm, period and digit parameters in the URI are respected.
3. Waits for the certificate with the configured thumbprint to appear in the
   Windows certificate store. Authentication happens immediately before packaging
   to keep the cloud signing session fresh.
4. Downloads Certum's intermediate certificate and lets electron-builder sign the
   app, NSIS uninstaller and installer using SHA-256 and RFC 3161 timestamps.
   The certificate's publisher name is also included in update metadata for
   electron-updater's signature verification.
5. Verifies that both `win-unpacked/Inlark.exe` and the final installer have valid,
   timestamped signatures from the expected certificate before uploading assets.

Windows packaging requires signing (`win.forceCodeSigning: true`); missing
credentials, failed login or invalid signatures stop the release. For an unsigned
local development build, explicitly pass `--config.win.forceCodeSigning=false`.
SimplySign's GUI automation requires an interactive Windows runner; keep the
hosted `windows-2025` runner unless a replacement has been tested with the login
scripts.

When the certificate is renewed, update `CERTUM_CERTIFICATE_SHA1` in both
repositories. When changing SimplySign versions, verify GUI behavior and replace
the installer URL and checksum together in `.github/scripts/install-simplysign.sh`.

## macOS signing and notarization

macOS releases require `MAC_CSC_LINK` (the Developer ID Application certificate),
`MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY` (the `.p8` private key text),
`APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. The workflow signs and notarizes both
architectures, verifies the apps inside their ZIPs and removes the temporary API
key. Missing credentials stop the release.
