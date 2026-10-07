# Independent OpenPGP fixtures

`generate.py` uses GnuPG to produce synthetic v4 Ed25519/Curve25519 keys and messages, independently of OpenPGP.js. Generated with GnuPG 2.4.9 on Linux. The Alice, Bob and Carol addresses use the reserved `.test` domain. The checked-in private keys are deliberately public test fixtures and must never be used for real mail.

Fixtures cover signed and unsigned PGP/MIME encryption, hidden recipients, exact-byte detached signatures, invalid signatures, inline encryption, inline cleartext signatures, HTML alternatives and attachments. Regeneration changes key fingerprints and ciphertext; tests derive fingerprints from the keys rather than hard-coding them.

Run `python3 tests/fixtures/openpgp/generate.py` with GnuPG installed to regenerate. Run `pnpm test:crypto-interop` to check the reverse direction: GnuPG decrypts and verifies output from the bundled Inlark worker and imports a password-protected backup. It uses a disposable keyring and kills its test agent on completion.

Thunderbird interoperability is a separate release requirement; these fixtures do not stand in for a Thunderbird test.
