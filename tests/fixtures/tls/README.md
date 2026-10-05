# Test TLS fixtures

These certificates and private keys exist only for the automated tests. The keys are public, so never trust `ca.crt` or use any of these files outside tests.

- `ca.crt` / `ca.key`: the test certificate authority.
- `server.crt` / `server.key`: `localhost` and `127.0.0.1`, signed by the test CA.
- `untrusted.crt` / `untrusted.key`: a self-signed certificate for the same names. Only tests of certificates the user chose to trust accept it.
- `expired.crt` / `expired.key`: a self-signed certificate for the same names that expired in 2021.

Run `generate.sh` to recreate them (valid for 20 years, except the expired one).
