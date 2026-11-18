import {
  accountKey,
  accountColors,
  conversationFromMessages,
  draftFingerprint,
  isDraft,
  parseUnsubscribe,
  plainTextHtml,
  ProviderError,
  type Account,
  type Address,
  type AuthDetector,
  type Conversation,
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
  type RequestPriority,
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
  /** Finds a list row's code or link in its subject and opening text. */
  detectAuth?: AuthDetector
  /** How soon the requests started now should run when they have to wait for a turn. */
  priority?: () => RequestPriority
}
const priorityRank: Record<RequestPriority, number> = { interactive: 0, normal: 1, background: 2 }
/** The longest a request quietly waits out a pause the server asked for before reporting it. */
const quietPause = 5_000
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** A JMAP result reference: this argument comes from an earlier call in the same request. */
const ref = (resultOf: string, name: string, path: string) => ({ resultOf, name, path })
/** Method errors after which a combined request is repeated as smaller, separate ones. */
const splitCodes = ['requestTooLarge', 'invalidResultReference']
const mustSplit = (error: unknown) => error instanceof JmapError && splitCodes.includes(error.code)
const pgpArmor = /-----BEGIN PGP (?:SIGNED )?MESSAGE-----/
/** Seconds to pause after a 429, from Retry-After or else the RateLimit header's reset. */
function pauseSeconds(headers: Headers): number {
  const value =
    headers.get('retry-after') ?? headers.get('ratelimit')?.match(/(?:^|[;,\s])t=(\d+)/)?.[1]
  const seconds = !value
    ? 30
    : /^\d+$/.test(value)
      ? Number(value)
      : (Date.parse(value) - Date.now()) / 1000
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : 30
}
/** The server limit a 400 response names, such as `maxConcurrentRequests` (RFC 8620 §3.6.1). */
async function requestLimit(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as Json
    return body?.type === 'urn:ietf:params:jmap:error:limit' ? String(body.limit || '') : undefined
  } catch {
    return undefined
  }
}
/** The opening text fetched with each list row for its code or link. */
const excerptBytes = 4096
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
  'bodyStructure',
]
/**
 * What an Email/get fetches: list fields, list fields with each row's opening text for its code
 * or link, or a whole message for reading.
 */
type EmailView = 'summary' | 'excerpt' | 'body'
function emailView(view: EmailView): Json {
  if (view === 'summary') return { properties: summaryProperties }
  if (view === 'excerpt')
    return {
      properties: [...summaryProperties, 'textBody', 'bodyValues'],
      fetchTextBodyValues: true,
      maxBodyValueBytes: excerptBytes,
      bodyProperties: ['partId', 'type'],
    }
  return {
    properties: [
      ...summaryProperties,
      'bodyValues',
      'textBody',
      'htmlBody',
      'attachments',
      // RFC 8621 forbids asText for List-Unsubscribe; keep raw values for parsing.
      'header:List-Unsubscribe',
      'header:List-Unsubscribe-Post',
      'header:Autocrypt:all',
    ],
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
      'header:Content-Transfer-Encoding:asText',
    ],
  }
}
/**
 * Whether reading a message needs its full source: it is or may be signed or encrypted, or it has
 * parts whose content wasn't fetched and could hold armor as plain text. Base64 can't: its
 * alphabet has no dashes or spaces. (Armor in a multipart preamble, outside every part, is no
 * signed or encrypted message format and isn't looked for.)
 */
function needsSource(raw: Json): boolean {
  const values = Object.values<Json>(raw.bodyValues || {})
  if (values.some((value) => value.isTruncated || pgpArmor.test(value.value || ''))) return true
  const fetched = new Set(Object.keys(raw.bodyValues || {}))
  const visit = (part: Json | undefined): boolean => {
    if (!part) return true
    const type = String(part.type || '').toLowerCase()
    if (/^multipart\/(?:encrypted|signed)$/.test(type) || type.startsWith('application/pgp'))
      return true
    if (/\.(?:asc|gpg|pgp|sig)$/i.test(part.name || '')) return true
    if (type.startsWith('multipart/')) return (part.subParts || []).some(visit)
    if (part.partId && fetched.has(part.partId)) return false
    const encoding = String(part['header:Content-Transfer-Encoding:asText'] || '')
    return encoding.trim().toLowerCase() !== 'base64'
  }
  return visit(raw.bodyStructure)
}
/** The headers that reading a plain message uses from its source: Content-Type and Autocrypt. */
function plainSource(raw: Json): Uint8Array {
  const line = (value: string) => value.replace(/[\r\n]+[ \t]*/g, ' ')
  const autocrypt: unknown[] = raw['header:Autocrypt:all'] || []
  const headers = [
    'Content-Type: ' + line(String(raw.bodyStructure?.type || 'text/plain')),
    ...autocrypt
      .filter((value): value is string => typeof value === 'string')
      .map((value) => 'Autocrypt:' + line(value)),
  ]
  return new TextEncoder().encode(headers.join('\r\n') + '\r\n\r\n')
}
/**
 * The changes one server-sent event announces: one per account with its new Email state when the
 * event is a StateChange, else a single change of unknown scope.
 */
export function stateChanges(event: string, connectionId: string): ProviderEvent[] {
  const data = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
  let parsed: Json | undefined
  try {
    parsed = data ? JSON.parse(data) : undefined
  } catch {
    parsed = undefined
  }
  if (parsed?.['@type'] === 'StateChange' && parsed.changed && typeof parsed.changed === 'object')
    return Object.entries<Json>(parsed.changed).map(([remoteId, types]) => ({
      type: 'changed',
      accountId: accountKey(connectionId, remoteId),
      ...(typeof types?.Email === 'string' ? { emailState: types.Email } : {}),
    }))
  return event.includes('event: state') ||
    event.includes('"@type":"StateChange"') ||
    event.includes('"changed"')
    ? [{ type: 'changed' }]
    : []
}
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
  // These are display preferences, not MIME types: htmlBody can include plain-text parts.
  if (type === 'text/html')
    return (raw.htmlBody || []).filter((part: Json) =>
      ['text/html', 'text/plain'].includes(part.type?.toLowerCase()),
    )
  return raw.textBody?.length
    ? raw.textBody
    : (raw.htmlBody || []).filter((part: Json) => part.type?.toLowerCase() === type)
}
function renderBodyPart(part: Json, content: string, type: 'text/plain' | 'text/html'): string {
  return type === 'text/html' && part.type?.toLowerCase() === 'text/plain'
    ? plainTextHtml(content)
    : content
}
function bodyValue(raw: Json, type: 'text/plain' | 'text/html'): string {
  const value = (parts: Json[]) =>
    parts
      .flatMap((part) => {
        const content = raw.bodyValues?.[part.partId]?.value || ''
        return content.trim() ? [renderBodyPart(part, content, type)] : []
      })
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
      raw['header:List-Unsubscribe'],
      raw['header:List-Unsubscribe-Post'],
    )
  }
  if (
    raw.bodyStructure?.type?.toLowerCase() === 'multipart/encrypted' ||
    /-----BEGIN PGP MESSAGE-----/.test(result.preview)
  ) {
    result.preview = ''
    result.html = ''
    result.text = ''
    result.attachments = []
    result.security = { encrypted: true, state: 'locked', signature: 'unknown', confirmed: false }
  }
  return result
}
/** The row's code or link, from the opening text fetched with it or else its preview. */
function listAuth(message: Message, raw: Json, detect: AuthDetector): Conversation['auth'] {
  if (isDraft(message) || message.security?.encrypted) return { messageId: message.id }
  const part = (raw.textBody || []).find((part: Json) =>
    raw.bodyValues?.[part.partId]?.value?.trim(),
  )
  const excerpt = part && raw.bodyValues[part.partId]
  const candidate = detect(
    excerpt
      ? {
          subject: message.subject,
          [part.type?.toLowerCase() === 'text/html' ? 'html' : 'text']: excerpt.value,
          partial: !!excerpt.isTruncated,
        }
      : // A preview has at most 256 characters; one that long was probably cut off.
        { subject: message.subject, text: message.preview, partial: message.preview.length >= 256 },
  )
  return { messageId: message.id, ...(candidate ? { candidate } : {}) }
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
  /**
   * Requests run a few at a time, as the server allows, so it never turns any away for being too
   * many at once. Waiting ones start in order of priority, then arrival.
   */
  private concurrency = 4
  /** How many method calls the server accepts in one request. */
  private maxCalls = 16
  private active = 0
  private waiting: { rank: number; start: () => void }[] = []
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
  private acquire(rank: number): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((start) => {
      const at = this.waiting.findIndex((w) => w.rank > rank)
      this.waiting.splice(at < 0 ? this.waiting.length : at, 0, { rank, start })
    })
  }
  private release() {
    const next = this.waiting.shift()
    // The turn passes straight to the next request, so nothing can take it in between.
    if (next) next.start()
    else this.active--
  }
  private rateLimited() {
    const seconds = Math.max(1, Math.ceil((this.cooldownUntil - Date.now()) / 1000))
    return new JmapError(
      'rateLimit',
      'The mail server asked inlark to pause. Try again in ' +
        seconds +
        (seconds === 1 ? ' second.' : ' seconds.'),
      seconds,
    )
  }
  /** Waits out a short pause the server asked for before sending, or reports a longer one. */
  private async paused() {
    const remaining = this.cooldownUntil - Date.now()
    if (remaining <= 0) return
    if (remaining > quietPause) throw this.rateLimited()
    await delay(remaining)
  }
  /**
   * Sends a request when its turn comes and reads the response within that turn. With `retry`,
   * for requests that change nothing, one the server turned away unprocessed (during a short
   * pause, or with too many in flight) is sent again.
   */
  private async request<T>(
    url: string,
    init: RequestInit,
    read: (response: Response) => Promise<T>,
    {
      queue = true,
      retry = true,
      timeout = this.options.timeoutMs || 20_000,
    }: { queue?: boolean; retry?: boolean; timeout?: number } = {},
  ): Promise<T> {
    const rank = priorityRank[this.options.priority?.() ?? 'normal']
    for (let attempt = 1; ; attempt++) {
      try {
        await this.paused()
        if (queue) await this.acquire(rank)
        try {
          if (this.disposed) throw new JmapError('offline', 'Account disconnected.')
          // A pause began while this request waited for its turn. Nothing was sent, so it waits too.
          if (Date.now() < this.cooldownUntil) {
            attempt--
            continue
          }
          return await read(await this.send(url, init, timeout))
        } finally {
          if (queue) this.release()
        }
      } catch (error) {
        if (retry && attempt < 3 && error instanceof JmapError) {
          if (error.code === 'rateLimit' && this.cooldownUntil - Date.now() <= quietPause) continue
          if (error.code === 'busy') {
            await delay(150 * 2 ** (attempt - 1))
            continue
          }
        }
        if (error instanceof JmapError && error.code === 'busy')
          throw new JmapError(
            'rateLimit',
            'The mail server is busy with other requests from this account. Try again in a moment.',
            1,
          )
        throw error
      }
    }
  }
  private async send(
    url: string,
    init: RequestInit,
    timeout: number,
    redirects = 0,
  ): Promise<Response> {
    let response: Response
    try {
      response = await this.requestFetch(this.endpoint(url), {
        ...init,
        redirect: 'manual',
        headers: { ...init.headers, Authorization: this.options.authorization },
        signal: init.signal || AbortSignal.timeout(timeout),
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
      return this.send(target, init, timeout, redirects + 1)
    }
    if (response.status === 401 || response.status === 403)
      throw new JmapError(
        'authentication',
        'Sign in again. The server rejected these credentials or permissions.',
      )
    if (response.status === 429) {
      this.cooldownUntil = Math.max(
        this.cooldownUntil,
        Date.now() + pauseSeconds(response.headers) * 1000,
      )
      throw this.rateLimited()
    }
    const limit = response.status === 400 ? await requestLimit(response) : undefined
    if (limit?.startsWith('maxConcurrent'))
      throw new JmapError('busy', 'Too many requests were in flight at once.')
    // Such as too many calls in one request: smaller requests can still succeed.
    if (limit !== undefined)
      throw new JmapError('requestTooLarge', 'The mail server refused a request this large.')
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
    this.session = await this.request(url, {}, (response) => response.json() as Promise<Session>)
    if (!this.session.apiUrl || !this.session.accounts || !this.session.capabilities?.[MAIL])
      throw new JmapError('capability', 'This endpoint does not provide JMAP Mail.')
    this.endpoint(this.session.apiUrl)
    this.endpoint(this.session.uploadUrl)
    this.endpoint(this.session.downloadUrl)
    const core = this.session.capabilities[CORE] || {}
    // RFC 8620 counts concurrent API requests per account; a few at once is plenty for one client.
    this.concurrency = Math.max(1, Math.min(8, Number(core.maxConcurrentRequests) || 4))
    this.maxCalls = Math.max(1, Number(core.maxCallsInRequest) || 16)
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
    // Nothing is sent, so a combined request can still be split into smaller ones.
    if (calls.length > this.maxCalls)
      throw new JmapError(
        'requestTooLarge',
        'The mail server accepts fewer operations per request.',
      )
    const body = await this.request(
      this.session.apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: submission ? [CORE, MAIL, SUBMISSION] : [CORE, MAIL],
          methodCalls: calls,
        }),
      },
      (response) => response.json() as Promise<Json>,
      // Only requests that change nothing are repeated automatically.
      { retry: calls.every(([name]) => /\/(?:get|query|changes|queryChanges)$/.test(name)) },
    )
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
    // The name the user chose in inlark wins over the one configured on the server.
    return result.list.map((i: Json) => ({
      ...i,
      name: account.senderName || i.name,
      accountId: account.id,
    }))
  }
  private noteState(account: Account, data: Json) {
    if (data.state) this.emailState.set(account.id, data.state)
  }
  /** Raw Email/get results, a request per `maxObjectsInGet` messages. */
  private async getEmails(account: Account, ids: string[], view: EmailView): Promise<Json[]> {
    const list: Json[] = []
    for (const batch of batches([...new Set(ids)], this.capabilities.maxObjectsInGet)) {
      const [data] = await this.call([
        ['Email/get', { accountId: account.remoteId, ids: batch, ...emailView(view) }, 'e'],
      ])
      this.noteState(account, data)
      list.push(...data.list)
    }
    return list
  }
  private async getThreads(account: Account, ids: string[]): Promise<Json[]> {
    const list: Json[] = []
    for (const batch of batches([...new Set(ids)], this.capabilities.maxObjectsInGet)) {
      const [data] = await this.call([
        ['Thread/get', { accountId: account.remoteId, ids: batch }, 't'],
      ])
      list.push(...data.list)
    }
    return list
  }
  private async readEmails(account: Account, list: Json[], bodies: boolean): Promise<Message[]> {
    const result: Message[] = []
    for (const raw of list) {
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
              type: part.type || type,
              size: part.size || 0,
            })
            message[field] = renderBodyPart(
              part,
              new TextDecoder(part.charset || 'utf-8').decode(bytes),
              type,
            )
          } catch {
            // Keep the other body representation or the message preview available.
          }
        }
        if (
          !message.security?.encrypted &&
          !needsSource(raw) &&
          !pgpArmor.test((message.text || '') + '\n' + (message.html || ''))
        )
          message.plainSource = plainSource(raw)
      }
      result.push(message)
    }
    return result
  }
  async messages(account: Account, ids: string[], bodies = false): Promise<Message[]> {
    return this.readEmails(
      account,
      await this.getEmails(account, ids, bodies ? 'body' : 'summary'),
      bodies,
    )
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
    const accountId = account.remoteId
    const search: Call = [
      'Email/query',
      {
        accountId,
        filter: jmapFilter(query, boxes),
        sort: [{ property: 'receivedAt', isAscending: false }],
        collapseThreads: true,
        position,
        limit,
        calculateTotal: true,
      },
      'q',
    ]
    const detect = this.options.detectAuth
    // Rows carry their opening text, so each row's code or link is found without opening it.
    const rows: EmailView = detect ? 'excerpt' : 'summary'
    let result: Json, found: Json[], threads: Json[], members: Json[]
    try {
      // One request: the page, its rows, their threads, and the other messages in those threads.
      const [q, e, t, o] = await this.call([
        search,
        [
          'Email/get',
          { accountId, '#ids': ref('q', 'Email/query', '/ids'), ...emailView(rows) },
          'e',
        ],
        ['Thread/get', { accountId, '#ids': ref('e', 'Email/get', '/list/*/threadId') }, 't'],
        [
          'Email/get',
          {
            accountId,
            '#ids': ref('t', 'Thread/get', '/list/*/emailIds'),
            ...emailView('summary'),
          },
          'o',
        ],
      ])
      this.noteState(account, e)
      this.noteState(account, o)
      ;[result, found, threads, members] = [q, e.list, t.list, o.list]
    } catch (error) {
      if (!mustSplit(error)) throw error
      ;[result] = await this.call([search])
      found = await this.getEmails(account, result.ids, rows)
      threads = await this.getThreads(
        account,
        found.map((raw) => raw.threadId),
      )
      const listed = new Set<string>(result.ids)
      members = await this.getEmails(
        account,
        threads.flatMap((t) => t.emailIds).filter((id: string) => !listed.has(id)),
        'summary',
      )
    }
    const rowsById = new Map(found.map((raw) => [raw.id as string, raw]))
    const messages: Message[] = result.ids.flatMap((id: string) =>
      rowsById.has(id) ? [asMessage(account, rowsById.get(id)!, false)] : [],
    )
    const listed = new Set(messages.map((m) => m.id))
    const threadMessages = [
      ...messages,
      ...members.filter((raw) => !listed.has(raw.id)).map((raw) => asMessage(account, raw, false)),
    ]
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
      if (detect) c.auth = listAuth(m, rowsById.get(m.id)!, detect)
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
    const result: Message[] = []
    for (const ids of batches([...new Set(threadIds)], this.capabilities.maxObjectsInGet)) {
      let list: Json[]
      try {
        const [, e] = await this.call([
          ['Thread/get', { accountId: account.remoteId, ids }, 't'],
          [
            'Email/get',
            {
              accountId: account.remoteId,
              '#ids': ref('t', 'Thread/get', '/list/*/emailIds'),
              ...emailView('summary'),
            },
            'e',
          ],
        ])
        this.noteState(account, e)
        list = e.list
      } catch (error) {
        if (!mustSplit(error)) throw error
        const threads = await this.getThreads(account, ids)
        list = await this.getEmails(
          account,
          threads.flatMap((t) => t.emailIds),
          'summary',
        )
      }
      result.push(...(await this.readEmails(account, list, false)))
    }
    return result
  }
  async conversation(account: Account, threadId: string): Promise<Message[]> {
    let thread: Json | undefined, list: Json[]
    try {
      // The thread and all of its messages in one request.
      const [t, e] = await this.call([
        ['Thread/get', { accountId: account.remoteId, ids: [threadId] }, 't'],
        [
          'Email/get',
          {
            accountId: account.remoteId,
            '#ids': ref('t', 'Thread/get', '/list/*/emailIds'),
            ...emailView('body'),
          },
          'e',
        ],
      ])
      this.noteState(account, e)
      ;[thread, list] = [t.list[0], e.list]
    } catch (error) {
      if (!mustSplit(error)) throw error
      ;[thread] = await this.getThreads(account, [threadId])
      list = thread ? await this.getEmails(account, thread.emailIds, 'body') : []
    }
    if (!thread) throw new JmapError('notFound', 'This conversation is no longer available.')
    return (await this.readEmails(account, list, true)).sort((a, b) =>
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
    const result = await this.request(
      url,
      { method: 'POST', headers: { 'Content-Type': type }, body: data as BodyInit },
      (response) => response.json() as Promise<Json>,
      { timeout: 120_000, retry: false },
    )
    if (result.accountId !== account.remoteId || !result.blobId)
      throw new JmapError('upload', 'The upload could not be verified.')
    return result.blobId
  }
  async download(
    account: Account,
    attachment: Attachment,
    maxBytes = 100_000_000,
  ): Promise<Uint8Array> {
    if (!this.session) throw new JmapError('session', 'Reconnect the account.')
    let url = this.session.downloadUrl
    for (const [key, value] of Object.entries({
      accountId: account.remoteId,
      blobId: attachment.blobId,
      type: attachment.type,
      name: attachment.name,
    }))
      url = url.replace('{' + key + '}', encodeURIComponent(value))
    const { chunks, size } = await this.request(
      url,
      {},
      async (response) => {
        const reader = response.body?.getReader()
        if (!reader) throw new JmapError('download', 'Empty attachment response.')
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > maxBytes) {
            await reader.cancel()
            throw new JmapError(
              'tooLarge',
              'Attachments over 100 MB are not supported in this version.',
            )
          }
          chunks.push(part.value)
        }
        return { chunks, size }
      },
      { timeout: 120_000 },
    )
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
  async rawMessage(account: Account, messageId: string, maxBytes: number): Promise<Uint8Array> {
    const [result] = await this.call([
      [
        'Email/get',
        { accountId: account.remoteId, ids: [messageId], properties: ['id', 'blobId', 'size'] },
        'raw',
      ],
    ])
    const message = result.list?.find((m: Json) => m.id === messageId)
    const limit = Math.min(maxBytes, 64 * 1024 * 1024)
    if (!message?.blobId || message.size > limit)
      throw new JmapError(
        'rawMessage',
        'The complete message is unavailable or too large to open securely.',
      )
    return this.download(
      account,
      { blobId: message.blobId, name: 'message.eml', type: 'message/rfc822', size: message.size },
      limit,
    )
  }
  async encryptionHints(account: Account, email: string) {
    const mailboxes = await this.mailboxes(account)
    const [, result] = await this.call([
      [
        'Email/query',
        {
          accountId: account.remoteId,
          filter: jmapFilter({ view: 'all', from: email }, mailboxes),
          sort: [{ property: 'receivedAt', isAscending: false }],
          limit: Math.min(40, this.capabilities.maxObjectsInGet),
        },
        'hints',
      ],
      [
        'Email/get',
        {
          accountId: account.remoteId,
          '#ids': { resultOf: 'hints', name: 'Email/query', path: '/ids' },
          properties: [
            'id',
            'threadId',
            'from',
            'to',
            'cc',
            'receivedAt',
            'sentAt',
            'keywords',
            'mailboxIds',
            'header:Autocrypt:all',
          ],
        },
        'headers',
      ],
    ])
    return (result.list || [])
      .filter(
        (raw: Json) =>
          raw.from?.length === 1 && raw.from[0].email.toLowerCase() === email.toLowerCase(),
      )
      .map((raw: Json) => {
        const values: string[] =
          raw['header:Autocrypt:all'] || raw['header:Autocrypt:asRaw:all'] || []
        const headers = values.length
          ? values.map((v) => 'Autocrypt: ' + v).join('\r\n')
          : 'Content-Type: text/plain'
        return {
          message: asMessage(account, raw, false),
          headers: new TextEncoder().encode(headers.trimEnd() + '\r\n\r\n'),
        }
      })
      .filter((hint: { headers: Uint8Array }) => hint.headers.byteLength <= 20 * 1024)
  }
  async createDraft(
    account: Account,
    draft: Draft,
    messageId?: string,
    precomposed?: Uint8Array,
  ): Promise<string> {
    const boxes = await this.mailboxes(account)
    const drafts = boxes.find((b) => b.role === 'drafts')
    if (!drafts?.rights.mayAddItems)
      throw new JmapError('drafts', 'A writable Drafts folder is required.')
    const identity = (await this.identities(account)).find((i) => i.id === draft.identityId)
    if (!identity) throw new JmapError('identity', 'Choose a valid sending identity.')
    if (precomposed) {
      const blobId = await this.upload(account, precomposed, 'message/rfc822')
      const [result] = await this.call([
        [
          'Email/import',
          {
            accountId: account.remoteId,
            emails: {
              protected: {
                blobId,
                mailboxIds: { [drafts.id]: true },
                keywords: { $draft: true, $seen: true },
              },
            },
          },
          'import',
        ],
      ])
      if (!result.created?.protected?.id)
        throw new JmapError('draft', 'The server could not import the protected draft.')
      return result.created.protected.id
    }
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
    precomposed?: Uint8Array,
  ): Promise<OutgoingMessage> {
    const emailId = await this.createDraft(account, draft, messageId, precomposed)
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
              create: {
                send: {
                  emailId: message.emailId,
                  identityId,
                  envelope: {
                    mailFrom: { email: message.envelope.from },
                    rcptTo: message.envelope.to.map((email) => ({ email })),
                  },
                },
              },
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
        // The stream stays open, so it never takes one of the turns other requests wait for.
        await this.request(
          url,
          { headers: { Accept: 'text/event-stream' }, signal: this.controller.signal },
          async (response) => {
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
                for (const change of stateChanges(event, this.options.connectionId))
                  this.emit(change)
              }
            }
          },
          { queue: false, retry: false },
        )
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
