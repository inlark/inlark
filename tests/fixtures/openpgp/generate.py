#!/usr/bin/env python3
"""Generate synthetic interoperability fixtures with GnuPG, independent of OpenPGP.js."""
from pathlib import Path
import subprocess
import tempfile
import sys

out = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='inlark-gpg-') as home:
    base = ['gpg', '--homedir', home, '--batch', '--yes', '--no-tty', '--pinentry-mode', 'loopback', '--passphrase', '']
    def run(args, data=None):
        result = subprocess.run(base + args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            sys.stderr.write(result.stderr.decode())
            result.check_returncode()
        return result.stdout
    keys = {}
    for name in ['alice', 'bob', 'carol']:
        address = f'{name}@encryption.test'
        run(['--quick-generate-key', f'{name.title()} Fixture <{address}>', 'ed25519', 'sign', '0'])
        fingerprint = next(line.split(':')[9] for line in run(['--with-colons', '--list-keys', address]).decode().splitlines() if line.startswith('fpr:'))
        run(['--quick-add-key', fingerprint, 'cv25519', 'encr', '0'])
        keys[name] = fingerprint
        (out / f'{name}-public.asc').write_bytes(run(['--armor', '--export', fingerprint]))
        (out / f'{name}-private.asc').write_bytes(run(['--armor', '--export-secret-keys', fingerprint]))
    entity = ('Content-Type: multipart/mixed; boundary="fixture-mixed"\r\n\r\n'
        '--fixture-mixed\r\nContent-Type: multipart/alternative; boundary="fixture-alt"\r\n\r\n'
        '--fixture-alt\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'
        'U2VjcmV0IGZpeHR1cmUgYm9keS4=\r\n--fixture-alt\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'
        'PHA+U2VjcmV0IGZpeHR1cmUgYm9keS48L3A+\r\n--fixture-alt--\r\n'
        '\r\n--fixture-mixed\r\nContent-Type: text/plain; name="secret.txt"\r\nContent-Disposition: attachment; filename="secret.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n'
        'U2VjcmV0IGZpeHR1cmUgYXR0YWNobWVudC4=\r\n--fixture-mixed--\r\n').encode()
    (out / 'entity.mime').write_bytes(entity)
    headers = b'From: Alice Fixture <alice@encryption.test>\r\nTo: Bob Fixture <bob@encryption.test>\r\nSubject: Visible fixture subject\r\nDate: Wed, 7 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\n'
    def encrypted(armor):
        return headers + b'Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="fixture-pgp"\r\n\r\n--fixture-pgp\r\nContent-Type: application/pgp-encrypted\r\n\r\nVersion: 1\r\n\r\n--fixture-pgp\r\nContent-Type: application/octet-stream\r\n\r\n' + armor.replace(b'\n', b'\r\n') + b'\r\n--fixture-pgp--\r\n'
    for name, flags in [('encrypted-unsigned', []), ('encrypted-signed', ['--sign']), ('encrypted-bcc', ['--hidden-recipient', keys['carol']])]:
        armor = run(['--armor', '--trust-model', 'always', '--local-user', keys['alice'], '--recipient', keys['alice'], '--recipient', keys['bob']] + flags + ['--encrypt'], entity)
        (out / f'{name}.eml').write_bytes(encrypted(armor))
    signature = run(['--armor', '--local-user', keys['alice'], '--detach-sign'], entity).replace(b'\n', b'\r\n')
    signed = headers + b'Content-Type: multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha256; boundary="fixture-sig"\r\n\r\n--fixture-sig\r\n' + entity + b'\r\n--fixture-sig\r\nContent-Type: application/pgp-signature\r\n\r\n' + signature + b'\r\n--fixture-sig--\r\n'
    (out / 'signed.eml').write_bytes(signed)
    (out / 'invalid-signature.eml').write_bytes(signed.replace(b'U2VjcmV0IGZpeHR1cmUgYm9keS4=', b'QWx0ZXJlZCBmaXh0dXJlIGJvZHk='))
    text = b'Secret inline fixture body.\n'
    inline = run(['--armor', '--trust-model', 'always', '--recipient', keys['bob'], '--encrypt'], text)
    (out / 'inline-encrypted.eml').write_bytes(headers + b'Content-Type: text/plain; charset=utf-8\r\n\r\n' + inline.replace(b'\n', b'\r\n'))
    clear = run(['--armor', '--local-user', keys['alice'], '--clearsign'], text)
    (out / 'inline-signed.eml').write_bytes(headers + b'Content-Type: text/plain; charset=utf-8\r\n\r\n' + clear.replace(b'\n', b'\r\n'))
    (out / 'unsigned.eml').write_bytes(headers + entity)
    subprocess.run(['gpgconf', '--homedir', home, '--kill', 'gpg-agent'], check=False)
