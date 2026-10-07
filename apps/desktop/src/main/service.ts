import { EncryptionService, type CryptoTransport } from './encryption'
import { securityKind, maxMessageBytes } from '@inlark/crypto'
import { randomUUID, X509Certificate, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, rm, stat, chmod, open } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { app, dialog, shell, Notification } from 'electron'
import {
  defaultSettings,
  mergePages,
  nextAccountColor,
  sendDraftSchema,
  friendlyError,
  draftFingerprint,
  connectionErrorCodes,
  isProviderError,
  ProviderError,
  type Account,
  type AccountAppearance,
  type Address,
  type Alias,
  type AliasInput,
  type Settings,
  type ConnectInput,
  type ConnectionCheck,
  type ConnectionConfig,
  type ConnectionSettings,
  type ConnectionTest,
  type AccountDetails,
  type MailQuery,
  type QueryPage,
  type MailAction,
  type MutationInput,
  type MutationResult,
  type Draft,
  type DraftErrorKind,
  type Attachment,
  type StagedAttachment,
  type AppEvent,
  type MailProvider,
  type FolderMappings,
  type DiscoveryResult,
  type OutgoingMessage,
  type SendResult,
  type ServerSettings,
  type SubmissionSummary,
} from '@inlark/core'
import { JmapProvider } from '@inlark/jmap'
import { publicFetch } from './public-fetch'
import { remoteImageData } from './remote-image'
import { SenderAvatarResolver, rasterType } from './sender-avatar'
import { planMutation, safeUndoUpdates, undoForUpdated, type UndoEntry } from './mail-mutations'
import { JsonStore, encryptSecret, decryptSecret, secureStorageAvailable } from './storage'

export type Connection = {
  id: string
  name: string
  config: ConnectionConfig
  secret?: string
  localSecret?: string
  /** Only present when the outgoing server has its own password. */
  outgoingSecret?: string
  outgoingLocalSecret?: string
  folders?: FolderMappings
  accounts: Account[]
}
/** The version 1 record, from before IMAP support. Every such connection was JMAP. */
type LegacyConnection = {
  id: string
  serverUrl: string
  username: string
  name: string
  secret?: string
  localSecret?: string
  accounts: Account[]
}
export function migrateConnections(data: unknown, version: number): Connection[] {
  if (version !== 1 || !Array.isArray(data)) throw new Error('Unsupported connections data.')
  return (data as LegacyConnection[]).map((legacy) => {
    if (
      typeof legacy?.id !== 'string' ||
      typeof legacy.serverUrl !== 'string' ||
      typeof legacy.username !== 'string' ||
      !Array.isArray(legacy.accounts)
    )
      throw new Error('Malformed connection record.')
    const { serverUrl, username, ...rest } = legacy
    return {
      ...rest,
      config: { protocol: 'jmap', serverUrl, username },
      accounts: legacy.accounts.map((a) => ({ ...a, protocol: 'jmap' as const })),
    }
  })
}
export const CONNECTIONS_VERSION = 2

type Secrets = { password: string; outgoingPassword?: string }
type Journal = {
  draftId: string
  accountId: string
  /** JMAP: the server email being submitted. */
  emailId?: string
  /** The Message-ID of this attempt, without angle brackets. */
  messageId?: string
  envelope?: OutgoingMessage['envelope']
  /** The prepared MIME is stored beside the journal until its Sent copy is filed. */
  mime?: boolean
  subject?: string
  state: 'preparing' | 'submitting' | 'sent' | 'partial' | 'uncertain' | 'rejected'
  accepted?: string[]
  rejected?: { email: string; reason: string }[]
  /**
   * Only for providers that file their own Sent copy. `appending` is written before APPEND, so
   * a crash in between is recovered as `uncertain` and reconciled by Message-ID before retrying.
   */
  sentCopy?: 'pending' | 'appending' | 'uncertain' | 'failed' | 'filed' | 'server' | 'dismissed'
  sentCopyError?: string
  /** The user has seen and resolved this attempt. */
  dismissed?: boolean
  at: string
}
/** Errors that prove nothing left for recipients during submission. */
const definiteSubmissionCodes = [
  'submissionRejected',
  'authentication',
  'outgoingAuthentication',
  'outgoingNetwork',
  'outgoingCertificate',
  'tls',
  'certificate',
  'capability',
  'mailboxes',
  'submission',
  'unsupported',
  'identity',
]
/** Creates the provider for a non-JMAP connection. Replaced in tests. */
export type ProviderFactory = (input: {
  connectionId: string
  config: ConnectionConfig
  secrets: Secrets
  name: string
  folders?: FolderMappings
  /** A test connection must leave nothing behind on disk. */
  temporary?: boolean
  /** Where this connection may keep local data, removed when it is disconnected. */
  directory: string
  readAttachment: (id: string) => Promise<Uint8Array>
}) => MailProvider
export interface ServiceOptions {
  providers?: ProviderFactory
  discover?: (email: string) => Promise<DiscoveryResult>
  crypto?: () => CryptoTransport
}
/** Fingerprints shown to the user are computed here from the certificate itself, never taken on trust. */
function verifiedCertificates(config: ConnectionConfig): ConnectionConfig {
  if (config.protocol !== 'imap') return config
  const verified = (server: ServerSettings): ServerSettings => {
    if (!server.certificate) return server
    try {
      const sha256 = new X509Certificate(server.certificate.pem).fingerprint256
      return { ...server, certificate: { sha256, pem: server.certificate.pem } }
    } catch {
      throw new Error(
        `The trusted certificate for ${server.host} can't be read. Remove it and check the connection again.`,
      )
    }
  }
  return { ...config, incoming: verified(config.incoming), outgoing: verified(config.outgoing) }
}
const errorKind = (error: unknown): DraftErrorKind | undefined =>
  error instanceof ProviderError
    ? error.code === 'outgoingAuthentication'
      ? 'outgoingAuthentication'
      : error.code === 'certificate' || error.code === 'outgoingCertificate'
        ? 'certificate'
        : error.code === 'submissionRejected'
          ? 'rejected'
          : error.code === 'conflict'
            ? 'conflict'
            : connectionErrorCodes.includes(error.code) || error.code === 'outgoingNetwork'
              ? 'connection'
              : undefined
    : error instanceof Error && error.message.includes('another client')
      ? 'conflict'
      : undefined

export class MailService {
  settings: Settings = defaultSettings
  accounts: Account[] = []
  private connections: Connection[] = []
  private providers = new Map<string, MailProvider>()
  private sessionSecrets = new Map<string, Secrets>()
  private localDrafts = new Map<string, Draft>()
  private journals = new Map<string, Journal>()
  private staging = new Map<string, StagedAttachment>()
  private undos = new Map<string, UndoEntry[]>()
  private writes = new Map<string, Promise<unknown>>()
  private busyDrafts = new Set<string>()
  private refreshing = new Set<string>()
  private filing = new Set<string>()
  private unreadCounts = new Map<string, number>()
  private notificationBaseline = new Map<string, string>()
  private indexingEmit?: ReturnType<typeof setTimeout>
  private timer?: ReturnType<typeof setInterval>
  private logs: { at: string; event: string; state?: string }[] = []
  private senderAvatars = new SenderAvatarResolver()
  readonly encryption: EncryptionService
  private protectedLoaded = new Set<string>()
  private protectionTransition = false
  private draftWrites: Promise<unknown> = Promise.resolve()
  constructor(
    private store: JsonStore,
    private emit: (event: AppEvent) => void,
    private options: ServiceOptions = {},
  ) {
    this.encryption = new EncryptionService(store, options.crypto, (accountId, email) =>
      this.guard(
        accountId,
        (provider, account) => provider.encryptionHints?.(account, email) || Promise.resolve([]),
      ),
    )
  }
  private log(event: string, state?: string) {
    this.logs.push({ at: new Date().toISOString(), event, state })
    this.logs = this.logs.slice(-200)
  }
  async init() {
    await this.store.init()
    await this.encryption.init()
    this.settings = await this.store.read('settings', defaultSettings)
    this.connections = await this.store.read<Connection[]>('connections', [], {
      version: CONNECTIONS_VERSION,
      migrate: migrateConnections,
    })
    this.accounts = this.connections.flatMap((c) =>
      c.accounts.map((a) => ({
        ...a,
        protocol: c.config.protocol,
        status: 'connecting' as const,
      })),
    )
    this.localDrafts = new Map((await this.store.read<Draft[]>('drafts', [])).map((d) => [d.id, d]))
    this.journals = new Map(
      (await this.store.read<Journal[]>('submissions', [])).map((j) => [j.draftId, j]),
    )
    this.staging = new Map(
      (await this.store.read<StagedAttachment[]>('staging', [])).map((a) => [a.id, a]),
    )
    for (const journal of this.journals.values()) {
      const draft = this.localDrafts.get(journal.draftId)
      if (journal.state === 'sent' && draft && (draft.status !== 'sent' || this.hasContent(draft)))
        await this.completeDraft(draft)
      if (journal.state === 'preparing') {
        // Submission only starts after `submitting` is durable, so nothing left the device.
        this.journals.delete(journal.draftId)
        await this.removeMime(journal.draftId)
        if (draft)
          this.localDrafts.set(draft.id, {
            ...draft,
            status: 'local',
            error: 'Sending was interrupted before the message left. Review it and send again.',
            errorKind: 'connection',
          })
      }
      if (journal.state === 'submitting') {
        journal.state = 'uncertain'
        if (draft)
          this.localDrafts.set(draft.id, {
            ...draft,
            status: 'uncertain',
            error: 'The app closed during sending. Check delivery before retrying.',
          })
      }
      if (journal.sentCopy === 'appending') journal.sentCopy = 'uncertain'
    }
    await this.persistDrafts()
    await this.persistJournal()
    void Promise.allSettled(this.connections.map((c) => this.reconnect(c.id)))
    this.timer = setInterval(() => void this.refresh(), 60_000)
  }
  encryptionStatus = () => this.encryption.status()
  private async sendingIdentity(accountId: string, identityId: string) {
    const identity = (await this.identities(accountId)).find((i) => i.id === identityId)
    if (!identity) throw new Error('Choose a valid sending identity.')
    return identity
  }
  setupEncryption = async (input: {
    accountId: string
    identityId: string
    action: 'create' | 'import' | 'replace' | 'historical'
    importReplacement?: boolean
    password?: string
    keyPassword?: string
  }) =>
    this.encryption.setup(
      await this.sendingIdentity(input.accountId, input.identityId),
      input.action,
      input.password,
      input.keyPassword,
      input.importReplacement,
    )
  setEncryptionPreference = (
    accountId: string,
    identityId: string,
    enabled: boolean,
    prefer: boolean,
  ) => this.encryption.preference(accountId, identityId, enabled, prefer)
  exportEncryptionKey = (fingerprint: string, kind: 'public' | 'backup', password?: string) =>
    this.encryption.exportKey(fingerprint, kind, password)
  revokeEncryptionKey = (fingerprint: string) => this.encryption.revoke(fingerprint)
  postponeEncryptionBackup = (fingerprint: string) => this.encryption.postpone(fingerprint)
  discoverEncryptionKeys = (email: string, refresh?: boolean) =>
    this.encryption.discover(email, refresh)
  acceptEncryptionKey = (email: string, fingerprint: string, confirmed: boolean) =>
    this.encryption.accept(email, fingerprint, confirmed)
  encryptionReadiness = (accountId: string, identityId: string, recipients: string[]) =>
    this.encryption.readiness(accountId, identityId, recipients)
  unlockEncryption = async (password?: string) => {
    const status = await this.encryption.unlock(password)
    for (const id of this.encryption.vault.ids('attachment-meta:')) {
      const attachment = this.encryption.vault.json<StagedAttachment>(id)!
      if (this.staging.get(attachment.id)?.blobId?.startsWith('vault:'))
        this.staging.set(attachment.id, attachment)
    }
    for (const id of this.encryption.vault.ids('draft:')) {
      const draft = this.encryption.vault.json<Draft>(id)!
      // Submission reconciliation is authoritative after a crash.
      const stub = this.localDrafts.get(draft.id)
      const journal = this.journals.get(draft.id)
      if (
        stub &&
        stub.encryption !== 'encrypt' &&
        (stub.status === 'sent' || stub.updatedAt >= draft.updatedAt)
      )
        continue
      if (
        stub?.status === 'sent' &&
        (stub.encryption !== 'encrypt' || journal?.state === 'sent' || journal?.dismissed)
      )
        continue
      this.localDrafts.set(draft.id, { ...draft, ...(stub ? { status: stub.status } : {}) })
      this.protectedLoaded.add(draft.id)
    }
    this.emit({ type: 'encryption', locked: false })
    return status
  }
  lockEncryption = async () => {
    if (this.protectionTransition) throw new Error('The vault is already locking.')
    this.protectionTransition = true
    try {
      await this.draftWrites
      if (this.busyDrafts.size)
        throw new Error('Wait for drafts and sends to finish before locking.')
      await this.persistDrafts()
      await this.encryption.lock()
      this.localDrafts = new Map(
        (await this.store.read<Draft[]>('drafts', [])).map((d) => [d.id, d]),
      )
      this.staging = new Map(
        (await this.store.read<StagedAttachment[]>('staging', [])).map((a) => [a.id, a]),
      )
      this.protectedLoaded.clear()
      this.emit({ type: 'encryption', locked: true })
    } finally {
      this.protectionTransition = false
    }
  }
  transferEncryption = async (input: {
    accountId: string
    identityId: string
    action: 'export' | 'import'
    code?: string
    password?: string
  }) =>
    this.encryption.transfer(
      await this.sendingIdentity(input.accountId, input.identityId),
      input.action,
      input.code,
      input.password,
    )
  private async protectedMime(draft: Draft, messageId: string, serverDraft = false) {
    const { provider } = this.provider(draft.accountId)
    if (!provider.rawMessage) throw new Error('This provider cannot safely support encrypted mail.')
    const identity = await this.sendingIdentity(draft.accountId, draft.identityId)
    const attachments = await Promise.all(
      draft.attachments.map(async (a) => ({
        ...a,
        content: await this.readStagedAttachment(a.id),
      })),
    )
    return this.encryption.compose(draft, identity, messageId, attachments, serverDraft)
  }
  bootstrap = async () => ({
    accounts: this.accounts,
    settings: this.settings,
    secureStorage: secureStorageAvailable(),
    demo: false,
    version: app.getVersion(),
  })
  private hasContent(draft: Draft) {
    return !!(draft.text || draft.html || draft.attachments.length)
  }
  private saveConnections() {
    return this.store.write('connections', this.connections, CONNECTIONS_VERSION)
  }
  private async persistDrafts() {
    const records: [string, Uint8Array | undefined][] = []
    const saved = [...this.localDrafts.values()].map((draft) => {
      if (draft.encryption !== 'encrypt') return draft
      if (this.encryption.vault.unlocked && this.protectedLoaded.has(draft.id))
        records.push(['draft:' + draft.id, Buffer.from(JSON.stringify(draft))])
      return {
        ...draft,
        html: '',
        text: '',
        attachments: [],
        serverFingerprint: draft.serverFingerprint?.match(/^[a-f0-9]{64}$/)?.[0],
        error: 'Unlock the encryption vault to resume this draft.',
      }
    })
    if (records.length) await this.encryption.vault.putMany(records)
    await this.store.write('drafts', saved)
  }
  private async persistJournal() {
    await this.store.write('submissions', [...this.journals.values()])
    this.emit({ type: 'submissions', submissions: this.summaries() })
  }
  private account(id: string): Account {
    const a = this.accounts.find((a) => a.id === id)
    if (!a) throw new Error('Account not found.')
    return a
  }
  private provider(accountId: string) {
    const account = this.account(accountId),
      provider = this.providers.get(account.connectionId)
    if (!provider) throw new Error('This account is disconnected. Reconnect it in Settings.')
    return { account, provider }
  }
  private patchAccounts(connectionId: string, patch: Partial<Account>) {
    this.accounts = this.accounts.map((a) =>
      a.connectionId === connectionId ? { ...a, ...patch } : a,
    )
    this.emit({ type: 'accounts', accounts: this.accounts })
  }
  private status(connectionId: string, state: Account['status'], error?: string) {
    this.patchAccounts(connectionId, { status: state, error })
  }
  /** Outgoing problems are tracked apart from incoming ones: reading can still work. */
  private outgoing(connectionId: string, error?: string) {
    const current = this.accounts.find((a) => a.connectionId === connectionId)
    if (current && current.outgoingError !== error)
      this.patchAccounts(connectionId, { outgoingError: error })
  }
  private async guard<T>(
    accountId: string,
    fn: (provider: MailProvider, account: Account) => Promise<T>,
  ): Promise<T> {
    const { provider, account } = this.provider(accountId)
    try {
      const result = await fn(provider, account)
      if (account.status !== 'connected') this.status(account.connectionId, 'connected')
      return result
    } catch (error) {
      if (error instanceof ProviderError && connectionErrorCodes.includes(error.code))
        this.status(
          account.connectionId,
          error.code === 'authentication' ? 'authentication' : 'offline',
          friendlyError(error),
        )
      // Neither resolves by retrying, so sending stays marked unavailable until the user acts.
      if (isProviderError(error, 'outgoingAuthentication', 'outgoingCertificate'))
        this.outgoing(account.connectionId, friendlyError(error))
      this.log('request-failed', error instanceof ProviderError ? error.code : 'local')
      throw error
    }
  }
  private createProvider(
    id: string,
    input: Pick<ConnectInput, 'config' | 'name' | 'password' | 'outgoingPassword' | 'folders'>,
    temporary = false,
  ): MailProvider {
    const config = input.config
    if (config.protocol === 'jmap')
      return new JmapProvider({
        serverUrl: config.serverUrl,
        authorization:
          'Basic ' + Buffer.from(config.username + ':' + input.password).toString('base64'),
        connectionId: id,
        name: input.name,
      })
    if (!this.options.providers) throw new Error('IMAP accounts are not available in this build.')
    return this.options.providers({
      connectionId: id,
      config,
      name: input.name,
      folders: input.folders,
      secrets: { password: input.password, outgoingPassword: input.outgoingPassword },
      temporary,
      directory: join(this.store.directory, 'index', id),
      readAttachment: this.readStagedAttachment,
    })
  }
  discover = async (email: string): Promise<DiscoveryResult> => {
    if (!this.options.discover) throw new Error('Automatic setup is not available in this build.')
    return this.options.discover(email)
  }
  /** Signs in to each server separately and reports each result. Nothing is saved or sent. */
  testConnection = async (input: ConnectInput): Promise<ConnectionTest> => {
    input = { ...input, config: verifiedCertificates(input.config) }
    const provider = this.createProvider('test-' + randomUUID(), input, true)
    const result: ConnectionTest = { incoming: { ok: false } }
    /** A refused certificate is read again without signing in, so the user can review it. */
    const failed = async (server: 'incoming' | 'outgoing', error: unknown) => {
      const check: ConnectionCheck = { ok: false, error: friendlyError(error) }
      const certificate =
        isProviderError(error, 'certificate', 'outgoingCertificate') &&
        (await provider.inspectCertificate?.(server).catch(() => undefined))
      return certificate ? { ...check, certificate } : check
    }
    try {
      const [accounts] = await Promise.allSettled([provider.connect()])
      if (accounts.status === 'fulfilled') {
        result.incoming = accounts.value.length
          ? { ok: true }
          : { ok: false, error: 'This login does not provide an accessible mail account.' }
        if (accounts.value[0] && provider.folderMappings)
          result.folders = await provider.folderMappings(accounts.value[0]).catch(() => undefined)
      } else result.incoming = await failed('incoming', accounts.reason)
      if (provider.verifyOutgoing)
        result.outgoing = await provider.verifyOutgoing().then(
          () => ({ ok: true }),
          (error) => failed('outgoing', error),
        )
      return result
    } finally {
      provider.dispose()
      await provider.close?.()
    }
  }
  /** `reconnecting` restores a saved login, so labels and names edited since then are kept. */
  connect = async (input: ConnectInput, reconnecting = false): Promise<Account[]> => {
    input = { ...input, config: verifiedCertificates(input.config) }
    const id = input.connectionId || randomUUID()
    const previous = this.connections.find((c) => c.id === id)
    if (previous && previous.config.protocol !== input.config.protocol)
      throw new Error('Remove this account and add it again to change its protocol.')
    const outgoingPassword =
      input.config.protocol === 'imap' && !input.config.outgoingSameCredentials
        ? input.outgoingPassword
        : undefined
    const provider = this.createProvider(id, { ...input, outgoingPassword })
    let accounts: Account[]
    let folders = input.folders ?? previous?.folders
    try {
      accounts = await provider.connect()
      if (!accounts.length)
        throw new Error('This login does not provide an accessible mail account.')
      // A new or edited IMAP login must reach both servers. Restoring one only needs incoming mail.
      if (!reconnecting && provider.verifyOutgoing) await provider.verifyOutgoing()
      if (input.folders && provider.setFolderMappings) {
        const review = await provider.setFolderMappings(accounts[0], input.folders)
        // Saved as plain paths, as the server named them, so a reconnect never creates them again.
        folders = Object.fromEntries(
          Object.keys(input.folders).map((role) => {
            const value = review.mappings[role as keyof typeof review.mappings]
            return [role, value ? { path: value.path } : null]
          }),
        )
      }
      const used = this.accounts.filter((a) => a.connectionId !== id).map((a) => a.color)
      for (const account of accounts) {
        const identities = await provider.identities(account)
        account.email =
          identities[0]?.email ||
          (input.config.protocol === 'imap' ? input.config.email : input.config.username)
        account.sessionOnly = !input.remember
        account.protocol = input.config.protocol
        // Reconnecting must never reset what the user picked for this account.
        const known = this.accounts.find((a) => a.id === account.id)
        account.color = known?.color || nextAccountColor(used)
        account.seed = known?.seed
        account.image = known?.image
        if (reconnecting && known) {
          account.name = known.name
          account.senderName = known.senderName
        } else account.senderName = input.senderName?.trim() || undefined
        // Aliases belong to the account rather than its login, so editing the login keeps them.
        const aliases = known?.aliases?.filter(
          (a) => a.email.toLowerCase() !== account.email.toLowerCase(),
        )
        if (aliases?.length) account.aliases = aliases
        used.push(account.color)
      }
      const keep = (value?: string) =>
        input.remember && secureStorageAvailable() && value ? encryptSecret(value) : undefined
      const local = (value: string | undefined, encrypted?: string) =>
        input.remember && !encrypted ? value : undefined
      const secret = keep(input.password)
      const outgoingSecret = keep(outgoingPassword)
      const connection: Connection = {
        id,
        name: input.name,
        config: input.config,
        secret,
        localSecret: local(input.password, secret),
        outgoingSecret,
        outgoingLocalSecret: outgoingPassword ? local(outgoingPassword, outgoingSecret) : undefined,
        folders,
        accounts,
      }
      this.connections = [...this.connections.filter((c) => c.id !== id), connection]
      await this.saveConnections()
    } catch (error) {
      provider.dispose()
      void provider.close?.()
      if (previous) this.status(id, 'authentication', friendlyError(error))
      throw error
    }
    const old = this.providers.get(id)
    if (old) {
      old.dispose()
      await old.close?.()
    }
    this.providers.set(id, provider)
    this.sessionSecrets.set(id, { password: input.password, outgoingPassword })
    this.accounts = [...this.accounts.filter((a) => a.connectionId !== id), ...accounts]
    provider.subscribe((event) => {
      if (event.type === 'indexing' && event.accountId && event.indexing) {
        this.accounts = this.accounts.map((a) =>
          a.id === event.accountId
            ? { ...a, indexing: event.indexing!.complete ? undefined : event.indexing }
            : a,
        )
        this.emitAccountsSoon()
        return
      }
      if (event.type === 'status' && event.state) {
        this.status(id, event.state, event.message)
        return
      }
      this.emit({ type: 'changed', accountId: event.accountId })
      // Historical indexing adds older mail; only live changes may produce notifications.
      if (!event.historical) void this.refreshConnection(id)
    })
    this.status(id, 'connected')
    if (!reconnecting) this.outgoing(id, undefined)
    void this.refreshConnection(id)
    this.log('connected', input.config.protocol)
    void this.syncPendingDrafts()
    void this.retrySentCopies(id)
    return accounts
  }
  private emitAccountsSoon() {
    if (this.indexingEmit) return
    this.indexingEmit = setTimeout(() => {
      this.indexingEmit = undefined
      this.emit({ type: 'accounts', accounts: this.accounts })
    }, 1000)
  }
  private secrets(connection: Connection): Secrets | undefined {
    const session = this.sessionSecrets.get(connection.id)
    if (session) return session
    const password = connection.secret ? decryptSecret(connection.secret) : connection.localSecret
    if (!password) return undefined
    const outgoingPassword = connection.outgoingSecret
      ? decryptSecret(connection.outgoingSecret)
      : connection.outgoingLocalSecret
    return { password, outgoingPassword }
  }
  reconnect = async (id: string): Promise<void> => {
    const connection = this.connections.find((c) => c.id === id)
    if (!connection) throw new Error('Connection not found.')
    this.status(id, 'connecting')
    try {
      const secrets = this.secrets(connection)
      if (!secrets) throw new Error('This was a session-only login. Sign in again to reconnect.')
      await this.connect(
        {
          config: connection.config,
          name: connection.name,
          password: secrets.password,
          outgoingPassword: secrets.outgoingPassword,
          remember: !!(connection.secret || connection.localSecret),
          connectionId: id,
        },
        true,
      )
    } catch (error) {
      this.status(
        id,
        error instanceof ProviderError && error.code !== 'authentication'
          ? 'offline'
          : 'authentication',
        friendlyError(error),
      )
      this.log('reconnect-failed')
      throw error
    }
  }
  connectionSettings = async (connectionId: string): Promise<ConnectionSettings> => {
    const connection = this.connections.find((c) => c.id === connectionId)
    if (!connection) throw new Error('Connection not found.')
    return {
      connectionId,
      name: connection.name,
      config: connection.config,
      remember: !!(connection.secret || connection.localSecret),
      folders: connection.folders,
    }
  }
  folderMappings = async (accountId: string) =>
    this.guard(accountId, async (p, a) => {
      if (!p.folderMappings) throw new Error('This server defines its special folders itself.')
      return p.folderMappings(a)
    })
  setFolderMappings = async (accountId: string, mappings: FolderMappings) => {
    const account = this.account(accountId)
    const review = await this.guard(accountId, async (p, a) => {
      if (!p.setFolderMappings) throw new Error('This server defines its special folders itself.')
      return p.setFolderMappings(a, mappings)
    })
    this.connections = this.connections.map((c) =>
      c.id === account.connectionId
        ? {
            ...c,
            folders: Object.fromEntries(
              Object.entries(review.mappings).map(([role, value]) => [
                role,
                value ? { path: value.path } : null,
              ]),
            ),
          }
        : c,
    )
    await this.saveConnections()
    this.emit({ type: 'changed', accountId })
    return review
  }
  /** Saves a change to one account's own settings, which never needs signing in again. */
  private async editAccount(accountId: string, patch: (a: Account) => Partial<Account>) {
    const account = this.account(accountId)
    const apply = (a: Account): Account => (a.id === accountId ? { ...a, ...patch(a) } : a)
    this.accounts = this.accounts.map(apply)
    this.connections = this.connections.map((c) =>
      c.id === account.connectionId ? { ...c, accounts: c.accounts.map(apply) } : c,
    )
    await this.saveConnections()
    this.emit({ type: 'accounts', accounts: this.accounts })
    return this.accounts
  }
  updateAccount = async (accountId: string, appearance: AccountAppearance): Promise<Account[]> => {
    if (appearance.image) {
      const [, type, data] = appearance.image.match(/^data:([^;]+);base64,(.*)$/)!
      if (rasterType(Buffer.from(data, 'base64')) !== type)
        throw new Error('This picture could not be read. Choose a PNG, JPEG or WebP image.')
    }
    return this.editAccount(accountId, () => ({ seed: appearance.seed, image: appearance.image }))
  }
  updateAccountDetails = async (accountId: string, details: AccountDetails): Promise<Account[]> =>
    this.editAccount(accountId, (a) => ({
      name: details.name.trim() || a.name,
      senderName: details.senderName.trim() || undefined,
    }))
  setAliases = async (accountId: string, input: AliasInput[]): Promise<Account[]> => {
    const account = this.account(accountId)
    if (account.protocol !== 'imap')
      throw new Error('This server manages its own sending addresses.')
    const taken = new Set([account.email.toLowerCase()])
    const aliases = input.map((alias): Alias => {
      const email = alias.email.trim()
      if (taken.has(email.toLowerCase()))
        throw new Error(email + ' is already one of this account’s addresses.')
      taken.add(email.toLowerCase())
      // Only a known ID is kept, so drafts and signatures stay with the alias they belong to.
      const id = account.aliases?.some((a) => a.id === alias.id) ? alias.id! : randomUUID()
      const name = alias.name?.trim()
      return { id, email, ...(name ? { name } : {}) }
    })
    return this.editAccount(accountId, () => ({ aliases: aliases.length ? aliases : undefined }))
  }
  disconnect = async (id: string): Promise<void> => {
    const accountIds = new Set(this.accounts.filter((a) => a.connectionId === id).map((a) => a.id))
    const provider = this.providers.get(id)
    provider?.dispose()
    await provider?.close?.()
    this.providers.delete(id)
    this.sessionSecrets.delete(id)
    this.connections = this.connections.filter((c) => c.id !== id)
    this.accounts = this.accounts.filter((a) => a.connectionId !== id)
    for (const draft of this.localDrafts.values())
      if (accountIds.has(draft.accountId)) await this.deleteDraftLocal(draft.id)
    for (const [key, journal] of this.journals)
      if (accountIds.has(journal.accountId)) {
        this.journals.delete(key)
        await this.removeMime(key)
      }
    for (const key of accountIds) {
      this.notificationBaseline.delete(key)
      this.unreadCounts.delete(key)
    }
    // The local message index belongs to this connection only.
    await rm(join(this.store.directory, 'index', id), { recursive: true, force: true })
    this.emit({
      type: 'unread',
      count: [...this.unreadCounts.values()].reduce((sum, n) => sum + n, 0),
    })
    this.undos.clear()
    await this.saveConnections()
    await this.persistDrafts()
    await this.persistJournal()
    this.emit({ type: 'accounts', accounts: this.accounts })
    this.emit({ type: 'changed' })
  }
  mailboxes = (id: string) => this.guard(id, (p, a) => p.mailboxes(a))
  identities = (id: string) => this.guard(id, (p, a) => p.identities(a))
  private async serverMessages(
    provider: MailProvider,
    account: Account,
    ids: string[],
    bodies = true,
    protectedMessage = false,
  ) {
    const messages = await provider.messages(account, ids, bodies)
    if (!provider.rawMessage) return messages
    return Promise.all(
      messages.map(async (message) => {
        if (
          !protectedMessage &&
          !message.security?.encrypted &&
          !/-----BEGIN PGP MESSAGE-----/.test(message.text || '')
        )
          return message
        const raw = await provider.rawMessage!(account, message.id, maxMessageBytes)
        if (securityKind(raw))
          return {
            ...message,
            html: '',
            text: '',
            preview: '',
            protectedRevision: createHash('sha256').update(raw).digest('hex'),
          }
        return message
      }),
    )
  }
  conversation = (id: string, threadId: string) =>
    this.guard(id, async (p, a) => {
      const messages = await p.conversation(a, threadId)
      if (!p.rawMessage) return messages
      return Promise.all(
        messages.map(async (message) =>
          this.encryption.read(message, await p.rawMessage!(a, message.id, maxMessageBytes)),
        ),
      )
    })
  query = async (query: MailQuery, cursor?: Record<string, number>): Promise<QueryPage> => {
    const accounts = this.accounts.filter(
      (a) => (!query.accountId || query.accountId === a.id) && (!cursor || a.id in cursor),
    )
    if (!accounts.length) return { items: [], total: 0, failedAccounts: [] }
    const settled = await Promise.allSettled(
      accounts.map(async (a) => ({
        accountId: a.id,
        position: cursor?.[a.id] || 0,
        page: await this.guard(a.id, (p, account) =>
          p.query(account, query, cursor?.[a.id] || 0, 50),
        ),
      })),
    )
    const pages = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
    if (!pages.length)
      throw new Error(
        'Mail is unavailable. Reconnect an account or try again shortly. Previously opened messages remain in your cache.',
      )
    const result = mergePages(pages, 50)
    result.failedAccounts = accounts
      .filter((_, i) => settled[i].status === 'rejected')
      .map((a) => a.id)
    return result
  }
  /**
   * Runs one read-plan-write cycle at a time per account. Each cycle checks the server state it
   * read, so two overlapping cycles (archive while the next conversation is marked read) would
   * otherwise make the later one fail with a state mismatch.
   */
  private exclusive<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.writes.get(accountId) || Promise.resolve()).then(task, task)
    const settled = run.catch(() => {})
    this.writes.set(accountId, settled)
    void settled.then(() => {
      if (this.writes.get(accountId) === settled) this.writes.delete(accountId)
    })
    return run
  }
  mutate = async (input: MutationInput): Promise<MutationResult> => {
    const result: MutationResult = { changed: 0, failures: [] },
      undo: UndoEntry[] = []
    for (const accountId of [...new Set(input.targets.map((t) => t.accountId))]) {
      try {
        await this.exclusive(accountId, async () => {
          const { provider, account } = this.provider(accountId)
          const boxes = await provider.mailboxes(account)
          const messages = await provider.conversationMetadata(
            account,
            input.targets.filter((t) => t.accountId === accountId).map((t) => t.threadId),
          )
          const expectedState = provider.getStateToken(account)
          const plan = planMutation(messages, boxes, input.action, input.mailboxId, {
            exclusiveMailboxes: provider.capabilities.exclusiveMailboxes,
          })
          const changed = await provider.update(
            account,
            input.action === 'destroy' ? {} : plan.changes,
            plan.destroy,
            expectedState,
          )
          result.changed += changed.updated.length
          result.failures.push(...changed.failures)
          if (input.action !== 'destroy')
            undo.push(undoForUpdated(accountId, plan, changed.updated))
        })
        this.emit({ type: 'changed', accountId })
      } catch (error) {
        result.failures.push(friendlyError(error))
      }
    }
    if (undo.length) {
      result.undoId = randomUUID()
      this.undos.set(result.undoId, undo)
      if (this.undos.size > 20) this.undos.delete(this.undos.keys().next().value!)
    }
    return result
  }
  mutateAll = async (query: MailQuery, action: MailAction): Promise<MutationResult> => {
    if (!['archive', 'trash', 'spam', 'read', 'unread', 'star', 'unstar'].includes(action))
      throw new Error('This action is not supported for all matching conversations.')
    // Snapshot IDs before changing membership so pagination cannot skip shifted rows.
    const targets: MutationInput['targets'] = []
    let matchingTotal = 0
    let cursor: Record<string, number> | undefined
    do {
      const page = await this.query(query, cursor)
      matchingTotal = Math.max(matchingTotal, page.total)
      if (page.failedAccounts.length)
        throw new Error('All accounts must be reachable before applying an action to all results.')
      if (page.incompleteAccounts?.length)
        throw new Error(
          'Some accounts are still indexing, so not every match is known yet. Try again when indexing finishes.',
        )
      targets.push(...page.items.map((c) => ({ accountId: c.accountId, threadId: c.id })))
      cursor = page.next
      if (targets.length > 250_000)
        throw new Error('Narrow your search to fewer than 250,000 conversations.')
      this.emit({
        type: 'progress',
        completed: targets.length,
        total: Math.max(matchingTotal, targets.length),
      })
    } while (cursor)
    const result: MutationResult = { changed: 0, failures: [] },
      combined: UndoEntry[] = []
    for (let i = 0; i < targets.length; i += 50) {
      const part = await this.mutate({ targets: targets.slice(i, i + 50), action })
      result.changed += part.changed
      result.failures.push(...part.failures)
      if (part.undoId) {
        combined.push(...(this.undos.get(part.undoId) || []))
        this.undos.delete(part.undoId)
      }
      this.emit({
        type: 'progress',
        completed: Math.min(i + 50, targets.length),
        total: targets.length,
      })
    }
    if (combined.length) {
      result.undoId = randomUUID()
      this.undos.set(result.undoId, combined)
      if (this.undos.size > 20) this.undos.delete(this.undos.keys().next().value!)
    }
    return result
  }
  undo = async (id: string): Promise<MutationResult> => {
    const entries = this.undos.get(id)
    if (!entries) throw new Error('This undo action has expired.')
    const result: MutationResult = { changed: 0, failures: [] }
    for (const entry of entries) {
      try {
        await this.exclusive(entry.accountId, async () => {
          const { current, state } = await this.guard(entry.accountId, async (p, a) => ({
            current: await p.messages(a, Object.keys(entry.changes)),
            state: p.getStateToken(a),
          }))
          const safe = safeUndoUpdates(entry, current)
          if (Object.keys(safe).length !== Object.keys(entry.changes).length)
            result.failures.push('Some messages changed since this action and were not undone.')
          const changed = await this.guard(entry.accountId, (p, a) => p.update(a, safe, [], state))
          result.changed += changed.updated.length
          result.failures.push(...changed.failures)
        })
        this.emit({ type: 'changed', accountId: entry.accountId })
      } catch (error) {
        result.failures.push(friendlyError(error))
      }
    }
    this.undos.delete(id)
    return result
  }
  folder = async (input: {
    accountId: string
    operation: 'create' | 'rename' | 'delete'
    id?: string
    name?: string
    parentId?: string
  }) => {
    await this.guard(input.accountId, (p, a) =>
      p.folder(a, input.operation, input.id, input.name, input.parentId),
    )
    this.emit({ type: 'changed', accountId: input.accountId })
  }
  // Sent records also serve as tombstones for a stale renderer draft after a crash.
  drafts = async () => [...this.localDrafts.values()]
  stageRemoteAttachments = async (
    accountId: string,
    attachments: Attachment[],
    protectedDraft = false,
  ): Promise<StagedAttachment[]> => {
    if (this.protectionTransition) throw new Error('The vault is locking.')
    const directory = join(this.store.directory, 'attachments')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const staged: StagedAttachment[] = []
    for (const attachment of attachments) {
      const bytes = await this.attachmentBytes(accountId, attachment)
      const item: StagedAttachment = {
        id: randomUUID(),
        name: attachment.name,
        type: attachment.type,
        size: bytes.length,
        cid: attachment.cid,
      }
      if (protectedDraft) {
        await this.protectStagedAttachment(item, bytes)
      } else await writeFile(join(directory, item.id), bytes, { mode: 0o600 })
      this.staging.set(item.id, item)
      staged.push(item)
      await this.persistStaging()
    }
    return staged
  }
  /** Reads a staged attachment. Only IDs recorded by this service resolve to files. */
  private async protectStagedAttachment(attachment: StagedAttachment, bytes: Uint8Array) {
    const protectedAttachment = { ...attachment, blobId: 'vault:' + attachment.id }
    await this.encryption.vault.putMany([
      ['attachment:' + attachment.id, bytes],
      ['attachment-meta:' + attachment.id, Buffer.from(JSON.stringify(protectedAttachment))],
    ])
    Object.assign(attachment, protectedAttachment)
  }
  private persistStaging() {
    return this.store.write(
      'staging',
      [...this.staging.values()].map((attachment) =>
        attachment.blobId?.startsWith('vault:')
          ? {
              id: attachment.id,
              size: attachment.size,
              name: 'Protected attachment',
              type: 'application/octet-stream',
              blobId: attachment.blobId,
            }
          : attachment,
      ),
    )
  }
  readStagedAttachment = async (id: string): Promise<Uint8Array> => {
    if (!this.staging.has(id))
      throw new Error('An attachment is missing. Remove it and attach the file again.')
    if (this.staging.get(id)?.blobId?.startsWith('vault:')) {
      const bytes = this.encryption.vault.read('attachment:' + id)
      if (!bytes) throw new Error('The protected attachment is missing.')
      return bytes
    }
    return readFile(join(this.store.directory, 'attachments', id))
  }
  resumeDraft = async (accountId: string, messageId: string): Promise<Draft> => {
    const existing = [...this.localDrafts.values()].find(
      (d) => d.accountId === accountId && d.serverId === messageId,
    )
    if (existing) return existing
    const [message] = await this.guard(accountId, async (p, a) => {
      const [m] = await p.messages(a, [messageId], true)
      return m && p.rawMessage
        ? [await this.encryption.read(m, await p.rawMessage(a, messageId, maxMessageBytes))]
        : [m]
    })
    if (!message?.keywords.$draft) throw new Error('This message is no longer a draft.')
    if (message.security && !['decrypted', 'signed'].includes(message.security.state))
      throw new Error(message.security.detail)
    const identities = await this.identities(accountId)
    const identity =
      identities.find((i) =>
        message.from.some((f) => f.email.toLowerCase() === i.email.toLowerCase()),
      ) || identities[0]
    if (!identity) throw new Error('No sending identity is available for this account.')
    const attachments = await this.stageRemoteAttachments(
      accountId,
      message.attachments || [],
      !!message.security?.encrypted,
    )
    const draft: Draft = {
      id: randomUUID(),
      accountId,
      identityId: identity.id,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      html: message.html || '',
      text: message.text || '',
      attachments,
      updatedAt: new Date().toISOString(),
      status: 'synced',
      encryption: message.security?.encrypted ? 'encrypt' : undefined,
      encryptionRequired: !!message.security?.encrypted,
      serverId: message.id,
      serverFingerprint: draftFingerprint(message),
      references: message.references,
      inReplyTo: message.inReplyTo,
    }
    return this.saveDraft(draft)
  }
  saveDraft = (draft: Draft): Promise<Draft> => {
    const operation = this.draftWrites.then(() => this.saveDraftNow(draft))
    this.draftWrites = operation.catch(() => {})
    return operation
  }
  private async saveDraftNow(draft: Draft): Promise<Draft> {
    if (this.protectionTransition) throw new Error('Wait for the vault to finish locking.')
    this.account(draft.accountId)
    const old = this.localDrafts.get(draft.id)
    if (this.busyDrafts.has(draft.id) || old?.status === 'uncertain' || old?.status === 'sent')
      return old || draft
    if (old && old.updatedAt > draft.updatedAt) return old
    // Server revisions belong to the main process. An edit captured before a sync reply
    // must not restore an ID that we have already replaced and removed from the server.
    // Clearing the link after a conflict is the explicit “Keep both versions” action.
    if (
      old?.serverId &&
      old.accountId === draft.accountId &&
      !(old.errorKind === 'conflict' && !draft.serverId)
    )
      draft = {
        ...draft,
        serverId: old.serverId,
        serverFingerprint: old.serverFingerprint,
      }
    if (
      draft.encryption !== 'encrypt' &&
      (old?.encryption === 'encrypt' || draft.encryptionRequired) &&
      !draft.downgradeConfirmed
    )
      throw new Error('Confirm sending or saving this decrypted content without encryption first.')
    if (old?.encryption === 'encrypt' && draft.encryption !== 'encrypt')
      this.requireProtectedDraft(old)
    if (draft.encryption === 'encrypt') {
      if (!this.encryption.vault.unlocked)
        throw new Error('Unlock the encryption vault to save this protected draft.')
      draft = {
        ...draft,
        earlierPlaintext:
          draft.earlierPlaintext ||
          old?.earlierPlaintext ||
          (!!old && old.encryption !== 'encrypt') ||
          (!!draft.serverId && old?.encryption !== 'encrypt'),
      }
      for (const attachment of draft.attachments) {
        const staged = this.staging.get(attachment.id)
        if (!staged) throw new Error('An attachment is missing.')
        if (!staged.blobId?.startsWith('vault:')) {
          const bytes = await this.readStagedAttachment(attachment.id)
          await this.protectStagedAttachment(staged, bytes)
          await this.persistStaging()
          await rm(join(this.store.directory, 'attachments', attachment.id), { force: true })
        }
      }
      this.protectedLoaded.add(draft.id)
    }
    this.localDrafts.set(draft.id, draft)
    await this.persistDrafts()
    if (old?.encryption === 'encrypt' && draft.encryption !== 'encrypt') {
      await this.encryption.vault.put('draft:' + draft.id, undefined)
      this.protectedLoaded.delete(draft.id)
    }
    return draft
  }
  /** Uploads attachments for providers that reference server blobs. Others read staged files. */
  private async uploadDraft(draft: Draft): Promise<Draft> {
    const { provider, account } = this.provider(draft.accountId)
    const attachments: StagedAttachment[] = []
    for (const attachment of draft.attachments) {
      const staged = this.staging.get(attachment.id)
      if (!staged) throw new Error('An attachment is missing. Remove it and attach the file again.')
      if (!provider.capabilities.blobUpload) {
        attachments.push({ ...staged, cid: attachment.cid ?? staged.cid })
        continue
      }
      const data = await this.readStagedAttachment(attachment.id)
      const blobId = await provider.upload(account, data, staged.type)
      attachments.push({ ...staged, blobId })
    }
    return { ...draft, attachments }
  }
  syncDraft = async (input: Draft): Promise<Draft> => {
    if (this.protectionTransition) throw new Error('The vault is locking.')
    if (this.busyDrafts.has(input.id)) return this.localDrafts.get(input.id) || input
    input = await this.saveDraft(input)
    this.busyDrafts.add(input.id)
    let committed: Draft | undefined
    try {
      const { provider, account } = this.provider(input.accountId)
      const current = this.localDrafts.get(input.id)
      if (current && current.updatedAt > input.updatedAt) return current
      if (current && ['uncertain', 'sent'].includes(current.status)) return current
      if (input.serverId) {
        const [remote] = await this.serverMessages(
          provider,
          account,
          [input.serverId],
          true,
          input.encryption === 'encrypt',
        )
        if (!remote || !remote.keywords.$draft)
          throw new ProviderError(
            'conflict',
            'This draft was sent or removed in another client. Your local copy is safe; keep both versions to start a separate draft.',
          )
        if (
          remote &&
          input.serverFingerprint &&
          draftFingerprint(remote) !== input.serverFingerprint
        )
          throw new ProviderError(
            'conflict',
            'This draft changed in another client. Your local copy is safe; save it as a new draft to keep both versions.',
          )
      }
      const protectedMime =
        input.encryption === 'encrypt'
          ? await this.protectedMime(input, randomUUID() + '@inlark.local', true)
          : undefined
      const draft = protectedMime ? input : await this.uploadDraft(input)
      const serverId = await provider.createDraft(account, draft, undefined, protectedMime)
      const [remote] = await this.serverMessages(
        provider,
        account,
        [serverId],
        true,
        input.encryption === 'encrypt',
      )
      const saved: Draft = {
        ...draft,
        serverId,
        serverFingerprint: remote ? draftFingerprint(remote) : undefined,
        status: 'synced',
        error: undefined,
        errorKind: undefined,
      }
      committed = saved
      this.localDrafts.set(saved.id, saved)
      await this.persistDrafts()
      if (input.serverId && input.serverId !== serverId)
        await this.removePreviousDraft(provider, account, input)
      this.emit({ type: 'changed', accountId: account.id })
      return saved
    } catch (error) {
      const saved: Draft = {
        ...(committed || input),
        status: 'error',
        error: friendlyError(error),
        errorKind: errorKind(error),
      }
      this.localDrafts.set(saved.id, saved)
      await this.persistDrafts()
      return saved
    } finally {
      this.busyDrafts.delete(input.id)
    }
  }
  /** Removes a replaced server draft only if nobody else changed it since it was read. */
  private async removePreviousDraft(provider: MailProvider, account: Account, draft: Draft) {
    const [remote] = await this.serverMessages(
      provider,
      account,
      [draft.serverId!],
      true,
      draft.encryption === 'encrypt',
    )
    const state = provider.getStateToken(account)
    if (!remote) return
    if (
      !remote.keywords.$draft ||
      !draft.serverFingerprint ||
      draftFingerprint(remote) !== draft.serverFingerprint
    )
      throw new ProviderError(
        'conflict',
        'The previous draft changed in another client and was preserved. Your new copy is saved.',
      )
    const result = await provider.update(account, {}, [draft.serverId!], state)
    if (result.failures.length)
      throw new Error('Your new draft is saved. The previous server copy could not be removed.')
  }
  private async completeDraft(draft: Draft) {
    // Keep a minimal tombstone so a stale renderer copy cannot reappear after a crash.
    this.localDrafts.set(draft.id, {
      id: draft.id,
      accountId: draft.accountId,
      identityId: draft.identityId,
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      html: '',
      text: '',
      attachments: [],
      updatedAt: draft.updatedAt,
      status: 'sent',
    })
    await this.persistDrafts()
    if (draft.encryption === 'encrypt' && this.encryption.vault.unlocked)
      await this.encryption.vault.put('draft:' + draft.id, undefined)
    this.protectedLoaded.delete(draft.id)
    await this.releaseAttachments(draft)
  }
  private async releaseAttachments(draft: Draft) {
    for (const attachment of draft.attachments) {
      if (
        ![...this.localDrafts.values()].some((d) =>
          d.attachments.some((a) => a.id === attachment.id),
        )
      ) {
        await rm(join(this.store.directory, 'attachments', attachment.id), { force: true })
        if (this.staging.get(attachment.id)?.blobId?.startsWith('vault:'))
          await this.encryption.vault.putMany([
            ['attachment:' + attachment.id, undefined],
            ['attachment-meta:' + attachment.id, undefined],
          ])
        this.staging.delete(attachment.id)
      }
    }
    if (draft.attachments.length) await this.persistStaging()
  }
  private async deleteDraftLocal(id: string) {
    const draft = this.localDrafts.get(id)
    if (draft?.encryption === 'encrypt') {
      if (!this.encryption.vault.unlocked)
        throw new Error('Unlock the vault before deleting this draft.')
      await this.encryption.vault.put('draft:' + id, undefined)
      this.protectedLoaded.delete(id)
    }
    this.localDrafts.delete(id)
    if (draft) await this.releaseAttachments(draft)
  }
  deleteDraft = async (id: string) => {
    if (this.busyDrafts.has(id)) throw new Error('Wait for this draft to finish saving.')
    const draft = this.localDrafts.get(id)
    if (draft?.encryption === 'encrypt') this.requireProtectedDraft(draft)
    if (draft?.status === 'uncertain')
      throw new Error('Check this message’s delivery status before deleting the draft.')
    if (draft?.serverId) {
      const result = await this.guard(draft.accountId, async (p, a) => {
        const [remote] = await this.serverMessages(
          p,
          a,
          [draft.serverId!],
          true,
          draft.encryption === 'encrypt',
        )
        const state = p.getStateToken(a)
        // Discarding a local copy must never remove mail already sent or changed elsewhere.
        if (
          !remote?.keywords.$draft ||
          !draft.serverFingerprint ||
          draftFingerprint(remote) !== draft.serverFingerprint
        )
          return { updated: [], failures: [] }
        return p.update(a, {}, [draft.serverId!], state)
      })
      if (result.failures.length)
        throw new Error('The server draft could not be deleted. Your local draft is preserved.')
    }
    await this.deleteDraftLocal(id)
    await this.persistDrafts()
    this.emit({ type: 'changed' })
  }
  deleteServerDraft = async (accountId: string, messageId: string) => {
    const linked = [...this.localDrafts.values()].find(
      (d) => d.accountId === accountId && d.serverId === messageId,
    )
    if (linked) return this.deleteDraft(linked.id)
    const result = await this.exclusive(accountId, () =>
      this.guard(accountId, async (p, a) => {
        const [message] = await p.messages(a, [messageId])
        const state = p.getStateToken(a)
        if (!message) return { updated: [], failures: [] }
        // Only a message that is still a draft may be removed; one sent meanwhile stays.
        if (!message.keywords.$draft) throw new Error('This message is no longer a draft.')
        return p.update(a, {}, [messageId], state)
      }),
    )
    if (result.failures.length) throw new Error('The server draft could not be deleted.')
    this.emit({ type: 'changed', accountId })
  }
  private mimePath(draftId: string) {
    return join(this.store.directory, 'outgoing', draftId + '.eml')
  }
  private async writeMime(draftId: string, mime: Uint8Array) {
    const directory = join(this.store.directory, 'outgoing')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const file = await open(this.mimePath(draftId), 'w', 0o600)
    try {
      await file.writeFile(mime)
      await file.sync()
    } finally {
      await file.close()
    }
  }
  private removeMime(draftId: string) {
    return rm(this.mimePath(draftId), { force: true })
  }
  private async outgoingMessage(journal: Journal): Promise<OutgoingMessage> {
    return {
      messageId: journal.messageId || journal.draftId + '@inlark.local',
      emailId: journal.emailId,
      envelope: journal.envelope || { from: '', to: [] },
      mime: journal.mime ? await readFile(this.mimePath(journal.draftId)) : undefined,
    }
  }
  /** A unique Message-ID per attempt, on the domain of the address the message is from. */
  private messageIdFor(account: Account, identityId: string) {
    const email = account.aliases?.find((a) => a.id === identityId)?.email || account.email
    const domain = email
      .split('@')[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9.-]/g, '')
    return randomUUID() + '@' + (domain || 'inlark.invalid')
  }
  private rejectedAddresses(draft: Draft, journal: Journal): Address[] {
    const refused = new Set((journal.rejected || []).map((r) => r.email.toLowerCase()))
    return [...draft.to, ...draft.cc, ...draft.bcc].filter((a) =>
      refused.has(a.email.toLowerCase()),
    )
  }
  private sendResult(journal: Journal, draft?: Draft): SendResult {
    const pending = ['pending', 'appending', 'uncertain', 'failed'].includes(journal.sentCopy || '')
    if (journal.state === 'partial') {
      const rejected = draft ? this.rejectedAddresses(draft, journal) : []
      return {
        status: 'partial',
        message:
          'Sent to some recipients. ' +
          (journal.rejected?.length || rejected.length) +
          ' refused the message.' +
          (pending ? ' Sent copy pending.' : ''),
        rejected,
        sentCopy: pending ? 'pending' : 'filed',
      }
    }
    return {
      status: 'sent',
      message: pending ? 'Message sent. Sent copy pending.' : 'Message sent.',
      sentCopy: pending ? 'pending' : 'filed',
    }
  }
  send = async (input: Draft): Promise<SendResult> => {
    if (this.protectionTransition) throw new Error('The vault is locking.')
    let draft = sendDraftSchema.parse(input)
    if (!draft.to.length && !draft.cc.length && !draft.bcc.length)
      throw new Error('Add at least one recipient.')
    if (this.busyDrafts.has(draft.id))
      throw new Error('This draft is still saving. Try again in a moment.')
    const existing = this.journals.get(draft.id)
    if (existing && existing.state !== 'rejected') return this.reconcile(draft.id)
    draft = sendDraftSchema.parse(await this.saveDraft(draft))
    const { provider, account } = this.provider(draft.accountId)
    this.busyDrafts.add(draft.id)
    const journal: Journal = {
      draftId: draft.id,
      accountId: draft.accountId,
      subject: draft.subject,
      messageId:
        provider.capabilities.sentCopy === 'client'
          ? this.messageIdFor(account, draft.identityId)
          : draft.id + '@inlark.local',
      state: 'preparing',
      at: new Date().toISOString(),
    }
    this.journals.set(draft.id, journal)
    let accepted = false
    // Only set once the durable journal says `submitting` and the network call begins.
    let attempted = false
    let uploaded = draft
    try {
      await this.persistJournal()
      if (draft.serverId) {
        const [remote] = await this.serverMessages(
          provider,
          account,
          [draft.serverId],
          true,
          draft.encryption === 'encrypt',
        )
        if (!remote || !remote.keywords.$draft)
          throw new ProviderError(
            'conflict',
            'This draft was sent or removed in another client. Review it before creating a separate draft.',
          )
        if (remote && draftFingerprint(remote) !== draft.serverFingerprint)
          throw new ProviderError(
            'conflict',
            'This draft changed in another client. Save a separate copy before sending.',
          )
      }
      const protectedMime =
        (draft.encryption && draft.encryption !== 'none') ||
        this.encryption.identity(draft.accountId, draft.identityId)?.enabled
          ? await this.protectedMime(draft, journal.messageId!)
          : undefined
      uploaded = protectedMime ? draft : await this.uploadDraft(draft)
      const outgoing = await provider.prepareSubmission(
        account,
        uploaded,
        journal.messageId!,
        protectedMime,
      )
      journal.emailId = outgoing.emailId
      journal.envelope = outgoing.envelope
      if (outgoing.mime) {
        await this.writeMime(draft.id, outgoing.mime)
        journal.mime = true
      }
      if (provider.capabilities.sentCopy === 'client') journal.sentCopy = 'pending'
      // Everything needed to recover must be durable before anything leaves the device.
      journal.state = 'submitting'
      await this.persistJournal()
      this.localDrafts.set(draft.id, { ...uploaded, status: 'sending' })
      await this.persistDrafts()
      attempted = true
      const outcome = await this.guard(account.id, (p, a) =>
        p.submit(a, outgoing, draft.identityId),
      )
      accepted = true
      this.outgoing(account.connectionId, undefined)
      journal.accepted = outcome.accepted
      journal.rejected = outcome.rejected
      journal.state = outcome.rejected.length ? 'partial' : 'sent'
      // Acceptance is recorded before filing or cleanup, which may fail independently.
      await this.persistJournal()
      if (journal.sentCopy) await this.fileSentCopy(journal, outgoing)
      // A partial send keeps its content so the refused recipients can be recovered.
      if (journal.state === 'sent') await this.completeDraft(uploaded)
      else this.localDrafts.set(draft.id, { ...uploaded, status: 'sent' })
      await this.persistDrafts()
      if (draft.serverId && draft.serverId !== journal.emailId)
        await this.removePreviousDraft(provider, account, draft).catch(() =>
          this.log('old-draft-cleanup-failed'),
        )
      this.emit({ type: 'changed', accountId: draft.accountId })
      return this.sendResult(journal, uploaded)
    } catch (error) {
      if (accepted) {
        this.localDrafts.set(draft.id, { ...uploaded, status: 'sent' })
        this.log('sent-local-save-failed')
        return {
          ...this.sendResult(journal, uploaded),
          message:
            'Message sent. Local status could not be saved; delivery will be reconciled after restart.',
        }
      }
      const ambiguous =
        attempted &&
        !(error instanceof ProviderError && definiteSubmissionCodes.includes(error.code))
      journal.state = ambiguous ? 'uncertain' : 'rejected'
      if (!ambiguous) {
        journal.sentCopy = undefined
        await this.removeMime(draft.id)
        journal.mime = undefined
      }
      await this.persistJournal()
      this.localDrafts.set(draft.id, {
        ...draft,
        status: ambiguous ? 'uncertain' : 'error',
        error: friendlyError(error),
        errorKind: ambiguous ? undefined : errorKind(error),
      })
      await this.persistDrafts()
      if (ambiguous)
        return {
          status: 'uncertain',
          message:
            'Delivery is not confirmed. Your draft is safe. Check status before trying again.',
        }
      throw error
    } finally {
      this.busyDrafts.delete(draft.id)
    }
  }
  /**
   * Files the Sent copy of an accepted message. Only filing is ever retried: the provider
   * looks for this attempt's Message-ID first, so an earlier unconfirmed append is never
   * duplicated and the message itself is never sent again.
   */
  private async fileSentCopy(journal: Journal, outgoing?: OutgoingMessage) {
    if (!['pending', 'uncertain', 'failed'].includes(journal.sentCopy || '')) return
    if (this.filing.has(journal.draftId)) return
    this.filing.add(journal.draftId)
    try {
      const { provider, account } = this.provider(journal.accountId)
      if (!provider.fileSentCopy) return
      const message = outgoing?.mime ? outgoing : await this.outgoingMessage(journal)
      journal.sentCopy = 'appending'
      await this.persistJournal()
      try {
        journal.sentCopy = await provider.fileSentCopy(account, message)
        journal.sentCopyError = undefined
        await this.persistJournal()
        await this.removeMime(journal.draftId)
      } catch (error) {
        journal.sentCopy =
          error instanceof ProviderError && error.code === 'filingUncertain'
            ? 'uncertain'
            : 'failed'
        journal.sentCopyError = friendlyError(error)
        this.log('sent-copy-failed', journal.sentCopy)
        await this.persistJournal()
      }
    } catch {
      this.log('sent-copy-deferred')
    } finally {
      this.filing.delete(journal.draftId)
    }
  }
  private async retrySentCopies(connectionId: string) {
    const accountIds = new Set(
      this.accounts.filter((a) => a.connectionId === connectionId).map((a) => a.id),
    )
    for (const journal of this.journals.values())
      if (
        accountIds.has(journal.accountId) &&
        ['sent', 'partial'].includes(journal.state) &&
        !journal.dismissed
      )
        await this.fileSentCopy(journal)
  }
  reconcile = async (id: string): Promise<SendResult> => {
    const journal = this.journals.get(id)
    if (!journal) throw new Error('No send attempt found.')
    const draft = this.localDrafts.get(id)
    if (journal.state === 'sent' || journal.state === 'partial') {
      if (journal.state === 'sent' && draft && (draft.status !== 'sent' || this.hasContent(draft)))
        await this.completeDraft(draft)
      return {
        ...this.sendResult(journal, draft),
        message: 'This message has already been sent.',
      }
    }
    if (journal.state === 'uncertain') {
      const message = await this.outgoingMessage(journal).catch(() => undefined)
      // Only server submission records prove delivery. A Sent copy alone does not.
      if (
        message &&
        (await this.guard(journal.accountId, (p, a) => p.submissionExists(a, message)))
      ) {
        journal.state = 'sent'
        await this.persistJournal()
        if (draft) await this.completeDraft(draft)
        this.emit({ type: 'changed', accountId: journal.accountId })
        return { status: 'sent', message: 'Delivery confirmed.', sentCopy: 'filed' }
      }
    }
    return {
      status: 'uncertain',
      message:
        'Delivery is still unconfirmed. Check Sent or the server before creating a replacement message.',
    }
  }
  private summaries(): SubmissionSummary[] {
    return [...this.journals.values()]
      .filter((j) => !j.dismissed)
      .flatMap((j): SubmissionSummary[] => {
        const draft = this.localDrafts.get(j.draftId)
        const copy: SubmissionSummary['sentCopy'] =
          j.sentCopy === 'pending' || j.sentCopy === 'appending'
            ? 'pending'
            : j.sentCopy === 'uncertain' || j.sentCopy === 'failed'
              ? j.sentCopy
              : undefined
        const base = {
          draftId: j.draftId,
          accountId: j.accountId,
          subject: j.subject ?? draft?.subject ?? '',
          at: j.at,
          ...(copy ? { sentCopy: copy } : {}),
          ...(j.sentCopyError ? { error: j.sentCopyError } : {}),
        }
        if (j.state === 'uncertain') return [{ ...base, state: 'uncertain' }]
        if (j.state === 'partial')
          return [
            {
              ...base,
              state: 'partial',
              rejected: draft
                ? this.rejectedAddresses(draft, j)
                : (j.rejected || []).map((r) => ({ name: '', email: r.email })),
            },
          ]
        if (j.state === 'sent' && copy) return [{ ...base, state: 'sent' }]
        return []
      })
  }
  submissions = async () => this.summaries()
  retrySentCopy = async (id: string): Promise<SendResult> => {
    const journal = this.journals.get(id)
    if (!journal || !['sent', 'partial'].includes(journal.state))
      throw new Error('Only a sent message can have its Sent copy filed again.')
    await this.fileSentCopy(journal)
    return this.sendResult(journal, this.localDrafts.get(id))
  }
  private copyDraft(source: Draft, patch: Partial<Draft>): Draft {
    return {
      ...source,
      id: randomUUID(),
      serverId: undefined,
      serverFingerprint: undefined,
      status: 'local',
      error: undefined,
      errorKind: undefined,
      updatedAt: new Date().toISOString(),
      ...patch,
    }
  }
  private requireProtectedDraft(draft: Draft) {
    if (
      draft.encryption === 'encrypt' &&
      (this.protectionTransition ||
        !this.encryption.vault.unlocked ||
        !this.protectedLoaded.has(draft.id))
    )
      throw new Error('Unlock the vault before recovering or changing this protected draft.')
  }
  recoverRejected = async (id: string): Promise<Draft> => {
    const journal = this.journals.get(id)
    const draft = this.localDrafts.get(id)
    if (journal?.state !== 'partial' || journal.dismissed || !draft)
      throw new Error('There are no refused recipients to recover for this message.')
    this.requireProtectedDraft(draft)
    if (this.busyDrafts.has(id)) throw new Error('Wait for this draft to finish saving.')
    this.busyDrafts.add(id)
    try {
      const refused = new Set(
        this.rejectedAddresses(draft, journal).map((a) => a.email.toLowerCase()),
      )
      const only = (list: Address[]) => list.filter((a) => refused.has(a.email.toLowerCase()))
      const recovery = this.copyDraft(draft, {
        to: only(draft.to),
        cc: only(draft.cc),
        bcc: only(draft.bcc),
      })
      this.localDrafts.set(recovery.id, recovery)
      if (recovery.encryption === 'encrypt') this.protectedLoaded.add(recovery.id)
      journal.dismissed = true
      await this.completeDraft(draft)
      await this.persistJournal()
      return recovery
    } finally {
      this.busyDrafts.delete(id)
    }
  }
  replaceUncertain = async (id: string): Promise<Draft> => {
    const journal = this.journals.get(id)
    const draft = this.localDrafts.get(id)
    if (journal?.state !== 'uncertain' || !draft)
      throw new Error('Only an unconfirmed message can be replaced.')
    this.requireProtectedDraft(draft)
    if (this.busyDrafts.has(id)) throw new Error('Wait for this draft to finish saving.')
    this.busyDrafts.add(id)
    try {
      // The unconfirmed record stays, so its evidence remains available for later checks.
      const replacement = this.copyDraft(draft, {})
      this.localDrafts.set(replacement.id, replacement)
      if (replacement.encryption === 'encrypt') this.protectedLoaded.add(replacement.id)
      await this.persistDrafts()
      return replacement
    } finally {
      this.busyDrafts.delete(id)
    }
  }
  dismissSubmission = async (id: string): Promise<void> => {
    const journal = this.journals.get(id)
    if (!journal) return
    const draft = this.localDrafts.get(id)
    if (draft && ['partial', 'uncertain'].includes(journal.state)) this.requireProtectedDraft(draft)
    journal.dismissed = true
    if (journal.sentCopy && journal.sentCopy !== 'filed' && journal.sentCopy !== 'server')
      journal.sentCopy = 'dismissed'
    if (draft && ['partial', 'uncertain'].includes(journal.state)) await this.completeDraft(draft)
    await this.removeMime(id)
    journal.mime = undefined
    await this.persistJournal()
  }
  stageAttachments = async (protectedDraft = false): Promise<StagedAttachment[]> => {
    const result = await dialog.showOpenDialog({
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return []
    if (this.protectionTransition) throw new Error('The vault is locking.')
    const directory = join(this.store.directory, 'attachments')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const attachments: StagedAttachment[] = []
    const types: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
      '.ics': 'text/calendar',
    }
    for (const path of result.filePaths) {
      const size = (await stat(path)).size
      if (size > 100_000_000) throw new Error('Files over 100 MB cannot be attached.')
      const a = {
        id: randomUUID(),
        name: basename(path),
        size,
        type: types[extname(path).toLowerCase()] || 'application/octet-stream',
      }
      if (protectedDraft) {
        await this.protectStagedAttachment(a, await readFile(path))
      } else {
        await copyFile(path, join(directory, a.id))
        await chmod(join(directory, a.id), 0o600)
      }
      this.staging.set(a.id, a)
      attachments.push(a)
    }
    await this.persistStaging()
    return attachments
  }
  private async attachmentBytes(accountId: string, attachment: Attachment): Promise<Uint8Array> {
    if (attachment.blobId.startsWith('decrypted:')) {
      const data = this.encryption.attachments.get(attachment.blobId)
      if (!this.encryption.vault.unlocked || data?.accountId !== accountId)
        throw new Error('Unlock and reopen this message to access its attachment.')
      return data.content
    }
    return this.guard(accountId, (p, a) => p.download(a, attachment))
  }
  attachment = async (accountId: string, attachment: Attachment, open: boolean): Promise<void> => {
    const result = await dialog.showSaveDialog({
      title: open ? 'Save and open attachment' : 'Save attachment',
      defaultPath: basename(attachment.name),
    })
    if (result.canceled || !result.filePath) return
    const bytes = await this.attachmentBytes(accountId, attachment)
    await writeFile(result.filePath, bytes, { mode: 0o600 })
    if (open) {
      const error = await shell.openPath(result.filePath)
      if (error) throw new Error('The file was saved, but no application could open it.')
    }
  }
  inlineImage = async (accountId: string, attachment: Attachment): Promise<string> => {
    if (!/^image\/(png|jpeg|gif|webp|avif)$/i.test(attachment.type) || attachment.size > 10_000_000)
      throw new Error('Unsupported inline image.')
    const bytes = await this.attachmentBytes(accountId, attachment)
    return 'data:' + attachment.type + ';base64,' + Buffer.from(bytes).toString('base64')
  }
  remoteImage = async (value: string, userInitiated = false): Promise<string | null> =>
    this.settings.remoteImages || (userInitiated && this.encryption.vault.unlocked)
      ? remoteImageData(value)
      : null
  senderAvatar = async (email: string): Promise<string | null> => {
    if (!this.settings.remoteImages) return null
    return this.senderAvatars.get(email)
  }
  unsubscribe = async (accountId: string, messageId: string) => {
    const [message] = await this.guard(accountId, async (p, a) => {
      const [m] = await p.messages(a, [messageId], true)
      return m && p.rawMessage
        ? [await this.encryption.read(m, await p.rawMessage(a, messageId, maxMessageBytes))]
        : [m]
    })
    const info = message?.unsubscribe
    if (!info) throw new Error('This message has no supported unsubscribe method.')
    if (info.url.startsWith('mailto:')) return { kind: 'mailto' as const, url: info.url }
    if (info.oneClick) {
      const response = await publicFetch(info.url, {
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
        headersOnly: true,
      })
      if (response.status < 200 || response.status >= 300)
        throw new Error('The unsubscribe request failed. Try the link in the message.')
      return { kind: 'done' as const }
    }
    await this.openExternal(info.url)
    return { kind: 'browser' as const }
  }
  openExternal = async (value: string): Promise<void> => {
    const url = new URL(value)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password)
      throw new Error('This link type is not supported.')
    if (url.protocol === 'mailto:') this.emit({ type: 'mailto', url: value })
    else await shell.openExternal(url.toString())
  }
  setSettings = async (settings: Settings) => {
    await this.store.write('settings', settings)
    if (!settings.remoteImages) this.senderAvatars.clear()
    this.settings = settings
    return settings
  }
  diagnostics = async () =>
    JSON.stringify(
      {
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron,
        secureStorage: secureStorageAvailable(),
        accounts: this.accounts.map((a, index) => ({
          index,
          protocol: a.protocol || 'jmap',
          status: a.status,
          outgoing: a.outgoingError ? 'error' : 'ok',
          indexing: a.indexing
            ? { indexed: a.indexing.indexed, total: a.indexing.total }
            : undefined,
        })),
        submissions: [...this.journals.values()].map((j) => ({
          state: j.state,
          sentCopy: j.sentCopy,
        })),
        events: this.logs,
      },
      null,
      2,
    )
  async refreshConnection(id: string) {
    if (this.refreshing.has(id)) return
    this.refreshing.add(id)
    try {
      for (const account of this.accounts.filter((a) => a.connectionId === id)) {
        try {
          const { provider } = this.provider(account.id)
          const mailboxes = await provider.mailboxes(account)
          this.unreadCounts.set(
            account.id,
            mailboxes.filter((b) => b.role === 'inbox').reduce((sum, b) => sum + b.unreadEmails, 0),
          )
          this.emit({
            type: 'unread',
            count: [...this.unreadCounts.values()].reduce((sum, n) => sum + n, 0),
          })
          const page = await provider.query(account, { view: 'inbox' }, 0, 25)
          const current = page.items[0]?.receivedAt || new Date().toISOString(),
            previous = this.notificationBaseline.get(account.id)
          const newItems = previous
            ? page.items.filter((c) => c.receivedAt > previous && c.unread)
            : []
          this.notificationBaseline.set(
            account.id,
            previous && previous > current ? previous : current,
          )
          if (
            previous &&
            newItems.length &&
            this.settings.notifications &&
            Notification.isSupported()
          ) {
            const notification = new Notification({
              title:
                newItems.length === 1
                  ? newItems[0].from[0]?.name || 'New email'
                  : newItems.length + ' new conversations',
              body: newItems.length === 1 ? newItems[0].subject : account.name,
              silent: false,
            })
            notification.on('click', () =>
              this.emit({ type: 'open', accountId: account.id, threadId: newItems[0].id }),
            )
            notification.show()
          }
          this.status(id, 'connected')
          this.emit({ type: 'changed', accountId: account.id })
        } catch (error) {
          this.status(
            id,
            error instanceof ProviderError && error.code === 'authentication'
              ? 'authentication'
              : 'offline',
            friendlyError(error),
          )
        }
      }
    } finally {
      this.refreshing.delete(id)
    }
  }
  private async syncPendingDrafts() {
    const pending = [...this.localDrafts.values()]
      .filter(
        (d) =>
          ['local', 'error'].includes(d.status) &&
          d.identityId &&
          d.errorKind !== 'conflict' &&
          !d.error?.includes('another client') &&
          this.accounts.some((a) => a.id === d.accountId && a.status === 'connected') &&
          Date.now() - Date.parse(d.updatedAt) > 2500,
      )
      .slice(0, 20)
    for (const draft of pending) {
      try {
        await this.syncDraft(draft)
      } catch {
        this.log('background-draft-sync-failed')
      }
    }
  }
  async refresh() {
    await Promise.allSettled(
      this.connections.map(async (c) => {
        const connected = this.accounts.some(
          (a) => a.connectionId === c.id && a.status === 'connected',
        )
        // Rediscover advertised endpoints after outages or session changes. Never replay writes.
        if (this.providers.has(c.id) && connected) {
          await this.refreshConnection(c.id)
          await this.retrySentCopies(c.id)
        } else if (c.secret || c.localSecret || this.sessionSecrets.has(c.id))
          await this.reconnect(c.id)
      }),
    )
    await this.syncPendingDrafts()
  }
  dispose() {
    void this.encryption.lock()
    if (this.timer) clearInterval(this.timer)
    if (this.indexingEmit) clearTimeout(this.indexingEmit)
    for (const provider of this.providers.values()) {
      provider.dispose()
      void provider.close?.()
    }
  }
}
