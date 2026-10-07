import { randomUUID } from 'node:crypto'
import {
  accountKey,
  accountColors,
  conversationFromMessages,
  isProviderError,
  ProviderError,
  type Account,
  type AccountLimits,
  type Attachment,
  type Draft,
  type FolderMappingReview,
  type FolderMappings,
  type Identity,
  type ImapConnectionConfig,
  type Mailbox,
  type MailProvider,
  type MailQuery,
  type Message,
  type MessageChanges,
  type OutgoingMessage,
  type ProviderCapabilities,
  type ProviderEvent,
  type ProviderPage,
  type SubmissionOutcome,
} from '@inlark/core'
import {
  attachmentsOf,
  flagFromKeyword,
  messageIds,
  metadataQuery,
  parseBlobId,
  partSection,
  previewText,
  textParts,
  toMessage,
  toNewMessage,
  uidSet,
} from './convert'
import { inspectCertificate } from './certificate'
import { isInbox, reviewFolders, rolesByPath } from './folders'
import { ImapFlowPort } from './imapflow-port'
import type {
  ConversationCursor,
  ConversationFilter,
  IndexedMailbox,
  IndexedMessage,
  MetadataIndex,
} from './metadata-index'
import { composeMime, parseMime } from './mime'
import type { ImapPort, ImapServerOptions, PortFactory, SearchCriteria } from './port'
import { submitSmtp, verifySmtp, type SmtpSettings } from './smtp'

export interface ImapProviderOptions {
  connectionId: string
  name: string
  config: ImapConnectionConfig
  password: string
  /** Only when the outgoing server has its own credentials. */
  outgoingPassword?: string
  folders?: FolderMappings
  index: MetadataIndex
  /** Reads a staged attachment by its ID; the desktop app owns the files. */
  readAttachment(id: string): Promise<Uint8Array>
  /** Keeps the index current in the background. Off for temporary connection tests. */
  background?: boolean
  ports?: PortFactory
  smtp?: {
    verify: (settings: SmtpSettings) => Promise<void>
    submit: (
      settings: SmtpSettings,
      envelope: OutgoingMessage['envelope'],
      mime: Uint8Array,
    ) => Promise<SubmissionOutcome>
  }
  inspect?: typeof inspectCertificate
  /** Tests only: trust an extra certificate authority. */
  tls?: { ca?: string | Uint8Array }
  timing?: Partial<Timing>
}
interface Timing {
  /** How often every folder is checked when nothing prompts it. */
  reconcileMs: number
  /** How often expunges and flags are fully compared even without a visible change. */
  fullReconcileMs: number
  initialBatch: number
  historicalBatch: number
  previews: number
  /** Grace period for a server that files its own Sent copy after submission. */
  sentCopyGraceMs: number
}
const defaultTiming: Timing = {
  reconcileMs: 120_000,
  fullReconcileMs: 15 * 60_000,
  initialBatch: 200,
  historicalBatch: 500,
  previews: 30,
  sentCopyGraceMs: 1500,
}
type Task = {
  run: (port: ImapPort) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  background: boolean
}
const roleViews = ['inbox', 'archive', 'sent', 'drafts', 'junk', 'trash']
const bodyLimit = 10_000_000
const partLimit = 5_000_000
const byMailbox = <T extends { mailboxId: string }>(items: T[]) => {
  const groups = new Map<string, T[]>()
  for (const item of items)
    groups.set(item.mailboxId, [...(groups.get(item.mailboxId) || []), item])
  return groups
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class ImapProvider implements MailProvider {
  readonly capabilities: ProviderCapabilities = {
    mail: true,
    submission: true,
    push: true,
    maxObjectsInGet: 500,
    maxObjectsInSet: 500,
    maxUploadSize: 100_000_000,
    blobUpload: false,
    exclusiveMailboxes: true,
    sentCopy: 'client',
  }
  private readonly accountId: string
  private readonly timing: Timing
  private readonly ports: PortFactory
  private folders: FolderMappings
  private command?: ImapPort
  private connecting?: Promise<ImapPort>
  private idle?: ImapPort
  private queue: Task[] = []
  private pumping = false
  private listeners = new Set<(event: ProviderEvent) => void>()
  private disposed = false
  private started = false
  private wakeLoop?: () => void
  private pending: 'none' | 'inbox' | 'all' = 'none'
  private lastSync = 0
  private lastFull = new Map<string, number>()
  private uidLists = new Map<string, number[]>()
  private searches = new Map<string, { ids: string[]; incomplete: boolean; at: number }>()
  private cursors = new Map<string, ConversationCursor>()
  private bodies = new Map<string, { html: string; text: string }>()
  private state: 'connected' | 'offline' | 'authentication' = 'connected'
  private lastFailure?: { at: number; error: unknown }
  private limits: AccountLimits = {}
  constructor(private options: ImapProviderOptions) {
    this.accountId = accountKey(options.connectionId, 'imap')
    this.timing = { ...defaultTiming, ...options.timing }
    this.ports = options.ports || ((settings, purpose) => new ImapFlowPort(settings, purpose))
    this.folders = options.folders || {}
  }
  private get index() {
    return this.options.index
  }
  private emit(event: ProviderEvent) {
    for (const listener of this.listeners) listener(event)
  }
  private imapSettings(): ImapServerOptions {
    return {
      ...this.options.config.incoming,
      password: this.options.password,
      tls: this.options.tls,
    }
  }
  private smtpSettings(): SmtpSettings {
    const { config } = this.options
    return {
      ...config.outgoing,
      username: config.outgoingSameCredentials
        ? config.incoming.username
        : config.outgoing.username,
      password: config.outgoingSameCredentials
        ? this.options.password
        : this.options.outgoingPassword || '',
      tls: this.options.tls,
    }
  }

  // Connection and command queue

  /** Runs one task at a time on the command connection. User work goes before background work. */
  private run<T>(task: (port: ImapPort) => Promise<T>, background = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Task = {
        run: task,
        resolve: resolve as (v: unknown) => void,
        reject,
        background,
      }
      const firstBackground = this.queue.findIndex((t) => t.background)
      if (background || firstBackground < 0) this.queue.push(entry)
      else this.queue.splice(firstBackground, 0, entry)
      void this.pump()
    })
  }
  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length) {
        const task = this.queue.shift()!
        try {
          task.resolve(await task.run(await this.commandPort()))
        } catch (error) {
          task.reject(error)
        }
      }
    } finally {
      this.pumping = false
    }
  }
  private commandPort(): Promise<ImapPort> {
    if (this.disposed) return Promise.reject(new ProviderError('offline', 'Account disconnected.'))
    if (this.command) return Promise.resolve(this.command)
    // While the server is unreachable, fail at once instead of waiting out another timeout.
    if (this.lastFailure && Date.now() - this.lastFailure.at < 5000)
      return Promise.reject(this.lastFailure.error)
    this.connecting ??= (async () => {
      const port = this.ports(this.imapSettings(), 'command')
      port.on('close', () => {
        if (this.command === port) this.command = undefined
      })
      try {
        await port.connect()
      } catch (error) {
        this.lastFailure = { at: Date.now(), error }
        void port.close().catch(() => {})
        throw error
      }
      this.lastFailure = undefined
      if (this.disposed) {
        void port.close().catch(() => {})
        throw new ProviderError('offline', 'Account disconnected.')
      }
      this.command = port
      this.limits = limitsFor(port.capabilities)
      return port
    })().finally(() => (this.connecting = undefined))
    return this.connecting
  }
  private setState(state: 'connected' | 'offline' | 'authentication', message?: string) {
    if (this.state === state) return
    this.state = state
    this.emit({ type: 'status', accountId: this.accountId, state, message })
  }

  async connect(): Promise<Account[]> {
    this.disposed = false
    await this.run(async (port) => {
      const boxes = await this.refreshFolders(port)
      // Counts for the folders shown first; the rest arrive with the first background pass.
      const roles = rolesByPath(reviewFolders(boxes, this.folders))
      for (const box of boxes.filter(
        (b) => !b.noSelect && (isInbox(b.path) || roles.has(b.path)),
      )) {
        const status = await port.status(box.path)
        await this.index.updateMailbox(this.accountId, box.id, {
          total: status.messages,
          unread: status.unseen,
        })
      }
    })
    if (this.options.background !== false && !this.started) {
      this.started = true
      void this.syncLoop()
      void this.idleLoop()
    }
    this.state = 'connected'
    return [this.account()]
  }
  private account(): Account {
    return {
      id: this.accountId,
      connectionId: this.options.connectionId,
      remoteId: 'imap',
      name: this.options.name || this.options.config.email,
      email: this.options.config.email,
      color: accountColors[1],
      status: 'connected',
      protocol: 'imap',
      ...(Object.keys(this.limits).length ? { limits: this.limits } : {}),
    }
  }
  verifyOutgoing(): Promise<void> {
    return (this.options.smtp?.verify || verifySmtp)(this.smtpSettings())
  }
  inspectCertificate(server: 'incoming' | 'outgoing') {
    const { config, tls } = this.options
    return (this.options.inspect || inspectCertificate)(
      config[server],
      server === 'incoming' ? 'imap' : 'smtp',
      { ca: tls?.ca },
    )
  }

  // Folders

  private async refreshFolders(port: ImapPort): Promise<IndexedMailbox[]> {
    return this.index.syncMailboxes(this.accountId, await port.list())
  }
  private review(boxes: IndexedMailbox[]): FolderMappingReview {
    return reviewFolders(boxes, this.folders)
  }
  private async roleBox(role: string): Promise<IndexedMailbox | undefined> {
    const boxes = await this.index.listMailboxes(this.accountId)
    if (role === 'inbox') return boxes.find((b) => isInbox(b.path))
    const path = this.review(boxes).mappings[role as keyof FolderMappingReview['mappings']]?.path
    return boxes.find((b) => b.path === path)
  }
  async mailboxes(account: Account): Promise<Mailbox[]> {
    const boxes = await this.index.listMailboxes(this.accountId)
    // The service asks for folders on every refresh and after resume; reconcile when due.
    if (Date.now() - this.lastSync > 45_000) this.requestSync('all')
    const roles = rolesByPath(this.review(boxes))
    const byPath = new Map(boxes.map((b) => [b.path, b]))
    const move = !this.limits.move
    return boxes.map((box) => {
      const role = isInbox(box.path) ? 'inbox' : roles.get(box.path) || null
      return {
        id: box.id,
        accountId: account.id,
        name: isInbox(box.path) ? 'Inbox' : box.name,
        role,
        parentId: (box.parentPath && byPath.get(box.parentPath)?.id) || null,
        totalEmails: box.total,
        unreadEmails: box.unread,
        rights: {
          mayReadItems: !box.noSelect,
          mayAddItems: !box.noSelect,
          mayRemoveItems: !box.noSelect && move,
          maySetSeen: !box.noSelect,
          maySetKeywords: !box.noSelect,
          mayCreateChild: true,
          mayRename: !role,
          mayDelete: !role,
        },
      }
    })
  }
  async folderMappings(): Promise<FolderMappingReview> {
    return this.review(await this.index.listMailboxes(this.accountId))
  }
  async setFolderMappings(
    _account: Account,
    requested: FolderMappings,
  ): Promise<FolderMappingReview> {
    const mappings: FolderMappings = { ...requested }
    const boxes = await this.run(async (port) => {
      let boxes = await this.refreshFolders(port)
      for (const [role, mapping] of Object.entries(mappings) as [
        keyof FolderMappings,
        FolderMappings[keyof FolderMappings],
      ][])
        if (mapping?.create && !boxes.some((b) => b.path === mapping.path)) {
          const path = newFolderPath(boxes, mapping.path)
          if (!boxes.some((b) => b.path === path)) await port.createMailbox(path)
          mappings[role] = { path }
          boxes = await this.refreshFolders(port)
        }
      return boxes
    })
    for (const [role, mapping] of Object.entries(mappings))
      if (mapping && !boxes.some((b) => b.path === mapping.path && !b.noSelect))
        throw new ProviderError(
          'notFound',
          'The folder “' + mapping.path + '” for ' + role + ' does not exist.',
        )
    this.folders = Object.fromEntries(
      Object.entries(mappings).map(([role, value]) => [role, value ? { path: value.path } : null]),
    )
    return this.review(boxes)
  }
  async folder(
    _account: Account,
    operation: 'create' | 'rename' | 'delete',
    id?: string,
    name?: string,
    parentId?: string,
  ): Promise<void> {
    const boxes = await this.index.listMailboxes(this.accountId)
    const roles = rolesByPath(this.review(boxes))
    const box = boxes.find((b) => b.id === id)
    const delimiter = boxes.find((b) => b.delimiter)?.delimiter || '/'
    if (operation !== 'create' && (!box || isInbox(box.path) || roles.has(box.path)))
      throw new ProviderError('permission', 'Special folders cannot be renamed or deleted.')
    if (name && name.includes(box?.delimiter || delimiter))
      throw new ProviderError('invalid', 'Folder names cannot contain “' + delimiter + '”.')
    await this.run(async (port) => {
      if (operation === 'create') {
        const parent = boxes.find((b) => b.id === parentId)
        await port.createMailbox(
          parent ? parent.path + parent.delimiter + name : newFolderPath(boxes, name!),
        )
      } else if (operation === 'rename') {
        const target = box!.parentPath ? box!.parentPath + box!.delimiter + name : name!
        await port.renameMailbox(box!.path, target)
        // Keep IDs and indexed mail for the folder and everything below it.
        await this.index.renameMailbox(this.accountId, box!.id, target, name!)
        for (const child of boxes.filter((b) => b.path.startsWith(box!.path + box!.delimiter)))
          await this.index.renameMailbox(
            this.accountId,
            child.id,
            target + child.path.slice(box!.path.length),
            child.name,
          )
      } else {
        // IMAP DELETE removes the messages too; like JMAP here, a folder must be empty first.
        if (boxes.some((b) => b.parentPath === box!.path))
          throw new ProviderError('folder', 'Delete or move the folders inside it first.')
        if ((await port.status(box!.path)).messages > 0)
          throw new ProviderError(
            'folder',
            'This folder still contains messages. Move or delete them first.',
          )
        await port.deleteMailbox(box!.path)
      }
      await this.refreshFolders(port)
    })
  }

  // Synchronization

  requestSync(scope: 'inbox' | 'all') {
    if (this.pending !== 'all') this.pending = scope
    this.wakeLoop?.()
  }
  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      this.wakeLoop = done
    }).finally(() => (this.wakeLoop = undefined))
  }
  private async syncLoop() {
    let failures = 0
    while (!this.disposed) {
      try {
        const scope = this.pending === 'none' ? 'all' : this.pending
        this.pending = 'none'
        await this.syncPass(scope)
        failures = 0
        this.setState('connected')
        let more = true
        while (!this.disposed && more && this.pending === 'none')
          more = await this.historicalBatch()
        if (!this.disposed && this.pending === 'none') await this.wait(this.timing.reconcileMs)
      } catch (error) {
        if (this.disposed) break
        if (isProviderError(error, 'authentication')) this.setState('authentication', error.message)
        else if (isProviderError(error, 'network', 'tls', 'certificate'))
          this.setState('offline', error.message)
        failures++
        await this.wait(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)))
      }
    }
  }
  /** Keeps a second connection idling on Inbox so new mail arrives without polling. */
  private async idleLoop() {
    let attempt = 0
    while (!this.disposed) {
      const port = this.ports(this.imapSettings(), 'idle')
      try {
        const closed = new Promise<void>((resolve) => port.on('close', resolve))
        for (const event of ['exists', 'expunge', 'flags'] as const)
          port.on(event, () => this.requestSync('inbox'))
        await port.connect()
        await port.select('INBOX')
        if (this.disposed) break
        this.idle = port
        attempt = 0
        await closed
      } catch {
        void port.close().catch(() => {})
      } finally {
        if (this.idle === port) this.idle = undefined
      }
      if (this.disposed) break
      // Changes may have been missed while disconnected.
      this.requestSync('inbox')
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6)))
    }
  }
  private ordered(boxes: IndexedMailbox[]) {
    const roles = rolesByPath(this.review(boxes))
    const rank = (b: IndexedMailbox) => (isInbox(b.path) ? 0 : roles.has(b.path) ? 1 : 2)
    return boxes.filter((b) => !b.noSelect).sort((a, b) => rank(a) - rank(b))
  }
  private async syncPass(scope: 'inbox' | 'all') {
    const boxes = await this.run(async (port) => this.refreshFolders(port), true)
    let changed = false
    for (const box of this.ordered(boxes)) {
      if (this.disposed) return
      if (scope === 'inbox' && !isInbox(box.path)) continue
      changed = (await this.run((port) => this.syncMailbox(port, box), true)) || changed
    }
    this.lastSync = Date.now()
    if (changed) this.emit({ type: 'changed', accountId: this.accountId })
    await this.emitProgress()
  }
  private async emitProgress() {
    const boxes = (await this.index.listMailboxes(this.accountId)).filter((b) => !b.noSelect)
    const { messages } = await this.index.counts(this.accountId)
    this.emit({
      type: 'indexing',
      accountId: this.accountId,
      indexing: {
        indexed: messages,
        total: Math.max(
          messages,
          boxes.reduce((sum, b) => sum + b.total, 0),
        ),
        complete: boxes.every((b) => b.complete),
      },
    })
  }
  /** Brings one folder up to date. Returns whether anything visible changed. */
  private async syncMailbox(port: ImapPort, stored: IndexedMailbox): Promise<boolean> {
    let box = stored
    const status = await port.status(box.path)
    let changed = false
    if (box.uidValidity && status.uidValidity && status.uidValidity !== box.uidValidity) {
      // Every stored UID in this folder is meaningless now.
      await this.index.resetMailbox(this.accountId, box.id, status.uidValidity)
      this.uidLists.delete(box.id)
      box = {
        ...box,
        uidValidity: status.uidValidity,
        uidNext: null,
        highestModseq: null,
        indexedFrom: null,
        complete: false,
      }
      changed = true
    }
    const full = Date.now() - (this.lastFull.get(box.id) || 0) > this.timing.fullReconcileMs
    const same =
      box.uidNext !== null &&
      status.uidNext === box.uidNext &&
      status.messages === box.total &&
      status.unseen === box.unread &&
      (!status.highestModseq || status.highestModseq === box.highestModseq)
    if (same && !full) return changed
    const selected = await port.select(box.path)
    if (box.uidValidity && selected.uidValidity !== box.uidValidity) return changed
    const location = { mailboxId: box.id, uidValidity: selected.uidValidity }
    if (box.uidNext === null || box.indexedFrom === null) {
      const uids = await port.search({ all: true })
      this.uidLists.set(box.id, uids)
      const newest = uids.slice(-this.timing.initialBatch)
      const ids = await this.store(port, newest, location)
      await this.index.updateMailbox(this.accountId, box.id, {
        uidValidity: selected.uidValidity,
        uidNext: selected.uidNext,
        highestModseq: selected.highestModseq ?? null,
        total: status.messages,
        unread: status.unseen,
        indexedFrom: newest[0] ?? 1,
        complete: newest.length === uids.length,
      })
      this.lastFull.set(box.id, Date.now())
      void this.fillPreviews(ids.slice(-this.timing.previews))
      return true
    }
    let added: string[] = []
    if (selected.uidNext > box.uidNext) {
      const fetched = (await port.fetch(box.uidNext + ':*', metadataQuery)).filter(
        (m) => m.uid >= box.uidNext!,
      )
      added = await this.index.upsertMessages(
        this.accountId,
        fetched.map((m) => toNewMessage(m, location)),
      )
      changed ||= added.length > 0
    }
    if (port.condstore && box.highestModseq && selected.highestModseq !== box.highestModseq) {
      const flags = await port.fetch(
        (box.indexedFrom || 1) + ':*',
        { flags: true },
        box.highestModseq,
      )
      await this.index.updateFlags(
        this.accountId,
        box.id,
        flags.map((m) => ({ uid: m.uid, flags: m.flags || [], modseq: m.modseq })),
      )
      changed ||= flags.length > 0
    } else if (!port.condstore && (status.unseen !== box.unread || full)) {
      // Without CONDSTORE, compare flags for the most recent part of the folder.
      const known = (await this.index.knownUids(this.accountId, box.id)).slice(full ? -5000 : -500)
      if (known.length) {
        const flags = await port.fetch(uidSet(known), { flags: true })
        await this.index.updateFlags(
          this.accountId,
          box.id,
          flags.map((m) => ({ uid: m.uid, flags: m.flags || [] })),
        )
        changed = true
      }
    }
    // Arrivals alone explain a count change; anything else means messages were expunged.
    if (full || status.messages !== box.total + added.length) {
      const present = await port.search({ all: true })
      this.uidLists.set(box.id, present)
      const set = new Set(present)
      const gone = (await this.index.knownUids(this.accountId, box.id)).filter(
        (uid) => !set.has(uid),
      )
      if (gone.length) {
        await this.index.removeUids(this.accountId, box.id, gone)
        changed = true
      }
      this.lastFull.set(box.id, Date.now())
    }
    await this.index.updateMailbox(this.accountId, box.id, {
      uidValidity: selected.uidValidity,
      uidNext: selected.uidNext,
      highestModseq: selected.highestModseq ?? null,
      total: status.messages,
      unread: status.unseen,
    })
    if (added.length) void this.fillPreviews(added)
    return changed || status.unseen !== box.unread || status.messages !== box.total
  }
  private async store(
    port: ImapPort,
    uids: number[],
    location: { mailboxId: string; uidValidity: string },
  ) {
    const ids: string[] = []
    for (let i = 0; i < uids.length; i += 250) {
      const fetched = await port.fetch(uidSet(uids.slice(i, i + 250)), metadataQuery)
      ids.push(
        ...(await this.index.upsertMessages(
          this.accountId,
          fetched.map((m) => toNewMessage(m, location)),
        )),
      )
    }
    return ids
  }
  /** Indexes one batch of older mail. Returns whether any folder still has older mail. */
  private async historicalBatch(): Promise<boolean> {
    const boxes = await this.index.listMailboxes(this.accountId)
    const box = this.ordered(boxes).find(
      (b) => !b.complete && b.indexedFrom !== null && b.uidValidity,
    )
    if (!box) return false
    await this.run(async (port) => {
      const selected = await port.select(box.path)
      if (selected.uidValidity !== box.uidValidity) return
      let uids = this.uidLists.get(box.id)
      if (!uids) {
        uids = box.indexedFrom! > 1 ? await port.search({ uid: '1:' + (box.indexedFrom! - 1) }) : []
        this.uidLists.set(box.id, uids)
      }
      const below = uids.filter((uid) => uid < box.indexedFrom!)
      const batch = below.slice(-this.timing.historicalBatch)
      if (batch.length)
        await this.store(port, batch, { mailboxId: box.id, uidValidity: selected.uidValidity })
      await this.index.updateMailbox(this.accountId, box.id, {
        indexedFrom: batch[0] ?? box.indexedFrom,
        complete: batch.length === below.length,
      })
      if (batch.length === below.length) this.uidLists.delete(box.id)
    }, true)
    // Older mail must never look like new mail.
    this.emit({ type: 'changed', accountId: this.accountId, historical: true })
    await this.emitProgress()
    return true
  }
  private async fillPreviews(ids: string[]) {
    if (!ids.length || this.disposed) return
    const rows = await this.index.messages(this.accountId, ids)
    for (const [mailboxId, items] of byMailbox(rows)) {
      const box = (await this.index.listMailboxes(this.accountId)).find((b) => b.id === mailboxId)
      if (!box) continue
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        for (const row of items) {
          if (row.preview || selected.uidValidity !== row.uidValidity) continue
          const { text, html } = textParts(row.bodyStructure)
          const part = text || html
          if (!part) continue
          try {
            const bytes = await port.download(row.uid, partSection(part), 4096, true)
            const preview = previewText(new TextDecoder().decode(bytes), part === html)
            if (preview) await this.index.setPreview(this.accountId, row.id, preview)
          } catch {
            // A missing preview is harmless; the body loads when the message opens.
          }
        }
      }, true).catch(() => {})
    }
    this.emit({ type: 'changed', accountId: this.accountId, historical: true })
  }

  // Reading

  private async scope(query: MailQuery, boxes: IndexedMailbox[]) {
    const roles = rolesByPath(this.review(boxes))
    const roleOf = (b: IndexedMailbox) => (isInbox(b.path) ? 'inbox' : roles.get(b.path))
    const selectable = boxes.filter((b) => !b.noSelect)
    if (query.mailboxId) {
      const box = selectable.find((b) => b.id === query.mailboxId)
      return box ? { boxes: [box], filter: { mailboxIds: [box.id] } } : undefined
    }
    if (roleViews.includes(query.view)) {
      const box = selectable.find((b) => roleOf(b) === query.view)
      // A missing role yields no messages, never the entire account.
      return box ? { boxes: [box], filter: { mailboxIds: [box.id] } } : undefined
    }
    const excluded = selectable.filter((b) => ['junk', 'trash'].includes(roleOf(b) || ''))
    return {
      boxes: selectable.filter((b) => !excluded.includes(b)),
      filter: excluded.length ? { excludeMailboxIds: excluded.map((b) => b.id) } : {},
    }
  }
  async query(account: Account, query: MailQuery, position = 0, limit = 50): Promise<ProviderPage> {
    const boxes = await this.index.listMailboxes(this.accountId)
    const scope = await this.scope(query, boxes)
    if (!scope) return { items: [], total: 0 }
    const filter: ConversationFilter = {
      ...scope.filter,
      ...(query.view === 'starred' ? { flagged: true } : {}),
      ...(query.unread ? { unseen: true } : {}),
      ...(query.hasAttachment ? { hasAttachment: true } : {}),
      ...(query.after ? { after: query.after } : {}),
      ...(query.before ? { before: query.before } : {}),
    }
    let incomplete = scope.boxes.some((b) => !b.complete)
    if (query.text || query.from || query.to || query.subject) {
      const found = await this.search(query, scope.boxes)
      filter.ids = found.ids
      incomplete = found.incomplete
    }
    const key = JSON.stringify(query)
    const after = position ? this.cursors.get(key + '@' + position) : undefined
    const page = await this.index.conversations(this.accountId, filter, {
      limit,
      ...(after ? { after } : { offset: position }),
    })
    const threads = await this.index.threadMessages(
      this.accountId,
      page.items.map((i) => i.threadId),
    )
    const items = page.items.map((row) => {
      const messages = threads.filter((m) => m.threadId === row.threadId)
      const c = conversationFromMessages(
        account.id,
        row.threadId,
        (messages.length ? messages : [row.latest]).map((m) => toMessage(account.id, m)),
      )
      // Display the matching representative, even if the thread has newer mail elsewhere.
      c.receivedAt = row.latest.receivedAt
      c.subject = row.latest.subject || '(No subject)'
      c.preview = toMessage(account.id, row.latest).preview
      c.count = row.count
      return c
    })
    const end = position + items.length
    const last = page.items.at(-1)
    if (last) {
      this.cursors.set(key + '@' + end, {
        receivedAt: last.latest.receivedAt,
        threadId: last.threadId,
      })
      if (this.cursors.size > 500) this.cursors.delete(this.cursors.keys().next().value!)
    }
    return {
      items,
      total: page.total,
      next: items.length === limit && end < page.total ? end : undefined,
      ...(incomplete ? { incomplete: true } : {}),
    }
  }
  /** Server search in each relevant folder; matches not yet indexed are indexed on the way. */
  private async search(query: MailQuery, boxes: IndexedMailbox[]) {
    const key = JSON.stringify([query, boxes.map((b) => b.id)])
    const cached = this.searches.get(key)
    if (cached && Date.now() - cached.at < 60_000) return cached
    const criteria: SearchCriteria = {
      ...(query.text ? { text: query.text } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.subject ? { subject: query.subject } : {}),
      ...(query.after ? { since: new Date(query.after) } : {}),
      ...(query.before ? { before: new Date(query.before) } : {}),
      ...(query.unread ? { seen: false } : {}),
      ...(query.view === 'starred' ? { flagged: true } : {}),
    }
    const ids: string[] = []
    let incomplete = false
    for (const box of boxes)
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        const uids = await port.search(criteria)
        const capped = uids.slice(-5000)
        incomplete ||= capped.length < uids.length
        if (box.uidValidity && selected.uidValidity !== box.uidValidity) {
          incomplete = true
          return
        }
        const known = await this.index.messagesAt(this.accountId, box.id, capped)
        const have = new Set(known.map((m) => m.uid))
        ids.push(...known.map((m) => m.id))
        ids.push(
          ...(await this.store(
            port,
            capped.filter((uid) => !have.has(uid)),
            { mailboxId: box.id, uidValidity: selected.uidValidity },
          )),
        )
      })
    const result = { ids, incomplete, at: Date.now() }
    this.searches.set(key, result)
    if (this.searches.size > 20) this.searches.delete(this.searches.keys().next().value!)
    return result
  }
  /** Re-reads flags from the server so decisions use current remote state. */
  private async current(rows: IndexedMessage[]): Promise<IndexedMessage[]> {
    const boxes = await this.index.listMailboxes(this.accountId)
    for (const [mailboxId, items] of byMailbox(rows)) {
      const box = boxes.find((b) => b.id === mailboxId)
      if (!box) continue
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        const valid = items.filter((m) => m.uidValidity === selected.uidValidity)
        const fetched = valid.length
          ? await port.fetch(uidSet(valid.map((m) => m.uid)), { flags: true })
          : []
        await this.index.updateFlags(
          this.accountId,
          box.id,
          fetched.map((m) => ({ uid: m.uid, flags: m.flags || [], modseq: m.modseq })),
        )
        const present = new Set(fetched.map((m) => m.uid))
        const gone = valid.filter((m) => !present.has(m.uid))
        if (gone.length)
          await this.index.removeUids(
            this.accountId,
            box.id,
            gone.map((m) => m.uid),
          )
        const stale = items.filter((m) => m.uidValidity !== selected.uidValidity)
        if (stale.length)
          await this.index.removeMessages(
            this.accountId,
            stale.map((m) => m.id),
          )
      })
    }
    return this.index.messages(
      this.accountId,
      rows.map((r) => r.id),
    )
  }
  async conversationMetadata(account: Account, threadIds: string[]): Promise<Message[]> {
    const rows = await this.index.threadMessages(this.accountId, threadIds)
    return (await this.current(rows)).map((m) => toMessage(account.id, m))
  }
  async messages(account: Account, ids: string[], bodies = false): Promise<Message[]> {
    const rows = await this.current(await this.index.messages(this.accountId, [...new Set(ids)]))
    if (!bodies) return rows.map((m) => toMessage(account.id, m))
    return this.withBodies(account, rows)
  }
  async conversation(account: Account, threadId: string): Promise<Message[]> {
    const rows = await this.index.threadMessages(this.accountId, [threadId])
    if (!rows.length)
      throw new ProviderError('notFound', 'This conversation is no longer available.')
    const messages = await this.withBodies(account, rows, true)
    if (!messages.length)
      throw new ProviderError('notFound', 'This conversation is no longer available.')
    return messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  }
  private async withBodies(
    account: Account,
    rows: IndexedMessage[],
    deduplicate = false,
  ): Promise<Message[]> {
    const boxes = await this.index.listMailboxes(this.accountId)
    const result: Message[] = []
    const displayed = new Set<string>()
    for (const [mailboxId, items] of byMailbox(rows)) {
      const box = boxes.find((b) => b.id === mailboxId)
      if (!box) continue
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        for (const row of items) {
          if (row.uidValidity !== selected.uidValidity) continue
          // Gmail labels expose the same email at several UIDs. Keep every location for
          // mutations, but read its body once. A missing/stale location allows another to load.
          if (deduplicate && row.emailId && displayed.has(row.emailId)) continue
          const body = await this.body(port, row)
          if (!body) {
            await this.index.removeMessages(this.accountId, [row.id])
            continue
          }
          const preview = row.preview || previewText(body.text || body.html, !body.text)
          if (preview && !row.preview) await this.index.setPreview(this.accountId, row.id, preview)
          result.push({
            ...toMessage(account.id, { ...row, preview }),
            html: body.html,
            text: body.text,
            attachments: attachmentsOf(row),
          })
          if (row.emailId) displayed.add(row.emailId)
        }
      })
    }
    return result
  }
  private async body(port: ImapPort, row: IndexedMessage) {
    const cached = this.bodies.get(row.id)
    if (cached) return cached
    let body: { html: string; text: string } | undefined
    if (row.size <= bodyLimit) {
      const source = await port.source(row.uid, bodyLimit)
      if (!source) return undefined
      const parsed = await parseMime(source, { maxBytes: bodyLimit })
      body = { html: parsed.html, text: parsed.text }
    } else {
      // Large messages: fetch only the readable parts, never the attachments.
      const { html, text } = textParts(row.bodyStructure)
      const read = async (part?: typeof html) =>
        part
          ? new TextDecoder().decode(
              await port.download(row.uid, partSection(part), partLimit, true),
            )
          : ''
      body = { html: await read(html), text: await read(text) }
    }
    this.bodies.set(row.id, body)
    if (this.bodies.size > 40) this.bodies.delete(this.bodies.keys().next().value!)
    return body
  }
  async identities(account: Account): Promise<Identity[]> {
    return this.senders(account)
  }
  /** The account's own address first, then the aliases the user added in Inlark. */
  private senders(account: Account): Identity[] {
    return [
      {
        id: 'default',
        accountId: account.id,
        name: account.senderName || '',
        email: this.options.config.email,
        mayDelete: false,
      },
      ...(account.aliases || []).map((alias) => ({
        id: alias.id,
        accountId: account.id,
        name: alias.name || account.senderName || '',
        email: alias.email,
        mayDelete: true,
      })),
    ]
  }
  /** Never falls back to another address: the user chose who the message is from. */
  private sender(account: Account, identityId: string): Identity {
    const identity = this.senders(account).find((i) => i.id === identityId)
    if (!identity)
      throw new ProviderError(
        'identity',
        'The address this message is from was removed from the account. Choose another From address.',
      )
    return identity
  }
  getStateToken() {
    return undefined
  }
  async download(_account: Account, attachment: Attachment): Promise<Uint8Array> {
    const blob = parseBlobId(attachment.blobId)
    const [row] = blob ? await this.index.messages(this.accountId, [blob.messageId]) : []
    if (!blob || !row)
      throw new ProviderError('notFound', 'This attachment is no longer available.')
    const box = (await this.index.listMailboxes(this.accountId)).find((b) => b.id === row.mailboxId)
    if (!box) throw new ProviderError('notFound', 'This attachment is no longer available.')
    return this.run(async (port) => {
      const selected = await port.select(box.path)
      if (selected.uidValidity !== row.uidValidity)
        throw new ProviderError(
          'notFound',
          'This message changed on the server. Reopen it and try again.',
        )
      return port.download(row.uid, blob.part, 100_000_000)
    })
  }
  async upload(): Promise<string> {
    throw new ProviderError('unsupported', 'IMAP attachments are read from local files.')
  }

  // Organizing

  async update(
    _account: Account,
    changes: MessageChanges,
    destroy: string[] = [],
  ): Promise<{ updated: string[]; failures: string[] }> {
    const updated: string[] = []
    const failures: string[] = []
    const rows = new Map(
      (await this.index.messages(this.accountId, [...Object.keys(changes), ...destroy])).map(
        (m) => [m.id, m],
      ),
    )
    const boxes = new Map((await this.index.listMailboxes(this.accountId)).map((b) => [b.id, b]))
    for (const id of [...Object.keys(changes), ...destroy])
      if (!rows.has(id)) failures.push(id + ': no longer exists')
    const moves = Object.entries(changes).filter(
      ([id, c]) => rows.has(id) && c.mailboxes && Object.keys(c.mailboxes).length,
    )
    if (moves.length && this.limits.move) throw new ProviderError('unsupported', this.limits.move)
    if (destroy.length && this.limits.destroy)
      throw new ProviderError('unsupported', this.limits.destroy)

    // Flags first: a move changes the UID the flags would have to be set on.
    const flagged = Object.entries(changes).filter(
      ([id, c]) => rows.has(id) && c.keywords && Object.keys(c.keywords).length,
    )
    for (const [mailboxId, items] of byMailbox(
      flagged.map(([id, c]) => ({ ...rows.get(id)!, change: c.keywords! })),
    )) {
      const box = boxes.get(mailboxId)
      if (!box) continue
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        const valid = items.filter((m) => m.uidValidity === selected.uidValidity)
        for (const m of items.filter((m) => !valid.includes(m)))
          failures.push(m.id + ': changed on the server')
        // Each message's first store is conditional on the modseq just read, when supported.
        const operations = new Map<string, { uids: number[]; modseq?: string }>()
        for (const m of valid)
          Object.entries(m.change).forEach(([keyword, add], i) => {
            const modseq = i === 0 && port.condstore ? m.modseq : undefined
            const key = JSON.stringify([add, flagFromKeyword(keyword), modseq])
            operations.set(key, { uids: [...(operations.get(key)?.uids || []), m.uid], modseq })
          })
        for (const [key, operation] of operations) {
          const [add, flag] = JSON.parse(key) as [boolean, string]
          await port.store(operation.uids, add ? 'add' : 'remove', [flag], operation.modseq)
        }
        const after = valid.length
          ? await port.fetch(uidSet(valid.map((m) => m.uid)), { flags: true })
          : []
        await this.index.updateFlags(
          this.accountId,
          box.id,
          after.map((m) => ({ uid: m.uid, flags: m.flags || [], modseq: m.modseq })),
        )
        for (const m of valid) {
          const flags = after.find((a) => a.uid === m.uid)?.flags?.map((f) => f.toLowerCase())
          const applied =
            flags &&
            Object.entries(m.change).every(
              ([keyword, add]) => flags.includes(flagFromKeyword(keyword).toLowerCase()) === add,
            )
          if (applied) updated.push(m.id)
          else failures.push(m.id + (flags ? ': changed on the server' : ': no longer exists'))
        }
      })
    }

    const groups = new Map<
      string,
      { source: IndexedMailbox; target: IndexedMailbox; items: IndexedMessage[] }
    >()
    for (const [id, change] of moves) {
      const row = rows.get(id)!
      const target = Object.entries(change.mailboxes!).find(([, add]) => add)?.[0]
      const leaves = change.mailboxes![row.mailboxId] === false
      const source = boxes.get(row.mailboxId)
      const destination = target && boxes.get(target)
      if (!leaves || !source || !destination) {
        failures.push(id + ': a message can only be in one folder')
        continue
      }
      const key = source.id + '→' + destination.id
      groups.set(key, {
        source,
        target: destination,
        items: [...(groups.get(key)?.items || []), row],
      })
    }
    for (const { source, target, items } of groups.values())
      await this.run(async (port) => {
        const selected = await port.select(source.path)
        const valid = items.filter((m) => m.uidValidity === selected.uidValidity)
        for (const m of items.filter((m) => !valid.includes(m)))
          failures.push(m.id + ': changed on the server')
        if (!valid.length) return
        const uids = valid.map((m) => m.uid)
        const result = port.capabilities.has('MOVE')
          ? await port.move(uids, target.path)
          : await port.copy(uids, target.path)
        if (result && !port.capabilities.has('MOVE') && !(await port.expunge(uids))) {
          failures.push(
            ...valid.map((m) => m.id + ': copied, but the original could not be removed'),
          )
          return
        }
        if (!result) {
          failures.push(...valid.map((m) => m.id + ': the server refused the move'))
          return
        }
        const unmapped: IndexedMessage[] = []
        for (const m of valid) {
          const uid = result.uidMap?.get(m.uid)
          // Keep the message's ID across the confirmed move, so undo and selection still work.
          if (uid && result.uidValidity)
            await this.index.relocate(this.accountId, m.id, {
              mailboxId: target.id,
              uidValidity: result.uidValidity,
              uid,
            })
          else unmapped.push(m)
          updated.push(m.id)
        }
        if (unmapped.length) await this.relocateBySearch(port, target, unmapped)
      })
    this.searches.clear()

    for (const [mailboxId, items] of byMailbox(
      destroy.filter((id) => rows.has(id)).map((id) => rows.get(id)!),
    )) {
      const box = boxes.get(mailboxId)
      if (!box) continue
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        const valid = items.filter((m) => m.uidValidity === selected.uidValidity)
        for (const m of items.filter((m) => !valid.includes(m)))
          failures.push(m.id + ': changed on the server')
        if (!valid.length) return
        // UID EXPUNGE removes exactly these messages, never another client's pending deletions.
        if (await port.expunge(valid.map((m) => m.uid))) {
          await this.index.removeMessages(
            this.accountId,
            valid.map((m) => m.id),
          )
          updated.push(...valid.map((m) => m.id))
        } else failures.push(...valid.map((m) => m.id + ': the server refused the deletion'))
      })
    }
    if (moves.length || destroy.length) this.requestSync('all')
    return { updated, failures }
  }
  /**
   * UIDs in the selected folder whose Message-ID matches. Server search indexes can lag behind
   * a fresh APPEND, so the newest messages' envelopes are compared as well.
   */
  private async withMessageId(
    port: ImapPort,
    messageId: string,
    uidNext: number,
  ): Promise<number[]> {
    const found = new Set(await port.search({ header: { 'message-id': '<' + messageId + '>' } }))
    const recent = await port.fetch(Math.max(1, uidNext - 200) + ':*', { envelope: true })
    for (const m of recent) if (messageIds(m.envelope?.messageId)[0] === messageId) found.add(m.uid)
    return [...found].sort((a, b) => a - b)
  }
  /** Without COPYUID, finds moved messages by Message-ID in the destination to keep their IDs. */
  private async relocateBySearch(port: ImapPort, target: IndexedMailbox, items: IndexedMessage[]) {
    const selected = await port.select(target.path)
    const lost: string[] = []
    for (const m of items) {
      const uids = m.messageId ? await this.withMessageId(port, m.messageId, selected.uidNext) : []
      const known = new Set(
        (await this.index.messagesAt(this.accountId, target.id, uids)).map((k) => k.uid),
      )
      const candidates = uids.filter((uid) => !known.has(uid))
      if (candidates.length === 1)
        await this.index.relocate(this.accountId, m.id, {
          mailboxId: target.id,
          uidValidity: selected.uidValidity,
          uid: candidates[0],
        })
      else lost.push(m.id)
    }
    // The next sync indexes them again under new IDs.
    if (lost.length) await this.index.removeMessages(this.accountId, lost)
  }

  async rawMessage(_account: Account, messageId: string, maxBytes: number): Promise<Uint8Array> {
    const rows = await this.index.messages(this.accountId, [messageId])
    const boxes = await this.index.listMailboxes(this.accountId)
    for (const row of rows) {
      const box = boxes.find((b) => b.id === row.mailboxId)
      if (!box || row.size > maxBytes) continue
      const raw = await this.run(async (port) => {
        const selected = await port.select(box.path)
        if (selected.uidValidity !== row.uidValidity) return
        return port.source(row.uid, Math.min(maxBytes, 64 * 1024 * 1024))
      })
      if (raw) return raw
    }
    throw new ProviderError(
      'rawMessage',
      'The original message is unavailable or too large to open securely.',
    )
  }

  async encryptionHints(account: Account, email: string) {
    const page = await this.query(account, { view: 'all', from: email }, 0, 20)
    const rows = (
      await this.index.threadMessages(
        this.accountId,
        page.items.map((m) => m.id),
      )
    )
      .filter(
        (row) => row.from.length === 1 && row.from[0].email.toLowerCase() === email.toLowerCase(),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 40)
    const boxes = await this.index.listMailboxes(this.accountId)
    const hints: { message: Message; headers: Uint8Array }[] = []
    for (const [mailboxId, items] of byMailbox(rows)) {
      const box = boxes.find((b) => b.id === mailboxId)
      if (!box) continue
      await this.run(async (port) => {
        const selected = await port.select(box.path)
        const valid = items.filter((row) => row.uidValidity === selected.uidValidity)
        if (!valid.length) return
        const fetched = await port.fetch(uidSet(valid.map((row) => row.uid)), {
          headers: ['autocrypt'],
        })
        for (const row of valid) {
          const headers =
            fetched.find((m) => m.uid === row.uid)?.headers || 'Content-Type: text/plain'
          if (Buffer.byteLength(headers) <= 20 * 1024)
            hints.push({
              message: toMessage(account.id, row),
              headers: Buffer.from(headers.trimEnd() + '\r\n\r\n'),
            })
        }
      })
    }
    return hints
  }

  // Drafts and sending

  private async compose(account: Account, draft: Draft, messageId: string, keepBcc: boolean) {
    const sender = this.sender(account, draft.identityId)
    return composeMime({
      from: { name: sender.name, email: sender.email },
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      html: draft.html,
      text: draft.text,
      messageId,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      date: new Date(),
      attachments: await Promise.all(
        draft.attachments.map(async (a) => ({
          name: a.name,
          type: a.type,
          cid: a.cid,
          content: await this.options.readAttachment(a.id),
        })),
      ),
      keepBcc,
    })
  }
  /** On the sender's own domain, so a message from an alias doesn't name the account's. */
  private messageId(email: string) {
    const domain = email
      .split('@')[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9.-]/g, '')
    return randomUUID() + '@' + (domain || 'inlark.invalid')
  }
  async createDraft(
    account: Account,
    draft: Draft,
    messageId?: string,
    precomposed?: Uint8Array,
  ): Promise<string> {
    const drafts = await this.roleBox('drafts')
    if (!drafts)
      throw new ProviderError(
        'drafts',
        'Choose a Drafts folder in Settings → Accounts → Folders to save drafts on the server.',
      )
    // Every saved revision gets its own Message-ID so it can be found unambiguously.
    const id = messageId || this.messageId(this.sender(account, draft.identityId).email)
    const mime = precomposed ?? (await this.compose(account, draft, id, true))
    return this.run(async (port) => {
      // APPEND flags are checked against the selected folder's permanent flags.
      const selected = await port.select(drafts.path)
      const appended = await port.append(drafts.path, mime, ['\\Draft', '\\Seen'], new Date())
      let uid = appended.uid
      if (!uid) {
        const found = await this.withMessageId(port, id, (await port.select(drafts.path)).uidNext)
        if (found.length !== 1)
          throw new ProviderError('draft', 'The server did not confirm the saved draft.')
        uid = found[0]
      }
      const [fetched] = await port.fetch(String(uid), metadataQuery)
      if (!fetched) throw new ProviderError('draft', 'The server did not confirm the saved draft.')
      const [saved] = await this.index.upsertMessages(this.accountId, [
        toNewMessage(fetched, {
          mailboxId: drafts.id,
          uidValidity: appended.uidValidity || selected.uidValidity,
        }),
      ])
      return saved
    })
  }
  async prepareSubmission(
    account: Account,
    draft: Draft,
    messageId: string,
    precomposed?: Uint8Array,
  ): Promise<OutgoingMessage> {
    const recipients = [...new Set([...draft.to, ...draft.cc, ...draft.bcc].map((a) => a.email))]
    // Bcc recipients are only in the envelope, never in the transmitted headers.
    const mime = precomposed ?? (await this.compose(account, draft, messageId, false))
    // Bounces go to the address the message is from, as recipients would expect.
    const from = this.sender(account, draft.identityId).email
    return { messageId, mime, envelope: { from, to: recipients } }
  }
  async submit(_account: Account, message: OutgoingMessage): Promise<SubmissionOutcome> {
    if (!message.mime) throw new ProviderError('submission', 'The message was not prepared.')
    return (this.options.smtp?.submit || submitSmtp)(
      this.smtpSettings(),
      message.envelope,
      message.mime,
    )
  }
  /** SMTP gives no later proof of submission; only the recorded acceptance counts. */
  async submissionExists(): Promise<boolean> {
    return false
  }
  async fileSentCopy(_account: Account, message: OutgoingMessage): Promise<'filed' | 'server'> {
    const sent = await this.roleBox('sent')
    if (!sent)
      throw new ProviderError(
        'filing',
        'Choose a Sent folder in Settings → Accounts → Folders to keep a copy.',
      )
    if (!message.mime)
      throw new ProviderError('filing', 'The sent message is no longer available locally.')
    const filed = async (port: ImapPort) =>
      (await this.withMessageId(port, message.messageId, (await port.select(sent.path)).uidNext))
        .length > 0
    const result = await this.run(async (port) =>
      (await filed(port)) ? ('server' as const) : undefined,
    )
    if (result) return result
    // Some servers file their own copy shortly after accepting the message.
    await sleep(this.timing.sentCopyGraceMs)
    return this.run(async (port) => {
      if (await filed(port)) return 'server' as const
      try {
        await port.append(sent.path, message.mime!, ['\\Seen'], new Date())
      } catch (error) {
        if (isProviderError(error, 'network'))
          throw new ProviderError(
            'filingUncertain',
            'The connection dropped while saving the Sent copy. It will be checked before trying again.',
          )
        throw new ProviderError('filing', 'The server did not accept the Sent copy.')
      }
      this.requestSync('all')
      return 'filed' as const
    })
  }

  subscribe(listener: (event: ProviderEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  dispose() {
    this.disposed = true
    this.wakeLoop?.()
    for (const task of this.queue.splice(0))
      task.reject(new ProviderError('offline', 'Account disconnected.'))
    for (const port of [this.command, this.idle]) void port?.close().catch(() => {})
    this.command = this.idle = undefined
    this.listeners.clear()
  }
  async close() {
    this.dispose()
    // Let a running command finish before the index closes underneath it.
    for (let i = 0; this.pumping && i < 100; i++) await sleep(20)
    await this.index.close()
  }
}

/**
 * Where a new top-level folder goes. Servers that keep every folder below INBOX (`INBOX.Sent`)
 * get the new one there too, with the server's own delimiter.
 */
export function newFolderPath(boxes: { path: string; delimiter: string }[], name: string): string {
  const delimiter = boxes.find((b) => b.delimiter)?.delimiter || '/'
  const others = boxes.filter((b) => !isInbox(b.path))
  const underInbox =
    others.length > 0 && others.every((b) => b.path.toUpperCase().startsWith('INBOX' + delimiter))
  return underInbox && !name.toUpperCase().startsWith('INBOX' + delimiter)
    ? 'INBOX' + delimiter + name
    : name
}
export function limitsFor(capabilities: ReadonlySet<string>): AccountLimits {
  const limits: AccountLimits = {}
  if (!capabilities.has('MOVE') && !capabilities.has('UIDPLUS'))
    limits.move =
      'This server supports neither MOVE nor UIDPLUS, so moving mail could also erase messages another app marked for deletion. Moving, archiving and deleting are off for this account.'
  if (!capabilities.has('UIDPLUS'))
    limits.destroy =
      'This server lacks UIDPLUS, so permanent deletion could also erase messages another app marked for deletion. Move messages to Trash instead.'
  return limits
}
