import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import * as pgp from '../packages/crypto/node_modules/openpgp/dist/node/openpgp.mjs'
import {
  CryptoEngine,
  Vault,
  seal,
  unseal,
  wkdUrls,
  parseAutocrypt,
  peerUpdate,
  peerPrefersEncryption,
  mimeContent,
  multipart,
  splitEntity,
  header,
  armoredPayload,
  signedMime,
  encryptedMime,
  type PrivateRecord,
} from '../packages/crypto/src'
import { composeMime, parseMime } from '../packages/mime/src'
const fixture = (name: string) => readFile(new URL('./fixtures/openpgp/' + name, import.meta.url))
let directories: string[] = []
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'inlark-crypto-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })))
  directories = []
})

describe('authenticated vault', () => {
  it('authenticates ciphertext, record identity, nonce and tag before returning plaintext', () => {
    const key = randomBytes(32),
      context = Buffer.from('private:key:v1'),
      box = seal(key, Buffer.from('PRIVATE SECRET'), context)
    expect(unseal(key, box, context).toString()).toBe('PRIVATE SECRET')
    for (const change of [
      { tag: randomBytes(16).toString('base64') },
      { nonce: randomBytes(12).toString('base64') },
      { data: randomBytes(14).toString('base64') },
    ])
      expect(() => unseal(key, { ...box, ...change }, context)).toThrow()
    expect(() => unseal(key, box, Buffer.from('other-key:v1'))).toThrow()
    expect(() =>
      unseal(key, { ...box, tag: Buffer.alloc(15).toString('base64') }, context),
    ).toThrow()
  })
  it('requires password fallback, survives restart, and never writes plaintext keys or drafts', async () => {
    const path = join(await directory(), 'vault.json'),
      vault = new Vault(path)
    await vault.init()
    await expect(vault.create()).rejects.toThrow('password')
    await vault.create('portable-password')
    await vault.putJSON('private:original', { secret: 'PRIVATE KEY MARKER' })
    await vault.put('draft:draft-id', Buffer.from('BODY MARKER'))
    await vault.put('attachment:1', Buffer.from('ATTACHMENT MARKER'))
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain('MARKER')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const encrypted = JSON.parse(text)
    expect(encrypted.protection.mode).toBe('password')
    expect(Buffer.from(encrypted.protection.salt, 'base64')).toHaveLength(32)
    await vault.lock()
    expect(() => vault.read('private:original')).toThrow('Unlock')
    const restored = new Vault(path)
    await restored.init()
    await expect(restored.unlock('wrong password')).rejects.toThrow('incorrect')
    expect(await readFile(path, 'utf8')).toBe(text)
    await restored.unlock('portable-password')
    expect(restored.json('private:original')).toEqual({ secret: 'PRIVATE KEY MARKER' })
    await restored.put('draft:draft-id', Buffer.from('REVISED BODY'))
    await restored.lock()
    await restored.unlock('portable-password')
    expect(restored.read('draft:draft-id')?.toString()).toBe('REVISED BODY')
  })
  it('uses OS protection only when available and refuses recreation, corruption and unknown versions', async () => {
    const path = join(await directory(), 'vault.json'),
      storage = {
        available: () => true,
        wrap: (s: string) => Buffer.from('wrapped:' + s).toString('base64'),
        unwrap: (s: string) => Buffer.from(s, 'base64').toString().slice(8),
      }
    const vault = new Vault(path, storage)
    await vault.init()
    await vault.create()
    await vault.putJSON('key:first', { secret: 'one' })
    await vault.lock()
    storage.available = () => false
    await expect(vault.unlock()).rejects.toThrow('keyring')
    await expect(vault.create('new-password')).rejects.toThrow('already exists')
    storage.available = () => true
    await vault.unlock()
    expect(vault.json('key:first')).toEqual({ secret: 'one' })
    const data = JSON.parse(await readFile(path, 'utf8'))
    data.records['key:other'] = data.records['key:first']
    delete data.records['key:first']
    await writeFile(path, JSON.stringify(data))
    const damaged = new Vault(path, storage)
    await damaged.init()
    await expect(damaged.unlock()).rejects.toThrow()
    data.version = 2
    await writeFile(path, JSON.stringify(data))
    const newer = new Vault(path, storage)
    await expect(newer.init()).rejects.toThrow('preserved')
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(2)
  })
  it('uses fresh nonces and serializes concurrent snapshots without dropping records', async () => {
    const path = join(await directory(), 'vault.json'),
      vault = new Vault(path, {
        available: () => true,
        wrap: (s) => Buffer.from(s).toString('base64'),
        unwrap: (s) => Buffer.from(s, 'base64').toString(),
      })
    await vault.init()
    await vault.create()
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => vault.put('record:' + i, Buffer.from('same content'))),
    )
    const doc = JSON.parse(await readFile(path, 'utf8'))
    expect(new Set(Object.values(doc.records).map((b: any) => b.nonce)).size).toBe(21)
    await vault.lock()
    await vault.unlock()
    expect(vault.ids('record:')).toHaveLength(20)
  })
})

describe('OpenPGP interoperability and byte preserving MIME', () => {
  let engine: CryptoEngine, alice: PrivateRecord, bob: PrivateRecord, publicKeys: string[]
  beforeAll(async () => {
    engine = new CryptoEngine()
    alice = await engine.importPrivate(
      (await fixture('alice-private.asc')).toString(),
      'alice@encryption.test',
    )
    bob = await engine.importPrivate(
      (await fixture('bob-private.asc')).toString(),
      'bob@encryption.test',
    )
    publicKeys = [alice.publicKey, bob.publicKey]
    await engine.load([alice, bob])
  })
  it('generates v4 Ed25519 signing and Curve25519 encryption keys and protected backups', async () => {
    const generated = await engine.generate('User', 'user@encryption.test'),
      key = await pgp.readPrivateKey({ armoredKey: generated.privateKey })
    expect(key.keyPacket.version).toBe(4)
    expect(key.getAlgorithmInfo().algorithm).toBe('eddsaLegacy')
    expect(key.subkeys[0].getAlgorithmInfo().algorithm).toBe('ecdh')
    const [info] = await engine.inspect(generated.publicKey, 'user@encryption.test')
    expect(info.usable).toBe(true)
    await engine.load([generated, alice, bob])
    const backup = await engine.backup(generated.fingerprint, 'separate-backup-password'),
      protectedKey = await pgp.readPrivateKey({ armoredKey: backup })
    expect(protectedKey.isDecrypted()).toBe(false)
    const restored = await engine.importPrivate(
      backup,
      'user@encryption.test',
      'separate-backup-password',
    )
    expect(restored.fingerprint).toBe(generated.fingerprint)
    await expect(
      engine.importPrivate(backup, 'other@encryption.test', 'separate-backup-password'),
    ).rejects.toThrow('match')
  })
  for (const file of ['encrypted-signed.eml', 'encrypted-unsigned.eml', 'encrypted-bcc.eml'])
    it('decrypts independent GnuPG ' + file + ' with HTML and attachment', async () => {
      const result = await engine.decrypt(armoredPayload(await fixture(file)), publicKeys),
        mime = await parseMime(result.data)
      expect(mime.text.trim()).toBe('Secret fixture body.')
      expect(mime.html).toContain('<p>Secret fixture body.</p>')
      expect(Buffer.from(mime.attachments[0].content).toString()).toBe('Secret fixture attachment.')
      expect(result.signatures.every((s) => s.valid)).toBe(true)
      if (file === 'encrypted-signed.eml')
        expect(result.signatures[0].fingerprint).toBe(alice.fingerprint)
    })
  it('preserves exact signed bytes and identifies invalid signatures without discarding readable data', async () => {
    const source = await fixture('signed.eml'),
      parts = multipart(source)
    expect(parts[0]).toEqual(await fixture('entity.mime'))
    expect(
      (await engine.verify(parts[0], splitEntity(parts[1]).body.toString(), publicKeys))[0].valid,
    ).toBe(true)
    const invalid = multipart(await fixture('invalid-signature.eml'))
    expect(
      (await engine.verify(invalid[0], splitEntity(invalid[1]).body.toString(), publicKeys))[0]
        .valid,
    ).toBe(false)
  })
  it('hides every recipient key ID for Bcc and preserves sender decryption', async () => {
    const armored = await engine.encrypt(
        await fixture('entity.mime'),
        publicKeys,
        alice.fingerprint,
        true,
      ),
      message = await pgp.readMessage({ armoredMessage: armored })
    expect(message.getEncryptionKeyIDs().every((id) => id.toHex() === '0000000000000000')).toBe(
      true,
    )
    expect((await engine.decrypt(armored, publicKeys)).signatures[0].valid).toBe(true)
  })
  it('minimizes Autocrypt advertisements to one certified address and encryption subkey', async () => {
    const advertised = await engine.autocryptKey(alice.publicKey, 'alice@encryption.test'),
      key = await pgp.readKey({ binaryKey: advertised })
    expect(key.toPacketList()).toHaveLength(5)
    expect(key.users).toHaveLength(1)
    expect(key.subkeys).toHaveLength(1)
    expect((await engine.inspect(advertised, 'alice@encryption.test'))[0].usable).toBe(true)
  })
  it('rejects expired encryption keys while allowing their private key import for historical mail', async () => {
    const expired = await pgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      subkeys: [{ curve: 'curve25519Legacy' }],
      userIDs: [{ email: 'expired@encryption.test' }],
      date: new Date(Date.now() - 86400_000),
      keyExpirationTime: 60,
      format: 'armored',
    })
    expect((await engine.inspect(expired.publicKey, 'expired@encryption.test'))[0].problem).toBe(
      'expired',
    )
    await expect(
      engine.importPrivate(expired.privateKey, 'expired@encryption.test'),
    ).rejects.toThrow()
    expect(
      (await engine.importPrivate(expired.privateKey, 'expired@encryption.test', undefined, true))
        .fingerprint,
    ).toMatch(/^[a-f0-9]{40}$/)
  })
  it('retains revoked key state across refresh and decrypts history with a retired private key', async () => {
    const ciphertext = await engine.encrypt(await fixture('entity.mime'), [bob.publicKey]),
      revoked = await engine.revoke(bob.fingerprint),
      refreshed = await engine.mergePublic(revoked, bob.publicKey)
    expect((await engine.inspect(refreshed, 'bob@encryption.test'))[0].problem).toBe('revoked')
    const replacement = await engine.generate('Bob', 'bob@encryption.test'),
      retired = await engine.importPrivate(bob.privateKey, 'bob@encryption.test', undefined, true),
      otherDevice = new CryptoEngine()
    await otherDevice.load([replacement, retired])
    expect(Buffer.from((await otherDevice.decrypt(ciphertext, publicKeys)).data)).toEqual(
      await fixture('entity.mime'),
    )
    await expect(otherDevice.encrypt(await fixture('entity.mime'), [refreshed])).rejects.toThrow()
    otherDevice.lock()
  })
  it('blocks corrupt ciphertext and clears private state on lock', async () => {
    const armored = armoredPayload(await fixture('encrypted-unsigned.eml'))
    const binary = Buffer.from(
      armored
        .split(/\r?\n/)
        .filter((line) => /^[A-Za-z0-9+/]{4,}={0,2}$/.test(line))
        .join(''),
      'base64',
    )
    binary[binary.length - 8] ^= 1
    const corrupt = (await pgp.readMessage({ binaryMessage: binary })).armor()
    await expect(engine.decrypt(corrupt, publicKeys)).rejects.toThrow()
    engine.lock()
    await expect(engine.decrypt(armored, publicKeys)).rejects.toThrow('No private key')
    await engine.load([alice, bob])
  })
  it('accepts inline encrypted and cleartext signed messages', async () => {
    expect(
      Buffer.from(
        (await engine.decrypt(armoredPayload(await fixture('inline-encrypted.eml')), publicKeys))
          .data,
      ).toString(),
    ).toContain('Secret inline fixture body.')
    const source = splitEntity(await fixture('inline-signed.eml'))
    expect(
      (await engine.verifyInline(source.body.toString(), publicKeys)).signatures[0].valid,
    ).toBe(true)
  })
  it('emits canonical MIME and verifies its own detached signature without flattening alternatives', async () => {
    const mime = await composeMime({
      from: { name: 'Alice', email: 'alice@encryption.test' },
      to: [{ name: 'Bob', email: 'bob@encryption.test' }],
      cc: [],
      bcc: [],
      subject: 'Visible',
      text: 'Secret unicode café',
      html: '<p>Secret unicode café</p>',
      messageId: 'test@encryption.test',
      attachments: [],
    })
    const content = mimeContent(mime),
      sig = await engine.sign(content, alice.fingerprint),
      signed = signedMime(content, sig),
      parts = multipart(signed)
    expect(parts[0]).toEqual(content)
    expect(
      (await engine.verify(parts[0], splitEntity(parts[1]).body.toString(), publicKeys))[0].valid,
    ).toBe(true)
    expect(
      header(splitEntity(encryptedMime(await engine.encrypt(signed, publicKeys))), 'content-type'),
    ).toContain('multipart/encrypted')
  })
})

describe('discovery and Autocrypt state', () => {
  it('uses the specified WKD hash, original local-part query, and advanced/direct paths', () => {
    const urls = wkdUrls('Joe.Doe@Example.ORG')
    expect(urls.advanced).toBe(
      'https://openpgpkey.example.org/.well-known/openpgpkey/example.org/hu/iy9q119eutrkn8s1mk4r39qejnbu3n5q?l=Joe.Doe',
    )
    expect(urls.direct).toContain('/.well-known/openpgpkey/hu/iy9q119eutrkn8s1mk4r39qejnbu3n5q')
  })
  it('rejects wrong sender, duplicate attributes, invalid base64, unsupported critical attributes and oversized headers', () => {
    const valid = 'addr=alice@encryption.test; prefer-encrypt=mutual; keydata=YWJj'
    expect(parseAutocrypt(valid, 'Alice@encryption.test')?.mutual).toBe(true)
    for (const value of [
      valid.replace('alice', 'other'),
      valid + '; keydata=YWJj',
      valid.replace('keydata=', 'critical=1; keydata='),
      valid.replace('YWJj', '!!'),
      valid + ' '.repeat(10240),
    ])
      expect(parseAutocrypt(value, 'alice@encryption.test')).toBeUndefined()
    expect(parseAutocrypt(valid.replace('keydata=', '_extra=1; keydata='))?.data).toEqual(
      Buffer.from('abc'),
    )
  })
  it('ignores older headers, clamps future timestamps and discourages stale encryption preferences', () => {
    const peer = peerUpdate({}, '2026-10-07T12:00:00Z', '2026-10-07T10:00:00Z', {
      fingerprint: 'first',
      mutual: true,
    })
    expect(peerPrefersEncryption(peer)).toBe(true)
    expect(
      peerUpdate(peer, '2026-10-07T12:00:00Z', '2026-10-06T10:00:00Z', {
        fingerprint: 'old',
        mutual: false,
      }),
    ).toEqual(peer)
    const future = peerUpdate(peer, '2026-10-07T12:00:00Z', '2099-01-01T00:00:00Z', {
      fingerprint: 'new',
      mutual: true,
    })
    expect(future.autocryptAt).toBe('2026-10-07T12:00:00.000Z')
    expect(peerPrefersEncryption({ ...peer, lastSeen: '2026-12-07T12:00:00.000Z' })).toBe(false)
  })
})
