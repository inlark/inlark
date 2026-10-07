import { publicFetch } from '../apps/desktop/src/main/public-fetch'
import { lookup } from 'node:dns/promises'
import { dialog } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CryptoEngine, Vault } from '../packages/crypto/src'
import { identityKey, type Draft, type Identity, type Message } from '../packages/core/src'
import { JsonStore } from '../apps/desktop/src/main/storage'
import { EncryptionService, type CryptoTransport } from '../apps/desktop/src/main/encryption'
import { MailService } from '../apps/desktop/src/main/service'
import { ImapProvider } from '../packages/imap/src'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import { FakeImapServer } from './support/fake-imap'
import { parseMime } from '../packages/mime/src'
import {
  armoredPayload,
  encryptedMime,
  splitEntity,
  header,
  autocryptHeader,
} from '../packages/crypto/src'
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: {},
  Notification: { isSupported: () => false },
}))
vi.mock('../apps/desktop/src/main/public-fetch', () => ({
  publicFetch: vi.fn(async () => ({ status: 404, type: '', bytes: Buffer.alloc(0) })),
}))
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '1.1.1.1', family: 4 }]),
}))
const file = (name: string) => readFile(new URL('./fixtures/openpgp/' + name, import.meta.url))
let directory: string, store: JsonStore, service: EncryptionService, engine: CryptoEngine
const own: Identity = {
  id: 'default',
  accountId: JSON.stringify(['crypto-test', 'imap']),
  name: 'Bob',
  email: 'bob@encryption.test',
}
const message: Message = {
  id: 'fixture',
  accountId: own.accountId,
  threadId: 'thread',
  subject: 'Visible fixture subject',
  from: [{ name: 'Alice', email: 'alice@encryption.test' }],
  to: [{ name: 'Bob', email: own.email }],
  cc: [],
  bcc: [],
  replyTo: [],
  receivedAt: '2026-10-07T12:00:00.000Z',
  sentAt: '2026-10-07T10:00:00.000Z',
  preview: '',
  size: 1,
  hasAttachment: true,
  keywords: { $seen: true },
  mailboxIds: { inbox: true },
}
const draft = (): Draft => ({
  id: randomUUID(),
  accountId: own.accountId,
  identityId: own.id,
  to: [{ name: 'Alice', email: 'alice@encryption.test' }],
  cc: [],
  bcc: [{ name: 'Carol', email: 'carol@encryption.test' }],
  subject: 'VISIBLE',
  text: 'PRIVATE BODY MARKER',
  html: '<p>PRIVATE BODY MARKER</p>',
  attachments: [],
  updatedAt: new Date().toISOString(),
  status: 'local',
  encryption: 'encrypt',
})
const factory = (): CryptoTransport =>
  ({
    call: async (method, ...args) => (engine[method] as Function).apply(engine, args),
    close: async () => {
      engine.lock()
    },
  }) as CryptoTransport
async function seed() {
  const privateRecord = await engine.importPrivate(
    (await file('bob-private.asc')).toString(),
    own.email,
  )
  const vault = new Vault(join(directory, 'encryption-vault.json'))
  await vault.init()
  await vault.create('vault-password')
  await vault.putJSON('private:' + privateRecord.fingerprint, privateRecord)
  await vault.lock()
  const keys = [] as any[]
  for (const name of ['alice', 'bob', 'carol']) {
    const email = name + '@encryption.test',
      [info] = await engine.inspect((await file(name + '-public.asc')).toString(), email)
    keys.push({
      ...info,
      email,
      binary: Buffer.from(info.binary).toString('base64'),
      sources: [name === 'bob' ? 'own' : 'autocrypt'],
      confirmed: name === 'bob',
      accepted: true,
      backup: name === 'bob' ? 'needed' : undefined,
    })
  }
  await store.write('encryption-state', {
    identities: {
      [identityKey(own.accountId, own.id)]: {
        accountId: own.accountId,
        identityId: own.id,
        email: own.email,
        fingerprint: privateRecord.fingerprint,
        enabled: true,
        prefer: false,
      },
    },
    keys,
    accepted: Object.fromEntries(keys.map((k) => [k.email, k.fingerprint])),
    peers: {},
    refreshed: {},
  })
}
beforeEach(async () => {
  vi.mocked(dialog.showOpenDialog).mockReset()
  vi.mocked(dialog.showSaveDialog).mockReset()
  vi.mocked(publicFetch)
    .mockReset()
    .mockResolvedValue({ status: 404, type: '', bytes: Buffer.alloc(0) })
  vi.mocked(lookup)
    .mockReset()
    .mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any)
  directory = await mkdtemp(join(tmpdir(), 'inlark-encryption-'))
  store = new JsonStore(directory)
  await store.init()
  engine = new CryptoEngine()
  await seed()
  service = new EncryptionService(store, factory)
  await service.init()
  await service.unlock('vault-password')
})
afterEach(async () => {
  await service.lock()
  await rm(directory, { recursive: true, force: true })
  vi.clearAllMocks()
})

it('separates encryption, signature validity and confirmed sender identity, including inline and unsigned mail', async () => {
  for (const name of [
    'encrypted-signed.eml',
    'encrypted-unsigned.eml',
    'signed.eml',
    'invalid-signature.eml',
    'inline-encrypted.eml',
    'inline-signed.eml',
  ]) {
    const result = await service.read(message, await file(name))
    expect(['decrypted', 'signed']).toContain(result.security?.state)
    expect(result.text).toContain('fixture')
    expect(result.security?.confirmed).toBe(false)
    if (name === 'invalid-signature.eml') expect(result.security?.signature).toBe('invalid')
    if (name === 'encrypted-unsigned.eml') expect(result.security?.signature).toBe('unsigned')
    if (name === 'encrypted-signed.eml') expect(result.security?.signature).toBe('valid')
  }
  const status = await service.status(),
    key = status.keys.find((k) => k.email === 'alice@encryption.test')!
  await service.accept(key.email, key.fingerprint, true)
  expect(
    (await service.read(message, await file('encrypted-signed.eml'))).security?.confirmed,
  ).toBe(true)
  const inline = splitEntity(await file('inline-encrypted.eml'))
  const encoded = Buffer.from(
    'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      inline.body.toString('base64') +
      '\r\n',
  )
  expect((await service.read(message, encoded)).text).toContain('Secret inline fixture body.')
  const state: any = await store.read('encryption-state', {})
  state.keys = state.keys.filter((key: any) => key.email !== 'alice@encryption.test')
  await store.write('encryption-state', state)
  const withoutSigner = new EncryptionService(store, factory)
  await withoutSigner.init()
  await withoutSigner.unlock('vault-password')
  const unverified = await withoutSigner.read(message, await file('encrypted-signed.eml'))
  expect(unverified.security).toMatchObject({
    state: 'decrypted',
    signature: 'unknown',
    confirmed: false,
  })
  expect(unverified.text).toContain('fixture')
  await withoutSigner.lock()
})
it('locks decrypted attachments and views, and never exposes content on locked or missing-key reads', async () => {
  const read = await service.read(message, await file('encrypted-signed.eml'))
  expect(service.attachments.size).toBeGreaterThan(0)
  const attachment = service.attachments.get(read.attachments![0].blobId)!.content
  await service.lock()
  expect(service.attachments.size).toBe(0)
  expect(attachment.every((byte) => byte === 0)).toBe(true)
  const locked = await service.read(message, await file('encrypted-signed.eml'))
  expect(locked.security?.state).toBe('locked')
  expect(locked.text).toBe('')
  expect(locked.attachments).toEqual([])
})
it('blocks corrupted ciphertext and missing-key reads before releasing bodies or attachment handles', async () => {
  const armor = armoredPayload(await file('encrypted-unsigned.eml')),
    line = armor
      .split(/\r?\n/)
      .filter((value) => /^[A-Za-z0-9+/]{4,}={0,2}$/.test(value))
      .at(-1)!,
    corrupt = armor.replace(line, (line[0] === 'A' ? 'B' : 'A') + line.slice(1))
  const blocked = await service.read(message, encryptedMime(corrupt))
  expect(blocked.security?.state).toBe('integrityFailure')
  expect(blocked.text).toBe('')
  expect(blocked.attachments).toEqual([])
  expect(service.attachments.size).toBe(0)
  await engine.load([
    await engine.importPrivate(
      (await file('alice-private.asc')).toString(),
      'alice@encryption.test',
    ),
  ])
  const missing = await service.read(message, await file('inline-encrypted.eml'))
  expect(missing.security?.state).toBe('missingKey')
  expect(missing.text).toBe('')
  expect(service.attachments.size).toBe(0)
})
it('allows explicit ordinary mail with an unusable sender key while blocking protected sends', async () => {
  const state: any = await store.read('encryption-state', {}),
    key = state.keys.find((k: any) => k.email === own.email)
  key.publicKey = await engine.revoke(key.fingerprint)
  await store.write('encryption-state', state)
  const changed = new EncryptionService(store, factory)
  await changed.init()
  await changed.unlock('vault-password')
  await expect(changed.compose(draft(), own, 'blocked@encryption.test', [])).rejects.toThrow(
    'sender’s key',
  )
  const ordinary = await changed.compose(
    { ...draft(), encryption: 'none', downgradeConfirmed: true },
    own,
    'ordinary@encryption.test',
    [],
  )
  expect((await parseMime(ordinary)).text).toContain('PRIVATE BODY MARKER')
  expect(header(splitEntity(ordinary), 'autocrypt')).toBe('')
  await changed.lock()
})
it('encrypts Bcc content to all recipients and sender, omits Bcc headers and gossip, and encrypts drafts only to self', async () => {
  const input = draft(),
    mime = await service.compose(input, own, 'message@encryption.test', [
      {
        name: 'private.txt',
        type: 'text/plain',
        content: Buffer.from('PRIVATE ATTACHMENT MARKER'),
      },
    ])
  expect(mime.toString()).not.toContain('MARKER')
  expect(mime.toString()).not.toContain('carol@encryption.test')
  expect(header(splitEntity(mime), 'bcc')).toBe('')
  const record = await engine.importPrivate(
    (await file('alice-private.asc')).toString(),
    'alice@encryption.test',
  )
  await engine.load([record])
  const decrypted = await engine.decrypt(
    armoredPayload(mime),
    (await service.status()).keys.map((k) => k.publicKey),
  )
  expect(Buffer.from(decrypted.data).toString()).not.toContain('addr=carol@encryption.test')
  expect((await parseMime(decrypted.data)).text).toContain('PRIVATE BODY MARKER')
  await engine.load([
    await engine.importPrivate((await file('bob-private.asc')).toString(), own.email),
  ])
  const self = await service.compose(input, own, 'draft@encryption.test', [], true)
  expect(header(splitEntity(self), 'autocrypt-draft-state')).toContain('encrypt=yes')
  await engine.load([record])
  await expect(engine.decrypt(armoredPayload(self), [record.publicKey])).rejects.toThrow()
})
it('blocks changed, conflicting and unusable recipient keys without downgrading', async () => {
  const state: any = await store.read('encryption-state', {})
  const replacement = await engine.generate('Alice replacement', 'alice@encryption.test'),
    [info] = await engine.inspect(replacement.publicKey, 'alice@encryption.test')
  state.keys.push({
    ...info,
    email: 'alice@encryption.test',
    binary: Buffer.from(info.binary).toString('base64'),
    sources: ['wkd'],
    confirmed: false,
    accepted: false,
  })
  await store.write('encryption-state', state)
  const changed = new EncryptionService(store, factory)
  await changed.init()
  await changed.unlock('vault-password')
  const ready = await changed.readiness(own.accountId, own.id, ['alice@encryption.test'])
  expect(ready.recipients[0].status).toBe('changed')
  expect(ready.recommend).toBe(false)
  await expect(changed.compose(draft(), own, 'blocked@encryption.test', [])).rejects.toThrow(
    'alice@encryption.test (changed)',
  )
  await changed.accept('alice@encryption.test', info.fingerprint, false)
  expect(
    (await changed.readiness(own.accountId, own.id, ['alice@encryption.test'])).recipients[0]
      .status,
  ).toBe('ready')
  await changed.lock()
})
it('imports an explicitly chosen replacement while retaining, decrypting and backing up the original private key', async () => {
  const old = (await service.status()).identities[0].fingerprint,
    replacement = await engine.generate('Bob replacement', own.email),
    input = join(directory, 'replacement.asc')
  await writeFile(input, replacement.privateKey)
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [input] })
  const status = await service.setup(own, 'replace', undefined, undefined, true)
  expect(status.identities[0].fingerprint).toBe(replacement.fingerprint)
  expect(status.keys.find((k) => k.fingerprint === old)).toMatchObject({
    retired: true,
    accepted: false,
  })
  expect(status.keys.find((k) => k.fingerprint === replacement.fingerprint)).toMatchObject({
    retired: false,
    accepted: true,
  })
  expect(service.vault.ids('private:')).toContain('private:' + old)
  expect((await service.read(message, await file('encrypted-signed.eml'))).text).toContain(
    'Secret fixture body.',
  )
  const path = join(directory, 'retired-backup.asc')
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: path })
  await service.exportKey(old, 'backup', 'separate-backup-password')
  expect(
    (
      await engine.importPrivate(
        await readFile(path, 'utf8'),
        own.email,
        'separate-backup-password',
        true,
      )
    ).fingerprint,
  ).toBe(old)
  expect(JSON.stringify(await service.status())).not.toContain('PGP PRIVATE KEY')
})
it('keeps protected main-process drafts and attachments encrypted through crash recovery, lock and tombstones', async () => {
  const server = new FakeImapServer(),
    submit = vi.fn(async () => ({
      accepted: ['alice@encryption.test', 'carol@encryption.test'],
      rejected: [],
    }))
  const main = new MailService(store, () => {}, {
    crypto: factory,
    providers: (options) =>
      new ImapProvider({
        connectionId: options.connectionId,
        name: options.name,
        config: options.config as any,
        password: options.secrets.password,
        index: openInProcessIndex(':memory:'),
        readAttachment: options.readAttachment,
        background: false,
        ports: server.port,
        smtp: { submit, verify: async () => {} },
        timing: { sentCopyGraceMs: 0, previews: 0 },
      }),
  })
  await main.init()
  await main.connect({
    connectionId: 'crypto-test',
    name: 'Encrypted',
    password: 'disposable',
    remember: false,
    config: {
      protocol: 'imap',
      email: own.email,
      incoming: { host: 'imap.encryption.test', port: 993, security: 'tls', username: 'bob' },
      outgoing: { host: 'smtp.encryption.test', port: 587, security: 'starttls', username: 'bob' },
      outgoingSameCredentials: true,
    },
  })
  await main.unlockEncryption('vault-password')
  const input = draft()
  const original = join(directory, 'selected-private.txt')
  await writeFile(original, 'PRIVATE ATTACHMENT MARKER')
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [original] })
  input.attachments = await main.stageAttachments(true)
  expect(await readFile(join(directory, 'staging.json'), 'utf8')).not.toContain(
    'selected-private.txt',
  )
  expect(main.encryption.vault.ids('attachment:')).toContain(
    'attachment:' + input.attachments[0].id,
  )
  await expect(
    readFile(join(directory, 'attachments', input.attachments[0].id)),
  ).rejects.toMatchObject({ code: 'ENOENT' })
  await main.saveDraft(input)
  expect(await readFile(join(directory, 'drafts.json'), 'utf8')).not.toContain('MARKER')
  expect(await readFile(join(directory, 'encryption-vault.json'), 'utf8')).not.toContain('MARKER')
  await main.lockEncryption()
  expect((await main.drafts())[0].text).toBe('')
  await main.unlockEncryption('vault-password')
  expect((await main.drafts())[0].text).toBe('PRIVATE BODY MARKER')
  await expect(main.saveDraft({ ...input, encryption: 'none' })).rejects.toThrow('Confirm')
  const saved = await main.syncDraft(input)
  expect(saved.status).toBe('synced')
  expect(saved.serverFingerprint).toMatch(/^[a-f0-9]{64}$/)
  const sent = await main.send(saved)
  expect(sent.status).toBe('sent')
  expect(Buffer.from(submit.mock.calls[0][2]).toString()).not.toContain('MARKER')
  const tombstone = (await main.drafts()).find((d) => d.id === input.id)!
  expect(tombstone.status).toBe('sent')
  expect(tombstone.text).toBe('')
  expect(main.encryption.vault.ids('draft:')).not.toContain('draft:' + input.id)
  expect(main.encryption.vault.ids('attachment:')).not.toContain(
    'attachment:' + input.attachments[0].id,
  )
  const partial = draft()
  submit.mockImplementationOnce(
    async () =>
      ({
        accepted: ['alice@encryption.test'],
        rejected: [{ email: 'carol@encryption.test', reason: '550 Refused' }],
      }) as any,
  )
  expect((await main.send(partial)).status).toBe('partial')
  await main.lockEncryption()
  await expect(main.recoverRejected(partial.id)).rejects.toThrow('Unlock')
  await main.unlockEncryption('vault-password')
  const recovered = await main.recoverRejected(partial.id)
  expect(recovered.text).toBe('PRIVATE BODY MARKER')
  expect([...recovered.to, ...recovered.cc, ...recovered.bcc].map((a) => a.email)).toEqual([
    'carol@encryption.test',
  ])
  expect(main.encryption.vault.ids('draft:')).toContain('draft:' + recovered.id)
  expect(await readFile(join(directory, 'drafts.json'), 'utf8')).not.toContain('MARKER')
  await main.lockEncryption()
  await main.unlockEncryption('vault-password')
  expect((await main.drafts()).find((d) => d.id === recovered.id)?.text).toBe('PRIVATE BODY MARKER')
  const uncertain = draft()
  submit.mockRejectedValueOnce(new Error('Lost final response'))
  expect((await main.send(uncertain)).status).toBe('uncertain')
  await main.lockEncryption()
  await expect(main.replaceUncertain(uncertain.id)).rejects.toThrow('Unlock')
  await main.unlockEncryption('vault-password')
  const replacement = await main.replaceUncertain(uncertain.id)
  await main.lockEncryption()
  await main.unlockEncryption('vault-password')
  expect((await main.drafts()).find((d) => d.id === replacement.id)?.text).toBe(
    'PRIVATE BODY MARKER',
  )
  expect(main.encryption.vault.ids('draft:')).toContain('draft:' + uncertain.id)
  const downgrade = draft()
  await main.saveDraft(downgrade)
  await main.saveDraft({
    ...downgrade,
    encryption: 'none',
    downgradeConfirmed: true,
    text: 'Explicitly ordinary revised content',
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  })
  expect(main.encryption.vault.ids('draft:')).not.toContain('draft:' + downgrade.id)
  await main.lockEncryption()
  await main.unlockEncryption('vault-password')
  expect((await main.drafts()).find((d) => d.id === downgrade.id)?.text).toBe(
    'Explicitly ordinary revised content',
  )
  main.dispose()
  await new Promise((resolve) => setTimeout(resolve, 30))
})

it('uses advanced WKD first, falls back to direct only for absent DNS, and keeps the same fingerprint accepted', async () => {
  const [info] = await engine.inspect(
    (await file('alice-public.asc')).toString(),
    'alice@encryption.test',
  )
  vi.mocked(publicFetch).mockResolvedValue({
    status: 200,
    type: 'application/octet-stream',
    bytes: Buffer.from(info.binary),
  })
  const initial = (await service.status()).keys.find((k) => k.email === 'alice@encryption.test')!
  await service.discover(initial.email, true)
  expect(vi.mocked(publicFetch).mock.calls[0][0]).toContain('https://openpgpkey.encryption.test/')
  expect((await service.status()).keys.find((k) => k.email === initial.email)?.accepted).toBe(true)
  expect(
    (await service.readiness(own.accountId, own.id, [initial.email])).recipients[0].status,
  ).toBe('ready')
  vi.mocked(publicFetch).mockClear()
  vi.mocked(lookup).mockRejectedValueOnce(
    Object.assign(new Error('Absent DNS'), { code: 'ENOTFOUND' }),
  )
  await service.discover(initial.email, true)
  expect(vi.mocked(publicFetch).mock.calls[0][0]).toContain(
    'https://encryption.test/.well-known/openpgpkey/hu/',
  )
  vi.mocked(publicFetch).mockClear().mockRejectedValueOnce(new Error('TLS failed'))
  await service.discover(initial.email, true)
  expect(vi.mocked(publicFetch).mock.calls).toHaveLength(1)
  expect(vi.mocked(publicFetch).mock.calls[0][0]).toContain('https://openpgpkey.')
})
it('discovers keys and preference from bounded unopened-message headers after WKD and refreshes stale peer state', async () => {
  const dave = await engine.generate('Dave', 'dave@encryption.test'),
    advertisement = autocryptHeader(
      'dave@encryption.test',
      await engine.autocryptKey(dave.publicKey, 'dave@encryption.test'),
      true,
    ),
    oldDate = new Date(Date.now() - 40 * 86400_000).toISOString(),
    recentDate = new Date().toISOString(),
    hintMessage = {
      ...message,
      from: [{ name: 'Dave', email: 'dave@encryption.test' }],
      sentAt: oldDate,
      receivedAt: oldDate,
    },
    hints = vi.fn(async () => [
      { message: hintMessage, headers: Buffer.from(advertisement + '\r\n\r\n') },
    ]),
    automatic = new EncryptionService(store, factory, hints)
  await automatic.init()
  await automatic.unlock('vault-password')
  await automatic.preference(own.accountId, own.id, true, true)
  const ready = await automatic.readiness(own.accountId, own.id, ['dave@encryption.test'])
  expect(vi.mocked(publicFetch)).toHaveBeenCalled()
  expect(ready).toMatchObject({
    recommend: true,
    recipients: [{ status: 'ready', confirmed: false, prefers: true }],
  })
  await automatic.readiness(own.accountId, own.id, ['dave@encryption.test'])
  expect(hints).toHaveBeenCalledTimes(1)
  hints.mockResolvedValueOnce([
    {
      message: { ...hintMessage, receivedAt: recentDate, sentAt: recentDate },
      headers: Buffer.from('Content-Type: text/plain\r\n\r\n'),
    },
  ])
  await automatic.discover('dave@encryption.test', true)
  expect(
    (await automatic.readiness(own.accountId, own.id, ['dave@encryption.test'])).recommend,
  ).toBe(false)
  await automatic.preference(own.accountId, own.id, false, false)
  vi.mocked(publicFetch).mockClear()
  await automatic.readiness(own.accountId, own.id, ['new@encryption.test'])
  expect(vi.mocked(publicFetch)).not.toHaveBeenCalled()
  expect(hints).toHaveBeenCalledTimes(2)
  await automatic.lock()
})
it('rejects wrong-address WKD keys and stale or malformed Autocrypt headers without replacing accepted keys', async () => {
  const [info] = await engine.inspect((await file('alice-public.asc')).toString())
  vi.mocked(publicFetch).mockResolvedValueOnce({
    status: 200,
    type: '',
    bytes: Buffer.from(info.binary),
  })
  await expect(service.discover('wrong@encryption.test', true)).rejects.toThrow('match')
  const replacement = await engine.generate('Alice replacement', 'alice@encryption.test'),
    [replacementInfo] = await engine.inspect(replacement.publicKey)
  const raw = await file('unsigned.eml'),
    header = Buffer.from(
      'Autocrypt: addr=alice@encryption.test; prefer-encrypt=mutual; keydata=' +
        Buffer.from(info.binary).toString('base64') +
        '\r\n',
    )
  await service.observe(message, Buffer.concat([header, raw]))
  const old = Buffer.from(
    'Autocrypt: addr=alice@encryption.test; keydata=' +
      Buffer.from(replacementInfo.binary).toString('base64') +
      '\r\n',
  )
  await service.observe({ ...message, sentAt: '2026-10-06T10:00:00Z' }, Buffer.concat([old, raw]))
  const keys = (await service.status()).keys.filter((k) => k.email === 'alice@encryption.test')
  expect(keys).toHaveLength(1)
  expect(keys[0].fingerprint).toBe(info.fingerprint)
  await service.preference(own.accountId, own.id, true, true)
  expect(
    (await service.readiness(own.accountId, own.id, ['alice@encryption.test'])).recommend,
  ).toBe(true)
  await service.observe(
    { ...message, receivedAt: '2026-12-07T12:00:00Z', sentAt: '2026-12-07T10:00:00Z' },
    raw,
  )
  expect(
    (await service.readiness(own.accountId, own.id, ['alice@encryption.test'])).recommend,
  ).toBe(false)
})
it('exports and restores a Setup Message using a separate generated code and transfers encryption preference', async () => {
  await service.preference(own.accountId, own.id, true, true)
  const path = join(directory, 'setup.eml')
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: path })
  const exported = await service.transfer(own, 'export')
  expect(exported.code).toMatch(/^(\d{4}-){8}\d{4}$/)
  const mime = await readFile(path, 'utf8')
  expect(mime).not.toContain(exported.code!)
  expect(mime).not.toContain('BEGIN PGP PRIVATE KEY')
  const destination = join(directory, 'other-device'),
    otherStore = new JsonStore(destination)
  await otherStore.init()
  const other = new EncryptionService(otherStore, factory)
  await other.init()
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [path] })
  await expect(
    other.transfer(own, 'import', 'wrong code', 'other-vault-password'),
  ).rejects.toThrow()
  await other.transfer(own, 'import', exported.code, 'other-vault-password')
  const restored = await other.status()
  expect(restored.identities[0].fingerprint).toBe(
    (await service.status()).identities[0].fingerprint,
  )
  expect(restored.identities[0].prefer).toBe(true)
  expect((await other.read(message, await file('encrypted-signed.eml'))).text).toContain(
    'Secret fixture body.',
  )
  await other.lock()
})
