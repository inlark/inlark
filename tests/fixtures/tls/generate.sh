#!/usr/bin/env bash
# Regenerates the test-only TLS fixtures. The keys are public and must never be trusted outside tests.
set -euo pipefail
cd "$(dirname "$0")"
days=7300
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Test CA
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days "$days" \
  -subj '/CN=Inlark Test CA' -keyout ca.key -out ca.crt \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'

# Server certificate for localhost and 127.0.0.1, signed by the test CA
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj '/CN=localhost' \
  -keyout server.key -out "$tmp/server.csr"
cat > "$tmp/server.ext" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EXT
openssl x509 -req -in "$tmp/server.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days "$days" \
  -extfile "$tmp/server.ext" -out server.crt
rm -f ca.srl

# Self-signed certificate for the same names that no test trusts
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days "$days" \
  -subj '/CN=localhost' -keyout untrusted.key -out untrusted.crt \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -addext 'extendedKeyUsage=serverAuth'
