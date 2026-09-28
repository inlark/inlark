import {
  accountKey,
  accountColors,
  conversationFromMessages,
  draftFingerprint,
  parseUnsubscribe,
  ProviderError,
  type Account,
  type Address,
  type Mailbox,
  type Identity,
  type Message,
  type MailQuery,
  type ProviderPage,
  type ProviderCapabilities,
  type ProviderEvent,
  type MailProvider,
  type Draft,
  type Attachment,
  type MessageChanges,
  type OutgoingMessage,
  type SubmissionOutcome,
} from '@inlark/core'

export { draftFingerprint, parseUnsubscribe }

const CORE = 'urn:ietf:params:jmap:core'
const MAIL = 'urn:ietf:params:jmap:mail'
const SUBMISSION = 'urn:ietf:params:jmap:submission'
type Json = Record<string, any>
type Call = [string, Json, string]
type Session = {
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl?: string
  username: string
  accounts: Record<string, Json>
  capabilities: Record<string, Json>
  primaryAccounts: Record<string, string>
  state: string
}
export class JmapError extends ProviderError {
  constructor(code: string, message: string, retryAfter?: number) {
    super(code, message, retryAfter)
    this.name = 'JmapError'
  }
}
const pointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1')
/** Translates provider-neutral changes into JMAP patch paths. */
export function jmapPatch(change: MessageChanges[string]): Json {
  const patch: Json = {}
  for (const [field, values] of [
    ['mailboxIds', change.mailboxes],
    ['keywords', change.keywords],
  ] as const)
    for (const [key, value] of Object.entries(values || {}))
      patch[field + '/' + pointer(key)] = value || null
  return patch
}
export interface JmapOptions {
  serverUrl: string
  authorization: string
  connectionId: string
  name: string
  fetch?: typeof fetch
  timeoutMs?: number
}
const summaryProperties = [
  'id',
  'threadId',
  'mailboxIds',
  'keywords',
  'size',
  'receivedAt',
  'sentAt',
  'from',
  'to',
  'cc',
  'bcc',
  'replyTo',
  'subject',
  'preview',
  'hasAttachment',
  'messageId',
  'inReplyTo',
  'references',
]
function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += Math.max(1, size))
    result.push(items.slice(i, i + Math.max(1, size)))
  return result
}
export function jmapFilter(query: MailQuery, mailboxes: Mailbox[]): Json {
  const role = (name: string) => mailboxes.find((m) => m.role === name)?.id
  const filters: Json[] = []
  if (query.mailboxId) filters.push({ inMailbox: query.mailboxId })
  else if (['inbox', 'archive', 'sent', 'drafts', 'junk', 'trash'].includes(query.view)) {
    const mailbox = role(query.view)
    // A nonexistent role must yield no messages, never the entire account.
    filters.push({ inMailbox: mailbox || '__inlark_missing_mailbox__' })
  } else {
    const excluded = ['junk', 'trash'].map(role).filter(Boolean)
    if (excluded.length) filters.push({ inMailboxOtherThan: excluded })
  }
  if (query.unread) filters.push({ notKeyword: '$seen' })
  if (query.view === 'starred') filters.push({ hasKeyword: '$flagged' })
  for (const key of ['text', 'from', 'to', 'subject', 'after', 'before'] as const)
    if (query[key]) filters.push({ [key]: query[key] })
  if (query.hasAttachment) filters.push({ hasAttachment: true })
  return filters.length === 0
    ? {}
    : filters.length === 1
      ? filters[0]
      : { operator: 'AND', conditions: filters }
}
function structuredBodyParts(part: Json | undefined, type: string): Json[] {
  if (!part || part.disposition?.toLowerCase() === 'attachment') return []
  return [
    ...(part.type?.toLowerCase() === type ? [part] : []),
    ...(part.subParts || []).flatMap((child: Json) => structuredBodyParts(child, type)),
  ]
}
function bodyParts(raw: Json, type: 'text/plain' | 'text/html'): Json[] {
  return type === 'text/html' ? raw.htmlBody || [] : raw.textBody || []
}
function bodyValue(raw: Json, type: 'text/plain' | 'text/html'): string {
  const value = (parts: Json[]) =>
    parts
      .map((part) => raw.bodyValues?.[part.partId]?.value || '')
      .filter((content) => content.trim())
      .join('\n')
  return value(bodyParts(raw, type)) || value(structuredBodyParts(raw.bodyStructure, type))
}
function addressList(value?: Json[] | null): Address[] {
  return (value || []).map((address) => ({ name: address.name || '', email: address.email }))
}
function asMessage(account: Account, raw: Json, bodies: boolean): Message {
  const result: Message = {
    id: raw.id,
    accountId: account.id,
    threadId: raw.threadId,
    subject: raw.subject || '',
    from: addressList(raw.from),
    to: addressList(raw.to),
    cc: addressList(raw.cc),
    bcc: addressList(raw.bcc),
    replyTo: addressList(raw.replyTo),
    receivedAt: raw.receivedAt,
    sentAt: raw.sentAt,
    preview: raw.preview || '',
    keywords: raw.keywords || {},
    mailboxIds: raw.mailboxIds || {},
    size: raw.size || 0,
    hasAttachment: !!raw.hasAttachment,
    messageId: raw.messageId || [],
    inReplyTo: raw.inReplyTo || [],
    references: raw.references || [],
  }
  if (bodies) {
    result.html = bodyValue(raw, 'text/html')
    result.text = bodyValue(raw, 'text/plain')
    const attachments = new Map<string, Attachment>()
    const visit = (part: Json) => {
      if (part.blobId && (part.disposition === 'attachment' || part.cid || part.name))
        attachments.set(part.blobId, {
          blobId: part.blobId,
          name: part.name || 'attachment',
          type: part.type || 'application/octet-stream',
          size: part.size || 0,
          ...(part.cid ? { cid: part.cid } : {}),
          ...(part.disposition ? { disposition: part.disposition } : {}),
        })
      for (const child of part.subParts || []) visit(child)
    }
    if (raw.bodyStructure) visit(raw.bodyStructure)
    for (const part of raw.attachments || []) visit(part)
    result.attachments = [...attachments.values()]
    result.unsubscribe = parseUnsubscribe(
      raw['header:List-Unsubscribe:asText'],
      raw['header:List-Unsubscribe-Post:asText'],
    )
  }
  return result
}
export class JmapProvider implements MailProvider {
  capabilities: ProviderCapabilities = {
    mail: false,
    submission: false,
    push: false,
    maxObjectsInGet: 100,
    maxObjectsInSet: 100,
    maxUploadSize: 50_000_000,
    blobUpload: true,
    sentCopy: 'server',
  }
  private session?: Session
  private emailState = new Map<string, string>()
  private mailboxCache = new Map<string, Mailbox[]>()
  private listeners = new Set<(event: ProviderEvent) => void>()
  private controller?: AbortController
  private disposed = false
  private cooldownUntil = 0
  private requestFetch: typeof fetch
  constructor(private options: JmapOptions) {
    this.requestFetch = options.fetch || fetch
  }
  private emit(event: ProviderEvent) {
    for (const listener of this.listeners) listener(event)
  }
  private endpoint(value: string): string {
    const url = new URL(value, this.options.serverUrl)
    const origin = new URL(this.options.serverUrl)
    if (url.origin !== origin.origin || url.username || url.password)
      throw new JmapError(
        'endpoint',
        'The server advertised an endpoint on another origin. Cross-origin authentication is not enabled.',
      )
    return url.toString()
  }
  private async request(url: string, init: RequestInit = {}, redirects = 0): Promise<Response> {
    if (Date.now() < this.cooldownUntil)
      throw new JmapError(
        'rateLimit',
        'The server requested a pause. Please try again shortly.',
        Math.ceil((this.cooldownUntil - Date.now()) / 1000),
      )
    let response: Response
    try {
      response = await this.requestFetch(this.endpoint(url), {
        ...init,
        redirect: 'manual',
        headers: { ...init.headers, Authorization: this.options.authorization },
        signal: init.signal || AbortSignal.timeout(this.options.timeoutMs || 20_000),
      })
    } catch (error) {
      if (this.disposed) throw new JmapError('offline', 'Account disconnected.')
      throw new JmapError(
        'network',
        'The mail server could not be reached. Check your connection and server URL.',
      )
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (
        (init.method && init.method !== 'GET') ||
        redirects >= 4 ||
        !response.headers.get('location')
      )
        throw new JmapError(
          'redirect',
          'The server redirected an operation. Reconnect with its canonical URL.',
        )
      const target = this.endpoint(new URL(response.headers.get('location')!, url).toString())
      return this.request(target, init, redirects + 1)
    }
    if (response.status === 401 || response.status === 403)
      throw new JmapError(
        'authentication',
        'Sign in again. The server rejected these credentials or permissions.',
      )
    if (response.status === 429) {
      const header = response.headers.get('retry-after') || '30'
      const delay = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000
      const seconds = Number.isFinite(delay) ? Math.max(1, Math.min(3600, delay)) : 30
      this.cooldownUntil = Date.now() + seconds * 1000
      throw new JmapError('rateLimit', 'The server is busy. Please try again shortly.', seconds)
    }
    if (!response.ok)
      throw new JmapError('http', 'The mail server returned HTTP ' + response.status + '.')
    return response
  }
  async connect(): Promise<Account[]> {
    this.disposed = false
    const base = new URL(this.options.serverUrl)
    const url =
      base.pathname === '/' || !base.pathname
        ? new URL('/.well-known/jmap', base).toString()
        : base.toString()
    let response = await this.request(url)
    this.session = (await response.json()) as Session
    if (!this.session.apiUrl || !this.session.accounts || !this.session.capabilities?.[MAIL])
      throw new JmapError('capability', 'This endpoint does not provide JMAP Mail.')
    this.endpoint(this.session.apiUrl)
    this.endpoint(this.session.uploadUrl)
    this.endpoint(this.session.downloadUrl)
    const core = this.session.capabilities[CORE] || {}
    this.capabilities = {
      mail: true,
      submission: !!this.session.capabilities[SUBMISSION],
      push: !!this.session.eventSourceUrl,
      maxObjectsInGet: core.maxObjectsInGet || 100,
      maxObjectsInSet: core.maxObjectsInSet || 100,
      maxUploadSize: core.maxSizeUpload || 50_000_000,
      blobUpload: true,
      sentCopy: 'server',
    }
    return Object.entries(this.session.accounts)
      .filter(([, a]) => a.accountCapabilities?.[MAIL])
      .map(([remoteId, a], index) => ({
        id: accountKey(this.options.connectionId, remoteId),
        connectionId: this.options.connectionId,
        remoteId,
        name: this.options.name || a.name || this.session!.username,
        email: this.session!.username,
        color: accountColors[1 + (index % (accountColors.length - 1))],
        status: 'connected',
        protocol: 'jmap',
      }))
  }
  async call(calls: Call[], submission = false): Promise<Json[]> {
    if (!this.session) throw new JmapError('session', 'Reconnect this account first.')
    const response = await this.request(this.session.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: submission ? [CORE, MAIL, SUBMISSION] : [CORE, MAIL],
        methodCalls: calls,
      }),
    })
    const body = (await response.json()) as Json
    if (!Array.isArray(body.methodResponses))
      throw new JmapError('response', 'The server returned an invalid JMAP response.')
    for (const [method, result] of body.methodResponses as Call[])
      if (method === 'Email/set' && result.newState && result.accountId) {
        this.emailState.set(
          accountKey(this.options.connectionId, result.accountId),
          result.newState,
        )
      }
    return calls.map(([name, , tag]) => {
      const match = (body.methodResponses as Call[]).find(
        (r) => r[2] === tag && (r[0] === name || r[0] === 'error'),
      )
      if (!match)
        throw new JmapError('response', 'The server did not return the requested operation.')
      if (match[0] === 'error' && match[1].type === 'stateMismatch')
        throw new JmapError(
          'stateMismatch',
          'Mail changed on the server. Refresh and try the action again.',
        )
      if (match[0] === 'error')
        throw new JmapError(match[1].type, name + ' failed (' + (match[1].type || 'unknown') + ').')
      return match[1]
    })
  }
  async mailboxes(account: Account): Promise<Mailbox[]> {
    const [result] = await this.call([['Mailbox/get', { accountId: account.remoteId }, 'm']])
    const boxes = result.list.map((m: Json): Mailbox => ({
      id: m.id,
      accountId: account.id,
      name: m.name,
      role: m.role,
      parentId: m.parentId,
      totalEmails: m.totalEmails,
      unreadEmails: m.unreadEmails,
      rights: m.myRights,
    }))
    this.mailboxCache.set(account.id, boxes)
    return boxes
  }
  async identities(account: Account): Promise<Identity[]> {
    if (
      !this.capabilities.submission ||
      !this.session?.accounts[account.remoteId]?.accountCapabilities?.[SUBMISSION]
    )
      return []
    const [result] = await this.call([['Identity/get', { accountId: account.remoteId }, 'i']], true)
    // The name the user chose in Inlark wins over the one configured on the server.
    return result.list.map((i: Json) => ({
      ...i,
      name: account.senderName || i.name,
      accountId: account.id,
    }))
  }
  async messages(account: Account, ids: string[], bodies = false): Promise<Message[]> {
    const result: Message[] = []
    for (const batch of batches([...new Set(ids)], this.capabilities.maxObjectsInGet)) {
      if (!batch.length) continue
      const [data] = await this.call([
        [
          'Email/get',
          {
            accountId: account.remoteId,
            ids: batch,
            properties: bodies
              ? [
                  ...summaryProperties,
                  'bodyStructure',
                  'bodyValues',
                  'textBody',
                  'htmlBody',
                  'attachments',
                  'header:List-Unsubscribe:asText',
                  'header:List-Unsubscribe-Post:asText',
                ]
              : summaryProperties,
            ...(bodies
              ? {
                  fetchAllBodyValues: true,
                  maxBodyValueBytes: 5_000_000,
                  bodyProperties: [
                    'partId',
                    'blobId',
                    'size',
                    'name',
                    'type',
                    'charset',
                    'disposition',
                    'cid',
                    'subParts',
                  ],
                }
              : {}),
          },
          'e',
        ],
      ])
      if (data.state) this.emailState.set(account.id, data.state)
      for (const raw of data.list) {
        const message = asMessage(account, raw, bodies)
        if (bodies) {
          for (const [type, field] of [
            ['text/html', 'html'],
            ['text/plain', 'text'],
          ] as const) {
            if (message[field]?.trim()) continue
            const part = [
              ...bodyParts(raw, type),
              ...structuredBodyParts(raw.bodyStructure, type),
            ].find((part) => part.blobId && (!part.size || part.size <= 5_000_000))
            if (!part) continue
            try {
              const bytes = await this.download(account, {
                blobId: part.blobId,
                name: 'body',
                type,
                size: part.size || 0,
              })
              message[field] = new TextDecoder(part.charset || 'utf-8').decode(bytes)
            } catch {
              // Keep the other body representation or the message preview available.
            }
          }
        }
        result.push(message)
      }
    }
    return result
  }
  async query(account: Account, query: MailQuery, position = 0, limit = 50): Promise<ProviderPage> {
    const boxes = this.mailboxCache.get(account.id) || (await this.mailboxes(account))
    if (query.mailboxId && !boxes.some((b) => b.id === query.mailboxId))
      return { items: [], total: 0 }
    if (
      !query.mailboxId &&
      ['inbox', 'archive', 'sent', 'drafts', 'junk', 'trash'].includes(query.view) &&
      !boxes.some((b) => b.role === query.view)
    )
      return { items: [], total: 0 }
    const [result] = await this.call([
      [
        'Email/query',
        {
          accountId: account.remoteId,
          filter: jmapFilter(query, boxes),
          sort: [{ property: 'receivedAt', isAscending: false }],
          collapseThreads: true,
          position,
          limit,
          calculateTotal: true,
        },
        'q',
      ],
    ])
    const fetched = new Map((await this.messages(account, result.ids)).map((m) => [m.id, m]))
    const messages: Message[] = result.ids.flatMap((id: string) =>
      fetched.has(id) ? [fetched.get(id)!] : [],
    )
    // Only fetch thread metadata for this page, never all IDs in the mailbox.
    const threads: Json[] = []
    for (const ids of batches(
      [...new Set(messages.map((m) => m.threadId))],
      this.capabilities.maxObjectsInGet,
    )) {
      const [data] = await this.call([['Thread/get', { accountId: account.remoteId, ids }, 't']])
      threads.push(...data.list)
    }
    const otherIds = threads
      .flatMap((t) => t.emailIds)
      .filter((id: string) => !messages.some((m) => m.id === id))
    const threadMessages = [...messages, ...(await this.messages(account, otherIds))]
    const items = messages.map((m) => {
      const c = conversationFromMessages(
        account.id,
        m.threadId,
        threadMessages.filter((item) => item.threadId === m.threadId),
      )
      // Sort and display according to the matching representative, even if the thread has newer messages outside this folder.
      c.receivedAt = m.receivedAt
      c.subject = m.subject || '(No subject)'
      c.preview = m.preview
      c.count = threads.find((t) => t.id === m.threadId)?.emailIds.length || 1
      return c
    })
    return {
      items,
      total: result.total ?? position + result.ids.length,
      next:
        result.ids.length === limit &&
        (result.total === undefined || position + limit < result.total)
          ? position + result.ids.length
          : undefined,
    }
  }
  async conversationMetadata(account: Account, threadIds: string[]): Promise<Message[]> {
    const ids: string[] = []
    for (const batch of batches([...new Set(threadIds)], this.capabilities.maxObjectsInGet)) {
      const [data] = await this.call([
        ['Thread/get', { accountId: account.remoteId, ids: batch }, 't'],
      ])
      ids.push(...data.list.flatMap((t: Json) => t.emailIds))
    }
    return this.messages(account, ids)
  }
  async conversation(account: Account, threadId: string): Promise<Message[]> {
    const [result] = await this.call([
      ['Thread/get', { accountId: account.remoteId, ids: [threadId] }, 't'],
    ])
    if (!result.list.length)
      throw new JmapError('notFound', 'This conversation is no longer available.')
    return (await this.messages(account, result.list[0].emailIds, true)).sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    )
  }
  getStateToken(account: Account) {
    return this.emailState.get(account.id)
  }
  async update(
    account: Account,
    changes: MessageChanges,
    destroy: string[] = [],
    expectedState = this.getStateToken(account),
  ): Promise<{ updated: string[]; failures: string[] }> {
    const updated: string[] = [],
      failures: string[] = []
    const updates = Object.entries(changes)
      .map(([id, change]) => [id, jmapPatch(change)] as const)
      .filter(([, patch]) => Object.keys(patch).length)
    for (const entries of batches(updates, this.capabilities.maxObjectsInSet)) {
      const [result] = await this.call([
        [
          'Email/set',
          {
            accountId: account.remoteId,
            ifInState: expectedState,
            update: Object.fromEntries(entries),
          },
          's',
        ],
      ])
      if (result.newState) {
        this.emailState.set(account.id, result.newState)
        expectedState = result.newState
      }
      updated.push(...Object.keys(result.updated || {}))
      failures.push(
        ...Object.entries(result.notUpdated || {}).map(([id, e]) => id + ': ' + (e as Json).type),
      )
    }
    for (const ids of batches(destroy, this.capabilities.maxObjectsInSet)) {
      const [result] = await this.call([
        ['Email/set', { accountId: account.remoteId, ifInState: expectedState, destroy: ids }, 's'],
      ])
      if (result.newState) {
        this.emailState.set(account.id, result.newState)
        expectedState = result.newState
      }
      updated.push(...(result.destroyed || []))
      failures.push(
        ...Object.entries(result.notDestroyed || {}).map(([id, e]) => id + ': ' + (e as Json).type),
      )
    }
    return { updated, failures }
  }
  async folder(
    account: Account,
    operation: 'create' | 'rename' | 'delete',
    id?: string,
    name?: string,
    parentId?: string,
  ): Promise<void> {
    const boxes = await this.mailboxes(account)
    const box = boxes.find((b) => b.id === id)
    if (operation !== 'create' && (!box || box.role))
      throw new JmapError('permission', 'Special folders cannot be renamed or deleted.')
    if (operation === 'rename' && !box?.rights.mayRename)
      throw new JmapError('permission', 'You cannot rename this folder.')
    if (operation === 'delete' && !box?.rights.mayDelete)
      throw new JmapError('permission', 'You cannot delete this folder.')
    const args =
      operation === 'create'
        ? { create: { new: { name, parentId: parentId || null } } }
        : operation === 'rename'
          ? { update: { [id!]: { name } } }
          : { destroy: [id], onDestroyRemoveEmails: false }
    const [result] = await this.call([
      ['Mailbox/set', { accountId: account.remoteId, ...args }, 'm'],
    ])
    const errors = { ...result.notCreated, ...result.notUpdated, ...result.notDestroyed }
    if (Object.keys(errors).length)
      throw new JmapError(
        'folder',
        'Folder change failed (' +
          Object.values<Json>(errors)[0].type +
          '). The folder may still contain messages.',
      )
    this.mailboxCache.delete(account.id)
  }
  async upload(account: Account, data: Uint8Array, type: string): Promise<string> {
    if (!this.session) throw new JmapError('session', 'Reconnect the account.')
    if (data.byteLength > this.capabilities.maxUploadSize)
      throw new JmapError('tooLarge', 'This attachment exceeds the server upload limit.')
    const url = this.session.uploadUrl.replace('{accountId}', encodeURIComponent(account.remoteId))
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: data as BodyInit,
      signal: AbortSignal.timeout(120_000),
    })
    const result = (await response.json()) as Json
    if (result.accountId !== account.remoteId || !result.blobId)
      throw new JmapError('upload', 'The upload could not be verified.')
    return result.blobId
  }
  async download(account: Account, attachment: Attachment): Promise<Uint8Array> {
    if (!this.session) throw new JmapError('session', 'Reconnect the account.')
    let url = this.session.downloadUrl
    for (const [key, value] of Object.entries({
      accountId: account.remoteId,
      blobId: attachment.blobId,
      type: attachment.type,
      name: attachment.name,
    }))
      url = url.replace('{' + key + '}', encodeURIComponent(value))
    const response = await this.request(url, { signal: AbortSignal.timeout(120_000) })
    const reader = response.body?.getReader()
    if (!reader) throw new JmapError('download', 'Empty attachment response.')
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 100_000_000) {
        await reader.cancel()
        throw new JmapError(
          'tooLarge',
          'Attachments over 100 MB are not supported in this version.',
        )
      }
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
  async createDraft(account: Account, draft: Draft, messageId?: string): Promise<string> {
    const boxes = await this.mailboxes(account)
    const drafts = boxes.find((b) => b.role === 'drafts')
    if (!drafts?.rights.mayAddItems)
      throw new JmapError('drafts', 'A writable Drafts folder is required.')
    const identity = (await this.identities(account)).find((i) => i.id === draft.identityId)
    if (!identity) throw new JmapError('identity', 'Choose a valid sending identity.')
    const [result] = await this.call([
      [
        'Email/set',
        {
          accountId: account.remoteId,
          create: {
            draft: {
              mailboxIds: { [drafts.id]: true },
              keywords: { $draft: true, $seen: true },
              from: [{ name: identity.name, email: identity.email }],
              to: draft.to,
              cc: draft.cc,
              bcc: draft.bcc,
              subject: draft.subject,
              ...(messageId ? { messageId: [messageId] } : {}),
              ...(draft.inReplyTo?.length ? { inReplyTo: draft.inReplyTo } : {}),
              ...(draft.references?.length ? { references: draft.references } : {}),
              textBody: [{ partId: 'text', type: 'text/plain' }],
              htmlBody: [{ partId: 'html', type: 'text/html' }],
              bodyValues: { text: { value: draft.text }, html: { value: draft.html } },
              attachments: draft.attachments.map((a) => ({
                blobId: a.blobId,
                type: a.type,
                name: a.name,
                disposition: a.cid ? 'inline' : 'attachment',
                ...(a.cid ? { cid: a.cid } : {}),
              })),
            },
          },
        },
        'd',
      ],
    ])
    if (!result.created?.draft?.id)
      throw new JmapError(
        'draft',
        'The server could not save the draft (' +
          (result.notCreated?.draft?.type || 'unknown') +
          ').',
      )
    return result.created.draft.id
  }
  async prepareSubmission(
    account: Account,
    draft: Draft,
    messageId: string,
  ): Promise<OutgoingMessage> {
    const emailId = await this.createDraft(account, draft, messageId)
    const identity = (await this.identities(account)).find((i) => i.id === draft.identityId)
    return {
      messageId,
      emailId,
      envelope: {
        from: identity?.email || account.email,
        to: [...draft.to, ...draft.cc, ...draft.bcc].map((a) => a.email),
      },
    }
  }
  async submit(
    account: Account,
    message: OutgoingMessage,
    identityId: string,
  ): Promise<SubmissionOutcome> {
    if (!this.capabilities.submission)
      throw new JmapError('submission', 'This account does not support sending through JMAP.')
    if (!message.emailId) throw new JmapError('submission', 'The message was not prepared.')
    const boxes = await this.mailboxes(account)
    const sent = boxes.find((b) => b.role === 'sent'),
      drafts = boxes.find((b) => b.role === 'drafts')
    if (!sent || !drafts)
      throw new JmapError('mailboxes', 'Sent and Drafts folders are required for sending.')
    const patch: Json = {
      'keywords/$draft': null,
      ['mailboxIds/' + pointer(drafts.id)]: null,
      ['mailboxIds/' + pointer(sent.id)]: true,
    }
    let result: Json
    try {
      ;[result] = await this.call(
        [
          [
            'EmailSubmission/set',
            {
              accountId: account.remoteId,
              create: { send: { emailId: message.emailId, identityId } },
              onSuccessUpdateEmail: { '#send': patch },
            },
            's',
          ],
        ],
        true,
      )
    } catch (error) {
      // A lost response after the request left may still have been processed.
      if (error instanceof JmapError && ['network', 'http', 'response'].includes(error.code))
        throw new JmapError('submissionUncertain', error.message)
      throw error
    }
    if (!result.created?.send?.id)
      throw new JmapError(
        'submissionRejected',
        'The server rejected the message (' + (result.notCreated?.send?.type || 'unknown') + ').',
      )
    return { accepted: message.envelope.to, rejected: [] }
  }
  async submissionExists(account: Account, message: OutgoingMessage): Promise<boolean> {
    const emailId = message.emailId
    if (!emailId) return false
    const [result] = await this.call(
      [
        [
          'EmailSubmission/query',
          { accountId: account.remoteId, filter: { emailIds: [emailId] }, limit: 1 },
          'q',
        ],
      ],
      true,
    )
    if (result.ids?.length) return true
    const [email] = await this.messages(account, [emailId])
    const sent = (await this.mailboxes(account)).find((b) => b.role === 'sent')
    return !!(email && sent && email.mailboxIds[sent.id] && !email.keywords.$draft)
  }
  subscribe(listener: (event: ProviderEvent) => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1 && this.session?.eventSourceUrl) void this.push()
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) this.controller?.abort()
    }
  }
  private async push() {
    let attempt = 0
    while (!this.disposed && this.listeners.size && this.session?.eventSourceUrl) {
      this.controller = new AbortController()
      const timer = setTimeout(() => this.controller?.abort(), 130_000)
      try {
        const url = this.session.eventSourceUrl
          .replace('{types}', 'Email,Mailbox,Thread,EmailSubmission')
          .replace('{closeafter}', 'no')
          .replace('{ping}', '30')
        const response = await this.request(url, {
          headers: { Accept: 'text/event-stream' },
          signal: this.controller.signal,
        })
        if (!response.body) throw new Error('No stream')
        attempt = 0
        const reader = response.body.getReader(),
          decoder = new TextDecoder()
        let buffer = ''
        while (!this.disposed) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          if (buffer.length > 1_000_000) throw new Error('Invalid event stream')
          let boundary: number
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            if (
              event.includes('event: state') ||
              event.includes('"@type":"StateChange"') ||
              event.includes('"changed"')
            )
              this.emit({ type: 'changed' })
          }
        }
      } catch {
        /* Main service polls independently and reports actual account reachability. */
      } finally {
        clearTimeout(timer)
        this.controller?.abort()
      }
      if (!this.disposed && this.listeners.size)
        await new Promise((r) =>
          setTimeout(r, Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6))),
        )
    }
  }
  dispose() {
    this.disposed = true
    this.controller?.abort()
    this.listeners.clear()
    this.mailboxCache.clear()
  }
}
