# Desktop releases

Pushing a `v*` version tag runs [the release workflow](../.github/workflows/release.yml). It builds
Linux, Windows, Intel macOS and Apple Silicon macOS packages, checks the Nix package, and publishes
the installers and updater files to a GitHub Release. Tags with a prerelease suffix create prereleases.

## One-time macOS setup

Add these **repository Actions secrets** in [Settings → Secrets and variables → Actions](https://github.com/inlark/inlark/settings/secrets/actions):

| Secret                 | Value                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `MAC_CSC_LINK`         | Base64-encoded `.p12` containing your Developer ID Application certificate **and its private key**.         |
| `MAC_CSC_KEY_PASSWORD` | The password used when exporting the `.p12`.                                                                |
| `APPLE_API_KEY`        | The full contents of your App Store Connect team API key's `.p8` file, including the PEM header and footer. |
| `APPLE_API_KEY_ID`     | That API key's Key ID.                                                                                      |
| `APPLE_API_ISSUER`     | The team's Issuer ID from App Store Connect.                                                                |

### Signing certificate

1. Create a [Developer ID Application certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
   in your Apple Developer account using a certificate signing request generated on your Mac.
2. Download the certificate and import it into Keychain Access on the Mac that generated the request.
3. In Keychain Access → My Certificates, export the certificate together with its private key as a
   `.p12`, protected with a password. Save that password as `MAC_CSC_KEY_PASSWORD`.
4. Copy the base64-encoded certificate to the clipboard and save it as `MAC_CSC_LINK`:

   ```sh
   base64 -i Inlark-Developer-ID.p12 | pbcopy
   ```

Use **Developer ID Application** for distribution outside the Mac App Store. An Apple Development,
Apple Distribution or Developer ID Installer certificate won't work for this app.

### Notarization key

1. Open App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys.
   The Account Holder may need to request API access first. See [Apple's API key setup guide](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/).
2. Generate a team API key with Developer access, and download its `.p8` private key. Apple allows the
   private key to be downloaded only once, so keep a secure copy.
3. Save the complete `.p8` contents as `APPLE_API_KEY`, the Key ID as `APPLE_API_KEY_ID`, and the
   Issuer ID as `APPLE_API_ISSUER`. The Issuer ID is separate from your Apple Developer Team ID.

CI writes the `.p8` to a private temporary file and passes its **path** as electron-builder's
`APPLE_API_KEY` environment variable. The repository secret contains the key itself, not a local path.
The temporary file is removed even when packaging fails. electron-builder imports the `.p12` into
its temporary signing keychain and uses its built-in notarization support; no custom hook is needed.
This setup doesn't require an App Store app listing or an Apple ID password in CI.

## macOS artifacts and verification

Each architecture produces `Inlark-<version>-<arch>.dmg`, `Inlark-<version>-<arch>.zip`, and blockmaps.
The app uses Hardened Runtime and electron-builder's bundled Electron entitlements. electron-builder
signs and notarizes the app, staples Apple's ticket, and then creates the distribution files.

The macOS job extracts **both ZIPs** and checks the Developer ID signature, stapled notarization
ticket and Gatekeeper assessment before uploading artifacts. Missing credentials, signing errors,
notarization rejection or failed verification stop the release.

The publish job requires both ZIPs and their blockmaps and checks that both ZIPs appear in
`latest-mac.yml` (or `<channel>-mac.yml` for prereleases). These files are uploaded alongside the DMGs.
The ZIPs contain the same signed, notarized app as the installers and are required by
[electron-updater's macOS updater](https://www.electron.build/auto-update).

An existing unsigned macOS installation cannot automatically upgrade to a signed one. Install the
first signed release manually; later signed releases can update automatically. Keep using a
Developer ID Application certificate from the same Apple Developer team for subsequent releases.
