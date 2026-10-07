import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { dialog } from 'electron'
import { z } from 'zod'
import { composeMime, parseMime } from '@inlark/mime'
import {
  identityKey,
  type Draft,
  type Identity,
  type Message,
  type EncryptionStatus,
  type EncryptionIdentity,
  type EncryptionKeySummary,
  type EncryptionReadiness,
  type RecipientReadiness,
} from '@inlark/core'
import {
  Vault,
  canonicalEmail,
  wkdUrls,
  parseAutocrypt,
  autocryptHeader,
  peerUpdate,
  peerPrefersEncryption,
  setupCode,
  splitEntity,
  header,
  securityKind,
  armoredPayload,
  mimeContent,
  replaceContent,
  encryptedMime,
  signedMime,
  multipart,
  decodedBody,
  type PrivateRecord,
  type CryptoMethods,
  type PeerState,
} from '@inlark/crypto'
import { JsonStore, encryptSecret, decryptSecret, secureStorageAvailable } from './storage'
import { publicFetch } from './public-fetch'

export interface CryptoTransport {
  call<K extends keyof CryptoMethods>(
    method: K,
    ...args: Parameters<CryptoMethods[K]>
  ): Promise<Awaited<ReturnType<CryptoMethods[K]>>>
  close(): Promise<void>
}
const candidateSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{40,64}$/),
  email: z.string(),
  publicKey: z.string().max(1024 * 1024),
  binary: z.string().max(2 * 1024 * 1024),
  sources: z.array(z.enum(['own', 'import', 'wkd', 'autocrypt', 'gossip'])),
  confirmed: z.boolean(),
  accepted: z.boolean(),
  usable: z.boolean(),
  problem: z.string().optional(),
  retired: z.boolean().optional(),
  backup: z.enum(['needed', 'postponed', 'done']).optional(),
})
type Candidate = z.infer<typeof candidateSchema>
const stateSchema = z.object({
  identities: z.record(
    z.string(),
    z.object({
      accountId: z.string(),
      identityId: z.string(),
      email: z.string(),
      fingerprint: z.string(),
      enabled: z.boolean(),
      prefer: z.boolean(),
    }),
  ),
  keys: z.array(candidateSchema),
  accepted: z.record(z.string(), z.string()),
  peers: z.record(
    z.string(),
    z.object({
      lastSeen: z.string().optional(),
      autocryptAt: z.string().optional(),
      gossipAt: z.string().optional(),
      fingerprint: z.string().optional(),
      gossipFingerprint: z.string().optional(),
      mutual: z.boolean().optional(),
    }),
  ),
  refreshed: z.record(z.string(), z.number()),
})
type State = z.infer<typeof stateSchema>
const empty = (): State => ({ identities: {}, keys: [], accepted: {}, peers: {}, refreshed: {} })
export class EncryptionService {
  readonly vault: Vault
  private state = empty()
  private transport?: CryptoTransport
  private queue = Promise.resolve()
  private epoch = 0
  private locking = false
  private hintsAt = new Map<string, number>()
  readonly attachments = new Map<string, { accountId: string; content: Uint8Array }>()
  constructor(
    private store: JsonStore,
    private factory?: () => CryptoTransport,
    private hints?: (
      accountId: string,
      email: string,
    ) => Promise<{ message: Message; headers: Uint8Array }[]>,
  ) {
    this.vault = new Vault(join(store.directory, 'encryption-vault.json'), {
      available: secureStorageAvailable,
      wrap: encryptSecret,
      unwrap: decryptSecret,
    })
  }
  async init() {
    await this.vault.init()
    this.state = stateSchema.parse(await this.store.read('encryption-state', empty()))
  }
  private get worker() {
    if (this.locking) throw new Error('The encryption vault is locking. Try again after unlocking.')
    if (!this.transport) {
      if (!this.factory) throw new Error('The encryption worker is unavailable.')
      this.transport = this.factory()
    }
    return this.transport
  }
  private save() {
    return this.store.write('encryption-state', this.state)
  }
  serial<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(task)
    this.queue = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
  status = async (): Promise<EncryptionStatus> => ({
    vault: this.vault.exists ? (this.vault.unlocked ? 'unlocked' : 'locked') : 'absent',
    protection: this.vault.mode,
    identities: Object.values(this.state.identities),
    keys: this.state.keys.map(({ binary: _, ...key }) => key),
  })
  identity(accountId: string, identityId: string) {
    return this.state.identities[identityKey(accountId, identityId)]
  }
  private async load() {
    await this.worker.call(
      'load',
      this.vault.ids('private:').map((id) => this.vault.json<PrivateRecord>(id)!),
    )
  }
  unlock = (password?: string) =>
    this.serial(async () => {
      await this.vault.unlock(password)
      try {
        await this.load()
      } catch (error) {
        await this.vault.lock()
        throw error
      }
      return this.status()
    })
  async lock() {
    await this.queue
    this.locking = true
    this.epoch++
    try {
      await this.transport?.close()
      this.transport = undefined
      await this.vault.lock()
      for (const a of this.attachments.values()) a.content.fill(0)
      this.attachments.clear()
    } finally {
      this.locking = false
    }
  }
  private async ensureVault(password?: string) {
    if (!this.vault.exists) await this.vault.create(password)
    else if (!this.vault.unlocked) await this.vault.unlock(password)
  }
  setup(
    identity: Identity,
    action: 'create' | 'import' | 'replace' | 'historical',
    password?: string,
    keyPassword?: string,
    importReplacement = false,
  ) {
    return this.serial(async () => {
      const email = canonicalEmail(identity.email),
        current = this.identity(identity.accountId, identity.id)
      if (action === 'create' && (current || this.state.keys.some((k) => k.email === email)))
        throw new Error(
          'A key already exists for this address. Import the existing private key instead of creating a replacement.',
        )
      if (action === 'create') {
        const discovered = await this.discover(email, true)
        if (discovered.length)
          throw new Error(
            'An existing key was discovered for this address. Import its private key instead of generating a replacement.',
          )
      }
      if (current && action === 'import')
        throw new Error('This identity already has a key. Use explicit replacement to change it.')
      let record: PrivateRecord
      if (
        action === 'import' ||
        action === 'historical' ||
        (action === 'replace' && importReplacement)
      ) {
        const file = await this.readKeyFile('Import an existing private key')
        if (!file) return this.status()
        record = await this.worker.call(
          'importPrivate',
          file,
          email,
          keyPassword,
          action === 'historical',
        )
      } else record = await this.worker.call('generate', identity.name, email)
      await this.ensureVault(password)
      if (action === 'historical') {
        await this.vault.putJSON('private:' + record.fingerprint, record)
        const [info] = await this.worker.call('inspect', record.publicKey, email)
        const candidate = await this.candidate(info, email, 'import')
        candidate.backup = candidate.backup || 'needed'
        if (candidate.fingerprint !== current?.fingerprint) candidate.retired = true
        await this.save()
        await this.load()
      } else await this.install(identity, record, current)
      return this.status()
    })
  }
  private async install(identity: Identity, record: PrivateRecord, current?: EncryptionIdentity) {
    const email = canonicalEmail(identity.email),
      [info] = await this.worker.call('inspect', record.publicKey, email)
    if (!info.usable) throw new Error('This private key is expired, revoked, or unusable.')
    await this.vault.putJSON('private:' + record.fingerprint, record)
    if (current && current.fingerprint !== record.fingerprint) {
      const old = this.state.keys.find(
        (k) => k.email === email && k.fingerprint === current.fingerprint,
      )
      if (old) old.retired = true
    }
    await this.candidate(info, email, 'own')
    const key = this.state.keys.find(
      (k) => k.email === email && k.fingerprint === info.fingerprint,
    )!
    key.backup = key.backup || 'needed'
    for (const candidate of this.state.keys.filter((candidate) => candidate.email === email))
      candidate.accepted = candidate === key
    key.retired = false
    key.confirmed = true
    this.state.accepted[email] = info.fingerprint
    this.state.identities[identityKey(identity.accountId, identity.id)] = {
      accountId: identity.accountId,
      identityId: identity.id,
      email,
      fingerprint: info.fingerprint,
      enabled: current?.enabled ?? true,
      prefer: record.transferPreference ?? current?.prefer ?? false,
    }
    await this.save()
    await this.load()
  }
  preference(accountId: string, identityId: string, enabled: boolean, prefer: boolean) {
    return this.serial(async () => {
      const identity = this.identity(accountId, identityId)
      if (!identity) throw new Error('Create or import a key for this identity first.')
      identity.enabled = enabled
      identity.prefer = enabled && prefer
      await this.save()
      return this.status()
    })
  }
  private async readKeyFile(title: string) {
    const result = await dialog.showOpenDialog({ title, properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return
    if ((await stat(result.filePaths[0])).size > 1024 * 1024)
      throw new Error('Key file is too large.')
    return readFile(result.filePaths[0], 'utf8')
  }
  exportKey(fingerprint: string, kind: 'public' | 'backup', password?: string) {
    return this.serial(async () => {
      const key = this.state.keys.find((k) => k.fingerprint === fingerprint)
      if (!key) throw new Error('Key not found.')
      if (kind === 'backup' && !this.vault.unlocked)
        throw new Error('Unlock the encryption vault first.')
      const result = await dialog.showSaveDialog({
        title: kind === 'backup' ? 'Save password-protected key backup' : 'Export public key',
        defaultPath: `${key.email}-${fingerprint.slice(-8)}-${kind}.asc`,
      })
      if (result.canceled || !result.filePath) return
      const data =
        kind === 'public'
          ? key.publicKey
          : await this.worker.call('backup', fingerprint, password || '')
      await writeFile(result.filePath, data, { mode: 0o600 })
      if (kind === 'backup') {
        for (const k of this.state.keys) if (k.fingerprint === fingerprint) k.backup = 'done'
        await this.save()
      }
    })
  }
  postpone(fingerprint: string) {
    return this.serial(async () => {
      const key = this.state.keys.find(
        (k) =>
          k.fingerprint === fingerprint &&
          this.vault.ids('private:').includes('private:' + fingerprint),
      )
      if (!key) throw new Error('Key not found.')
      key.backup = 'postponed'
      await this.save()
      return this.status()
    })
  }
  revoke(fingerprint: string) {
    return this.serial(async () => {
      if (!this.vault.unlocked) throw new Error('Unlock the encryption vault first.')
      const revoked = await this.worker.call('revoke', fingerprint)
      for (const key of this.state.keys.filter((k) => k.fingerprint === fingerprint)) {
        key.publicKey = revoked
        key.usable = false
        key.problem = 'revoked'
        key.retired = true
      }
      for (const identity of Object.values(this.state.identities))
        if (identity.fingerprint === fingerprint) {
          identity.enabled = false
          identity.prefer = false
        }
      // Keep the original private key so historical ciphertext remains decryptable.
      await this.save()
      return this.status()
    })
  }
  private async candidate(
    info: Awaited<ReturnType<CryptoMethods['inspect']>>[number],
    email: string,
    source: Candidate['sources'][number],
  ) {
    let key = this.state.keys.find((k) => k.email === email && k.fingerprint === info.fingerprint)
    if (key) {
      const merged = await this.worker.call('mergePublic', key.publicKey, info.publicKey)
      ;[info] = await this.worker.call('inspect', merged, email)
      key.publicKey = info.publicKey
      key.binary = Buffer.from(info.binary).toString('base64')
      key.usable = info.usable
      key.problem = info.problem
      if (!key.sources.includes(source)) key.sources.push(source)
    } else {
      key = {
        email,
        fingerprint: info.fingerprint,
        publicKey: info.publicKey,
        binary: Buffer.from(info.binary).toString('base64'),
        sources: [source],
        confirmed: false,
        accepted: false,
        usable: info.usable,
        problem: info.problem,
      }
      this.state.keys.push(key)
    }
    return key
  }
  async discover(address: string, refresh = false): Promise<EncryptionKeySummary[]> {
    const email = canonicalEmail(address),
      accepted = this.state.accepted[email]
    if (refresh)
      for (const key of this.hintsAt.keys())
        if (key.endsWith('\n' + email)) this.hintsAt.delete(key)
    if (
      (!accepted || refresh) &&
      (refresh ||
        !this.state.refreshed[email] ||
        Date.now() - this.state.refreshed[email] > 86400_000)
    ) {
      const urls = wkdUrls(address)
      let url = urls.advanced
      try {
        await lookup(urls.host, { all: true })
      } catch (error) {
        if (['ENOTFOUND', 'ENODATA'].includes((error as NodeJS.ErrnoException).code || ''))
          url = urls.direct
        else throw new Error('Key discovery DNS lookup failed. Refresh to try again.')
      }
      try {
        const response = await publicFetch(url, { maxBytes: 1024 * 1024, timeoutMs: 10000 })
        if (response.status === 200)
          for (const info of await this.worker.call(
            'inspect',
            new Uint8Array(response.bytes),
            email,
          ))
            await this.candidate(info, email, 'wkd')
        else if (![404, 410].includes(response.status))
          throw new Error('The key directory could not be reached.')
        this.state.refreshed[email] = Date.now()
        await this.save()
      } catch (error) {
        // Never switch to direct after a connection/TLS/HTTP error at an existing advanced host.
        if (!this.state.keys.some((k) => k.email === email)) throw error
      }
    }
    return this.state.keys.filter((k) => k.email === email).map(({ binary: _, ...key }) => key)
  }
  accept(email: string, fingerprint: string, confirmed: boolean) {
    return this.serial(async () => {
      email = canonicalEmail(email)
      const selected = this.state.keys.find(
        (k) => k.email === email && k.fingerprint === fingerprint,
      )
      if (!selected) throw new Error('Choose a discovered key for this address.')
      const [info] = await this.worker.call('inspect', selected.publicKey, email)
      if (!info.usable) throw new Error('This key cannot be used for encryption.')
      for (const key of this.state.keys.filter((k) => k.email === email)) {
        key.accepted = key === selected
        if (key !== selected) key.retired = true
      }
      selected.confirmed = confirmed
      selected.retired = false
      this.state.accepted[email] = fingerprint
      await this.save()
      return this.status()
    })
  }
  async readiness(
    accountId: string,
    identityId: string,
    addresses: string[],
  ): Promise<EncryptionReadiness> {
    const identity = this.identity(accountId, identityId)
    if (!identity?.enabled)
      return {
        senderReady: false,
        recommend: false,
        recipients: [...new Set(addresses.map(canonicalEmail))].map((email) => ({
          email,
          status: 'missing',
          confirmed: false,
          prefers: false,
        })),
      }
    const own =
      identity &&
      this.state.keys.find(
        (k) => k.email === identity.email && k.fingerprint === identity.fingerprint,
      )
    if (own) {
      try {
        const [info] = await this.worker.call('inspect', own.publicKey, own.email)
        own.usable = info.usable
        own.problem = info.problem
      } catch {
        own.usable = false
      }
    }
    const senderReady = !!(identity?.enabled && own?.usable && this.vault.unlocked)
    const recipients: RecipientReadiness[] = []
    for (const email of [...new Set(addresses.map(canonicalEmail))]) {
      let discoveryFailed = false
      try {
        await this.discover(email)
      } catch {
        discoveryFailed = true
      }
      const hintKey = accountId + '\n' + email
      if (this.hints && Date.now() - (this.hintsAt.get(hintKey) || 0) > 120_000) {
        try {
          const hints = await this.hints(accountId, email)
          for (const hint of hints
            .slice(0, 40)
            .sort((a, b) => a.message.receivedAt.localeCompare(b.message.receivedAt)))
            if (hint.headers.byteLength <= 20 * 1024)
              await this.observe(hint.message, hint.headers).catch(() => {})
          this.hintsAt.set(hintKey, Date.now())
        } catch {
          /* Discovery failure cannot trigger a downgrade. */
        }
      }
      const keys = this.state.keys.filter((k) => k.email === email && !k.retired)
      for (const key of keys) {
        try {
          const [info] = await this.worker.call('inspect', key.publicKey, email)
          key.usable = info.usable
          key.problem = info.problem
        } catch {
          key.usable = false
          key.problem = 'unusable'
        }
      }
      const accepted = this.state.accepted[email],
        usable = keys.filter((k) => k.usable)
      let key = keys.find((k) => k.fingerprint === accepted),
        status: RecipientReadiness['status'] = 'missing'
      if (key)
        status = usable.some((k) => k.fingerprint !== accepted)
          ? 'changed'
          : key.usable
            ? 'ready'
            : ['expired', 'revoked'].includes(key.problem || '')
              ? (key.problem as 'expired' | 'revoked')
              : 'unusable'
      else if (usable.length > 1) status = 'conflict'
      else if (usable.length === 1) {
        // A sole first-discovered key is accepted for use, but stays visibly unconfirmed.
        key = usable[0]
        status = 'ready'
        key.accepted = true
        this.state.accepted[email] = key.fingerprint
        await this.save()
      } else if (keys.length)
        status = (keys[0].problem as RecipientReadiness['status']) || 'unusable'
      if (discoveryFailed && !key) status = 'missing'
      recipients.push({
        email,
        status,
        fingerprint: key?.fingerprint,
        confirmed: key?.confirmed || false,
        prefers:
          email === identity.email
            ? identity.prefer
            : peerPrefersEncryption(this.state.peers[email]),
      })
    }
    return {
      senderReady,
      recipients,
      recommend:
        senderReady &&
        !!identity?.prefer &&
        !!recipients.length &&
        recipients.every((r) => r.status === 'ready' && r.prefers),
    }
  }
  observe(message: Message, raw: Uint8Array, gossip = false) {
    return this.serial(() => this.observeNow(message, raw, gossip))
  }
  private async observeNow(message: Message, raw: Uint8Array, gossip = false) {
    const entity = splitEntity(raw)
    if (
      message.from.length !== 1 ||
      message.keywords.$junk ||
      message.keywords.$draft ||
      /^multipart\/report/i.test(header(entity, 'content-type'))
    )
      return
    const email = canonicalEmail(message.from[0].email),
      values = entity.headers.get(gossip ? 'autocrypt-gossip' : 'autocrypt') || [],
      parsed = values
        .map((v) => parseAutocrypt(v, gossip ? undefined : email))
        .filter((v) => v !== undefined)
    if (gossip) {
      const visible = new Set([...message.to, ...message.cc].map((a) => canonicalEmail(a.email)))
      for (const value of parsed)
        if (visible.has(value.email)) {
          const old = this.state.peers[value.email] || {},
            date = peerUpdate({}, message.receivedAt, message.sentAt).lastSeen!
          if (old.gossipAt && date <= old.gossipAt) continue
          const infos = await this.worker.call('inspect', value.data, value.email).catch(() => [])
          if (infos.length === 1) {
            await this.candidate(infos[0], value.email, 'gossip')
            this.state.peers[value.email] = {
              ...old,
              gossipAt: date,
              gossipFingerprint: infos[0].fingerprint,
            }
          }
        }
    } else {
      const old: PeerState = this.state.peers[email] || {},
        date = peerUpdate({}, message.receivedAt, message.sentAt).lastSeen!
      let valid: { fingerprint: string; mutual: boolean } | undefined
      if (
        values.length === 1 &&
        parsed.length === 1 &&
        (!old.autocryptAt || date > old.autocryptAt)
      ) {
        const infos = await this.worker.call('inspect', parsed[0].data, email).catch(() => [])
        if (infos.length === 1) {
          await this.candidate(infos[0], email, 'autocrypt')
          valid = { fingerprint: infos[0].fingerprint, mutual: parsed[0].mutual }
        }
      }
      this.state.peers[email] = peerUpdate(old, message.receivedAt, message.sentAt, valid)
    }
    await this.save()
  }
  async compose(
    draft: Draft,
    identity: Identity,
    messageId: string,
    attachments: { name: string; type: string; cid?: string; content: Uint8Array }[],
    serverDraft = false,
  ) {
    const own = this.identity(draft.accountId, draft.identityId)
    if (!own?.enabled) throw new Error('Enable encryption for this sending identity first.')
    if (draft.encryption && draft.encryption !== 'none' && !this.vault.unlocked)
      throw new Error('Unlock the encryption vault.')
    const key = this.state.keys.find(
      (k) => k.fingerprint === own.fingerprint && k.email === own.email,
    )
    const [info] = await this.worker.call('inspect', key!.publicKey, identity.email)
    if (!info.usable && draft.encryption && draft.encryption !== 'none')
      throw new Error('The sender’s key is expired, revoked, or unusable.')
    const encrypted = draft.encryption === 'encrypt',
      extra: string[] = []
    if (!serverDraft && info.usable)
      extra.push(
        autocryptHeader(
          identity.email,
          await this.worker.call('autocryptKey', key!.publicKey, identity.email),
          own.prefer,
        ),
      )
    if (serverDraft)
      extra.push(
        'Autocrypt-Draft-State: encrypt=yes; _by-choice=yes; _is-reply-to-encrypted=' +
          (draft.encryptionRequired ? 'yes' : 'no'),
      )
    const mime = await composeMime({
      from: identity,
      to: draft.to,
      cc: draft.cc,
      bcc: [],
      subject: draft.subject,
      html: draft.html,
      text: draft.text,
      messageId,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      attachments,
    })
    if (!draft.encryption || draft.encryption === 'none') {
      const entity = splitEntity(mime)
      return Buffer.concat([
        Buffer.from(extra.length ? extra.join('\r\n') + '\r\n' : ''),
        entity.headerBytes,
        Buffer.from('\r\n\r\n'),
        entity.body,
      ])
    }
    let content = mimeContent(mime)
    const encryptionKeys = [key!.publicKey]
    const gossip: string[] = []
    if (encrypted && !serverDraft) {
      const ready = await this.readiness(
        draft.accountId,
        draft.identityId,
        [...draft.to, ...draft.cc, ...draft.bcc].map((a) => a.email),
      )
      const blocked = ready.recipients.filter((r) => r.status !== 'ready')
      if (!ready.senderReady || blocked.length)
        throw new Error(
          'Encrypted send blocked: ' +
            blocked.map((r) => r.email + ' (' + r.status + ')').join(', '),
        )
      for (const recipient of ready.recipients) {
        const key = this.state.keys.find(
          (k) => k.email === recipient.email && k.fingerprint === recipient.fingerprint,
        )!
        encryptionKeys.push(key.publicKey)
      }
    }
    if (encrypted) {
      // Gossip contains visible recipients only, even when hidden recipient packets are used.
      for (const address of [...draft.to, ...draft.cc]) {
        const email = canonicalEmail(address.email),
          fingerprint = this.state.accepted[email],
          key = this.state.keys.find((k) => k.email === email && k.fingerprint === fingerprint)
        if (key?.usable) {
          try {
            gossip.push(
              autocryptHeader(
                email,
                await this.worker.call('autocryptKey', key.publicKey, email),
                false,
                true,
              ),
            )
          } catch (error) {
            if (!serverDraft) throw error
          }
        }
      }
      if (gossip.length)
        content = Buffer.concat([Buffer.from(gossip.join('\r\n') + '\r\n'), content])
      if (serverDraft && draft.bcc.length)
        content = Buffer.concat([
          Buffer.from(
            'X-Inlark-Draft-Bcc: ' +
              Buffer.from(JSON.stringify(draft.bcc)).toString('base64') +
              '\r\n',
          ),
          content,
        ])
      const armor = await this.worker.call(
        'encrypt',
        content,
        [...new Set(encryptionKeys)],
        serverDraft ? undefined : own.fingerprint,
        !!draft.bcc.length,
      )
      return replaceContent(mime, encryptedMime(armor), extra)
    }
    return replaceContent(
      mime,
      signedMime(content, await this.worker.call('sign', content, own.fingerprint)),
      extra,
    )
  }
  async read(message: Message, raw: Uint8Array): Promise<Message> {
    const epoch = this.epoch,
      kind = securityKind(raw),
      entity = splitEntity(raw)
    await this.observe(message, raw).catch(() => {})
    if (!kind) return message
    const safe = {
      ...message,
      html: '',
      text: '',
      preview: '',
      attachments: [],
      protectedRevision: createHash('sha256').update(raw).digest('hex'),
      encryptionIntent:
        /\bencrypt=yes\b/i.test(header(entity, 'autocrypt-draft-state')) || kind === 'encrypted',
    }
    const failure = (
      state: 'locked' | 'missingKey' | 'integrityFailure',
      detail: string,
    ): Message => ({
      ...safe,
      security: {
        encrypted: kind === 'encrypted',
        state,
        signature: 'unknown',
        confirmed: false,
        detail,
      },
    })
    if (kind === 'encrypted' && !this.vault.unlocked)
      return failure(
        'locked',
        'Unlock the vault to read this message. If this device has no key, import the original private key.',
      )
    let content: Uint8Array,
      signatures: { valid: boolean; fingerprint?: string; keyId: string }[] = []
    const publicKeys = this.state.keys.map((k) => k.publicKey)
    try {
      if (kind === 'encrypted') {
        const result = await this.worker.call('decrypt', armoredPayload(raw), publicKeys)
        content = result.data
        signatures = result.signatures
      } else content = raw
      if (
        !/^Content-[A-Za-z-]+:|^Autocrypt-Gossip:|^X-Inlark-Draft-Bcc:/im.test(
          Buffer.from(content).toString('utf8').slice(0, 4096),
        )
      )
        content = Buffer.concat([
          Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n'),
          Buffer.from(content),
        ])
      if (kind === 'signed' && !/^multipart\/signed/i.test(header(entity, 'content-type'))) {
        const text = decodedBody(raw).toString('utf8'),
          armor = text.match(
            /-----BEGIN PGP SIGNED MESSAGE-----[\s\S]*?-----END PGP SIGNATURE-----/,
          )?.[0]
        if (!armor) throw new Error('Invalid inline signature.')
        const result = await this.worker.call('verifyInline', armor, publicKeys)
        signatures = result.signatures
        content = Buffer.concat([
          Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n'),
          Buffer.from(result.text),
        ])
      }
      const part = splitEntity(content)
      if (/^multipart\/signed\b/i.test(header(part, 'content-type'))) {
        if (!/\bprotocol\s*=\s*"?application\/pgp-signature/i.test(header(part, 'content-type')))
          throw new Error('Invalid signature envelope.')
        const parts = multipart(content)
        if (parts.length !== 2) throw new Error('Invalid signed message.')
        signatures = await this.worker.call(
          'verify',
          parts[0],
          decodedBody(parts[1]).toString('utf8'),
          publicKeys,
        )
        content = parts[0]
      }
      const parsed = await parseMime(content)
      if (epoch !== this.epoch || this.locking)
        return failure('locked', 'The vault was locked while opening this message.')
      if (kind === 'encrypted') await this.observe(message, content, true).catch(() => {})
      if (epoch !== this.epoch || this.locking || (kind === 'encrypted' && !this.vault.unlocked))
        return failure('locked', 'The vault was locked while opening this message.')
      const signature = signatures.length
          ? signatures.some((s) => !s.valid && s.fingerprint)
            ? 'invalid'
            : signatures.every((s) => s.valid)
              ? 'valid'
              : 'unknown'
          : 'unsigned',
        fingerprint = signatures.find((s) => s.valid)?.fingerprint
      const sender = message.from.length === 1 ? canonicalEmail(message.from[0].email) : '',
        trusted = this.state.keys.find((k) => k.email === sender && k.fingerprint === fingerprint)
      const attachments = parsed.attachments.map((a) => {
        const blobId = 'decrypted:' + randomUUID()
        this.attachments.set(blobId, { accountId: message.accountId, content: a.content })
        const { content: _, ...rest } = a
        return { ...rest, blobId }
      })
      const inner = splitEntity(content),
        bcc = header(inner, 'x-inlark-draft-bcc')
      return {
        ...safe,
        html: parsed.html,
        text: parsed.text,
        attachments,
        ...(message.keywords.$draft && bcc
          ? { bcc: JSON.parse(Buffer.from(bcc, 'base64').toString()) }
          : {}),
        security: {
          encrypted: kind === 'encrypted',
          state: kind === 'encrypted' ? 'decrypted' : 'signed',
          signature,
          fingerprint,
          confirmed: signature === 'valid' && !!trusted?.confirmed,
          detail:
            signature === 'invalid'
              ? 'The signature could not be verified. Treat the sender and content with caution.'
              : signature === 'unknown'
                ? 'The sender’s signing key is unavailable. Signature validity could not be checked.'
                : undefined,
        },
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : ''
      if (/no private key|session key decryption failed|no decryption key/i.test(text))
        return failure(
          'missingKey',
          'The original private key is needed to decrypt this message. Import it, including retired keys.',
        )
      return failure(
        'integrityFailure',
        'Message integrity could not be verified. Content and attachments are blocked.',
      )
    }
  }
  async transfer(
    identity: Identity,
    action: 'export' | 'import',
    code?: string,
    password?: string,
  ) {
    return this.serial(async () => {
      if (action === 'export') {
        const own = this.identity(identity.accountId, identity.id)
        if (!own || !this.vault.unlocked)
          throw new Error('Unlock this identity’s key before transferring it.')
        const generated = setupCode(),
          armor = await this.worker.call('setupExport', own.fingerprint, generated, own.prefer)
        const payload = armor.replace(
          '-----BEGIN PGP MESSAGE-----\n',
          '-----BEGIN PGP MESSAGE-----\nPassphrase-Format: numeric9x4\nPassphrase-Begin: ' +
            generated.slice(0, 2) +
            '\n',
        )
        const mime = await composeMime({
          from: identity,
          to: [identity],
          cc: [],
          bcc: [],
          subject: 'Autocrypt Setup Message',
          html: '',
          text: 'Import this Setup Message on your other device using the Setup Code shown by inlark. Keep that code separately and securely.',
          messageId: randomUUID() + '@' + identity.email.split('@')[1],
          attachments: [
            {
              name: 'autocrypt-setup-message.html',
              type: 'application/autocrypt-setup',
              content: Buffer.from('<html><body><pre>' + payload + '</pre></body></html>'),
            },
          ],
        })
        const result = await dialog.showSaveDialog({
          title: 'Export Autocrypt Setup Message',
          defaultPath: 'autocrypt-setup.eml',
        })
        if (result.canceled || !result.filePath) return {}
        const entity = splitEntity(mime)
        await writeFile(
          result.filePath,
          Buffer.concat([
            Buffer.from('Autocrypt-Setup-Message: v1\r\n'),
            entity.headerBytes,
            Buffer.from('\r\n\r\n'),
            entity.body,
          ]),
          { mode: 0o600 },
        )
        return { code: generated }
      }
      const file = await this.readKeyFile('Import Autocrypt Setup Message')
      if (!file) return {}
      let payload = file
      if (/Autocrypt-Setup-Message:\s*v1/i.test(file)) {
        const parsed = await parseMime(Buffer.from(file))
        const attachment = parsed.attachments.find((a) => a.type === 'application/autocrypt-setup')
        if (!attachment) throw new Error('The Setup Message has no transfer attachment.')
        payload = Buffer.from(attachment.content).toString('utf8')
      }
      const armor = payload.match(
        /-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/,
      )?.[0]
      if (!armor || !code) throw new Error('Choose a Setup Message and enter its Setup Code.')
      const record = await this.worker.call('setupImport', armor, code, identity.email)
      const current = this.identity(identity.accountId, identity.id)
      if (current && current.fingerprint !== record.fingerprint)
        throw new Error(
          'This transfer contains a different key. Review the existing identity before replacing it.',
        )
      await this.ensureVault(password)
      await this.install(identity, record, current)
      return {}
    })
  }
}
