import { ProviderError, type Address } from '../../packages/core/src'
import { parseMime } from '../../packages/imap/src/mime'
import type { BodyPart, FolderListing } from '../../packages/imap/src/metadata-index'
import type {
  CopyResult,
  FetchQuery,
  FetchedMessage,
  ImapPort,
  ImapServerOptions,
  SearchCriteria,
} from '../../packages/imap/src/port'

export interface FakeMessageInput {
  messageId?: string
  inReplyTo?: string
  references?: string[]
  subject?: string
  from?: Address[]
  to?: Address[]
  bcc?: Address[]
  date?: string
  text?: string
  html?: string
  attachments?: { name: string; type: string; content: string; cid?: string }[]
  flags?: string[]
}
interface FakeMessage {
  uid: number
  modseq: number
  flags: Set<string>
  internalDate: string
  input: FakeMessageInput
  raw?: Uint8Array
}
interface FakeBox {
  path: string
  specialUse: string | null
  guessed: string | null
  uidValidity: number
  uidNext: number
  messages: FakeMessage[]
}

/** Builds a small but real RFC 5322 message so the MIME parser sees what a server would send. */
function rfc822(input: FakeMessageInput): Uint8Array {
  const header = (name: string, value?: string) => (value ? name + ': ' + value + '\r\n' : '')
  const list = (a?: Address[]) =>
    a?.map((x) => (x.name ? `"${x.name}" <${x.email}>` : x.email)).join(', ')
  const boundary = 'fake-boundary'
  const parts = [
    ['text/plain; charset=utf-8', input.text ?? ''],
    ...(input.html ? [['text/html; charset=utf-8', input.html]] : []),
  ]
  let body: string
  let type: string
  if (!input.attachments?.length && parts.length === 1) {
    type = 'text/plain; charset=utf-8'
    body = input.text ?? ''
  } else {
    type = 'multipart/mixed; boundary="' + boundary + '"'
    body =
      [
        ...parts.map(([t, v]) => '--' + boundary + '\r\nContent-Type: ' + t + '\r\n\r\n' + v),
        ...(input.attachments || []).map(
          (a) =>
            '--' +
            boundary +
            '\r\nContent-Type: ' +
            a.type +
            '\r\nContent-Disposition: ' +
            (a.cid ? 'inline' : 'attachment') +
            '; filename="' +
            a.name +
            '"\r\n' +
            (a.cid ? 'Content-ID: <' + a.cid + '>\r\n' : '') +
            'Content-Transfer-Encoding: base64\r\n\r\n' +
            Buffer.from(a.content).toString('base64'),
        ),
      ].join('\r\n') +
      '\r\n--' +
      boundary +
      '--\r\n'
  }
  return new TextEncoder().encode(
    header('Message-ID', input.messageId && '<' + input.messageId + '>') +
      header('In-Reply-To', input.inReplyTo && '<' + input.inReplyTo + '>') +
      header('References', input.references?.map((r) => '<' + r + '>').join(' ')) +
      header('Subject', input.subject) +
      header('From', list(input.from)) +
      header('To', list(input.to)) +
      header('Date', input.date && new Date(input.date).toUTCString()) +
      'MIME-Version: 1.0\r\nContent-Type: ' +
      type +
      '\r\n\r\n' +
      body,
  )
}
function structure(input: FakeMessageInput): BodyPart {
  const text: BodyPart[] = [
    {
      part: '1',
      type: 'text/plain',
      parameters: { charset: 'utf-8' },
      size: (input.text ?? '').length,
    },
    ...(input.html
      ? [
          {
            part: '2',
            type: 'text/html',
            parameters: { charset: 'utf-8' },
            size: input.html.length,
          },
        ]
      : []),
  ]
  if (!input.attachments?.length && text.length === 1) return { ...text[0], part: undefined }
  return {
    type: 'multipart/mixed',
    childNodes: [
      ...text,
      ...(input.attachments || []).map((a, i) => ({
        part: String(text.length + i + 1),
        type: a.type,
        size: a.content.length,
        disposition: a.cid ? 'inline' : 'attachment',
        dispositionParameters: { filename: a.name },
        ...(a.cid ? { id: '<' + a.cid + '>' } : {}),
      })),
    ],
  }
}

export class FakeImapServer {
  capabilities = new Set(['IMAP4REV1', 'IDLE', 'MOVE', 'UIDPLUS', 'CONDSTORE'])
  boxes = new Map<string, FakeBox>()
  password = 'disposable'
  down = false
  /** Like servers whose search index lags behind APPEND: header searches find nothing. */
  laggingSearch = false
  modseq = 1
  ports: FakePort[] = []
  commands: string[] = []
  /** Runs once before the named command; may throw to simulate a failure. */
  hooks = new Map<string, (stage: 'before' | 'after') => void>()
  private validity = 100
  constructor() {
    this.addMailbox('INBOX')
    this.addMailbox('Sent', '\\Sent')
    this.addMailbox('Drafts', '\\Drafts')
    this.addMailbox('Trash', '\\Trash')
    this.addMailbox('Archive', '\\Archive')
    this.addMailbox('Junk', '\\Junk')
  }
  addMailbox(path: string, specialUse: string | null = null, guessed: string | null = null) {
    this.boxes.set(path, {
      path,
      specialUse,
      guessed,
      uidValidity: this.validity++,
      uidNext: 1,
      messages: [],
    })
  }
  box(path: string) {
    const box = this.boxes.get(path)
    if (!box) throw new Error('No mailbox ' + path)
    return box
  }
  /** Delivers a message as another client or the MTA would, and notifies idling connections. */
  deliver(path: string, input: FakeMessageInput): number {
    const box = this.box(path)
    const uid = box.uidNext++
    box.messages.push({
      uid,
      modseq: ++this.modseq,
      flags: new Set(input.flags || []),
      internalDate: new Date(input.date || Date.now()).toISOString(),
      input,
    })
    this.notify(path, 'exists')
    return uid
  }
  /** Another client changes flags directly. */
  setFlags(path: string, uid: number, flags: string[]) {
    const message = this.box(path).messages.find((m) => m.uid === uid)!
    message.flags = new Set(flags)
    message.modseq = ++this.modseq
    this.notify(path, 'flags')
  }
  /** Another client expunges. */
  remove(path: string, uid: number) {
    const box = this.box(path)
    box.messages = box.messages.filter((m) => m.uid !== uid)
    this.notify(path, 'expunge')
  }
  /** The server rebuilt the folder: every UID changes. */
  resetUidValidity(path: string) {
    const box = this.box(path)
    box.uidValidity = this.validity++
    box.uidNext = 1
    for (const m of box.messages) m.uid = box.uidNext++
  }
  notify(path: string, event: 'exists' | 'expunge' | 'flags') {
    for (const port of this.ports) port.emitEvent(event, path)
  }
  hook(command: string, stage: 'before' | 'after') {
    const fn = this.hooks.get(command + ':' + stage)
    if (fn) {
      this.hooks.delete(command + ':' + stage)
      fn(stage)
    }
  }
  port = (options: ImapServerOptions, purpose: 'command' | 'idle') => {
    const port = new FakePort(this, options, purpose)
    this.ports.push(port)
    return port
  }
  get commandPorts() {
    return this.ports.filter((p) => p.purpose === 'command')
  }
}

export class FakePort implements ImapPort {
  private selected?: string
  private open = false
  private handlers = new Map<string, ((path: string) => void)[]>()
  constructor(
    private server: FakeImapServer,
    private options: ImapServerOptions,
    readonly purpose: 'command' | 'idle',
  ) {}
  get capabilities() {
    return this.server.capabilities
  }
  get condstore() {
    return this.server.capabilities.has('CONDSTORE')
  }
  private check(command: string) {
    this.server.commands.push(command)
    if (!this.open) throw new ProviderError('network', 'Connection closed.')
    this.server.hook(command, 'before')
  }
  private selectedBox() {
    if (!this.selected) throw new ProviderError('command', 'No mailbox selected.')
    return this.server.box(this.selected)
  }
  emitEvent(event: string, path: string) {
    if (this.open && this.selected === path)
      for (const fn of this.handlers.get(event) || []) fn(path)
  }
  /** Simulates a dropped connection. */
  drop() {
    if (!this.open) return
    this.open = false
    for (const fn of this.handlers.get('close') || []) fn('')
  }
  async connect() {
    if (this.server.down)
      throw new ProviderError('network', 'The incoming server could not be reached.')
    if (this.options.password !== this.server.password)
      throw new ProviderError('authentication', 'The incoming server rejected this login.')
    this.open = true
  }
  async close() {
    this.drop()
  }
  on(event: string, listener: (path: string) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) || []), listener])
  }
  async list(): Promise<FolderListing[]> {
    this.check('LIST')
    return [...this.server.boxes.values()].map((b) => ({
      path: b.path,
      name: b.path.split('/').at(-1)!,
      delimiter: '/',
      parentPath: b.path.includes('/') ? b.path.slice(0, b.path.lastIndexOf('/')) : null,
      specialUse: b.specialUse,
      guessedSpecialUse: b.guessed,
      noSelect: false,
    }))
  }
  async status(path: string) {
    this.check('STATUS')
    const box = this.server.box(path)
    return {
      messages: box.messages.length,
      unseen: box.messages.filter((m) => !m.flags.has('\\Seen')).length,
      uidNext: box.uidNext,
      uidValidity: String(box.uidValidity),
      highestModseq: this.condstore
        ? String(Math.max(1, ...box.messages.map((m) => m.modseq)))
        : undefined,
    }
  }
  async select(path: string) {
    this.check('SELECT')
    const box = this.server.box(path)
    this.selected = path
    return {
      path,
      uidValidity: String(box.uidValidity),
      uidNext: box.uidNext,
      exists: box.messages.length,
      highestModseq: this.condstore
        ? String(Math.max(1, ...box.messages.map((m) => m.modseq)))
        : undefined,
    }
  }
  private inRange(range: string, uid: number, max: number) {
    return range.split(',').some((part) => {
      const [a, b] = part.split(':')
      const low = a === '*' ? max : Number(a)
      const high = b === undefined ? low : b === '*' ? max : Number(b)
      return uid >= Math.min(low, high) && uid <= Math.max(low, high)
    })
  }
  async search(criteria: SearchCriteria) {
    this.check('SEARCH')
    const box = this.selectedBox()
    const max = Math.max(0, ...box.messages.map((m) => m.uid))
    const has = (value: string | undefined, needle?: string) =>
      !needle || (value || '').toLowerCase().includes(needle.toLowerCase())
    return box.messages
      .filter((m) => {
        const i = m.input
        const addresses = (a?: Address[]) => a?.map((x) => x.name + ' ' + x.email).join(' ')
        if (criteria.uid && !this.inRange(criteria.uid, m.uid, max)) return false
        if (
          criteria.text &&
          !has([i.subject, i.text, i.html, addresses(i.from)].join(' '), criteria.text)
        )
          return false
        if (!has(addresses(i.from), criteria.from) || !has(addresses(i.to), criteria.to))
          return false
        if (!has(i.subject, criteria.subject)) return false
        if (criteria.seen !== undefined && m.flags.has('\\Seen') !== criteria.seen) return false
        if (criteria.flagged !== undefined && m.flags.has('\\Flagged') !== criteria.flagged)
          return false
        if (
          criteria.header?.['message-id'] &&
          (this.server.laggingSearch || '<' + i.messageId + '>' !== criteria.header['message-id'])
        )
          return false
        if (criteria.since && m.internalDate < criteria.since.toISOString().slice(0, 10))
          return false
        return true
      })
      .map((m) => m.uid)
  }
  async fetch(range: string, query: FetchQuery, changedSince?: string): Promise<FetchedMessage[]> {
    this.check('FETCH')
    const box = this.selectedBox()
    const max = Math.max(0, ...box.messages.map((m) => m.uid))
    return box.messages
      .filter((m) => this.inRange(range, m.uid, max))
      .filter((m) => !changedSince || m.modseq > Number(changedSince))
      .map((m) => {
        const i = m.input
        const raw = (m.raw ??= rfc822(i))
        return {
          uid: m.uid,
          modseq: this.condstore ? String(m.modseq) : undefined,
          ...(query.flags ? { flags: [...m.flags] } : {}),
          ...(query.envelope
            ? {
                envelope: {
                  date: i.date,
                  subject: i.subject,
                  messageId: i.messageId && '<' + i.messageId + '>',
                  inReplyTo: i.inReplyTo && '<' + i.inReplyTo + '>',
                  from: i.from || [],
                  to: i.to || [],
                  cc: [],
                  bcc: i.bcc || [],
                  replyTo: [],
                },
              }
            : {}),
          ...(query.bodyStructure ? { bodyStructure: structure(i) } : {}),
          ...(query.internalDate ? { internalDate: m.internalDate } : {}),
          ...(query.size ? { size: raw.length } : {}),
          ...(query.headers
            ? {
                headers: i.references
                  ? 'References: ' + i.references.map((r) => '<' + r + '>').join(' ') + '\r\n'
                  : '',
              }
            : {}),
        }
      })
  }
  async source(uid: number, maxBytes: number) {
    this.check('FETCH')
    const m = this.selectedBox().messages.find((x) => x.uid === uid)
    if (!m) return undefined
    const raw = (m.raw ??= rfc822(m.input))
    return raw.length > maxBytes ? undefined : raw
  }
  async download(uid: number, part: string, maxBytes: number, truncate = false) {
    this.check('FETCH')
    const m = this.selectedBox().messages.find((x) => x.uid === uid)
    if (!m) throw new ProviderError('notFound', 'Gone.')
    const i = m.input
    const texts = [i.text ?? '', ...(i.html ? [i.html] : [])]
    const index = Number(part === 'TEXT' ? 1 : part) - 1
    const value =
      index < texts.length
        ? texts[index]
        : ((i.attachments || [])[index - texts.length]?.content ?? '')
    const bytes = new TextEncoder().encode(value)
    if (bytes.length > maxBytes && !truncate) throw new ProviderError('tooLarge', 'Too large.')
    return bytes.subarray(0, maxBytes)
  }
  async store(
    uids: number[],
    operation: 'add' | 'remove',
    flags: string[],
    unchangedSince?: string,
  ) {
    this.check('STORE')
    for (const m of this.selectedBox().messages.filter((x) => uids.includes(x.uid))) {
      // CONDSTORE: a message changed after the given modseq is left alone ([MODIFIED]).
      if (unchangedSince && this.condstore && m.modseq > Number(unchangedSince)) continue
      for (const flag of flags) operation === 'add' ? m.flags.add(flag) : m.flags.delete(flag)
      m.modseq = ++this.server.modseq
    }
    this.server.hook('STORE', 'after')
    return true
  }
  private transfer(uids: number[], destination: string, remove: boolean): CopyResult {
    const source = this.selectedBox()
    const target = this.server.box(destination)
    const uidMap = new Map<number, number>()
    for (const m of source.messages.filter((x) => uids.includes(x.uid))) {
      const uid = target.uidNext++
      uidMap.set(m.uid, uid)
      target.messages.push({ ...m, uid, flags: new Set(m.flags), modseq: ++this.server.modseq })
    }
    if (remove) source.messages = source.messages.filter((x) => !uids.includes(x.uid))
    this.server.notify(destination, 'exists')
    return this.capabilities.has('UIDPLUS')
      ? { uidValidity: String(target.uidValidity), uidMap }
      : {}
  }
  async move(uids: number[], destination: string) {
    if (!this.capabilities.has('MOVE')) throw new ProviderError('unsupported', 'No MOVE.')
    this.check('MOVE')
    return this.transfer(uids, destination, true)
  }
  async copy(uids: number[], destination: string) {
    this.check('COPY')
    return this.transfer(uids, destination, false)
  }
  async expunge(uids: number[]) {
    if (!this.capabilities.has('UIDPLUS')) throw new ProviderError('unsupported', 'No UIDPLUS.')
    this.check('UID EXPUNGE')
    const box = this.selectedBox()
    for (const m of box.messages) if (uids.includes(m.uid)) m.flags.add('\\Deleted')
    box.messages = box.messages.filter((m) => !(uids.includes(m.uid) && m.flags.has('\\Deleted')))
    return true
  }
  async append(path: string, content: Uint8Array, flags: string[], date?: Date) {
    this.check('APPEND')
    const box = this.server.box(path)
    // A real server parses the appended message for its envelope.
    const parsed = await parseMime(content)
    const uid = box.uidNext++
    box.messages.push({
      uid,
      modseq: ++this.server.modseq,
      flags: new Set(flags),
      internalDate: (date || new Date()).toISOString(),
      input: {
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo[0],
        references: parsed.references,
        subject: parsed.subject,
        from: parsed.from,
        to: parsed.to,
        bcc: parsed.bcc,
        text: parsed.text,
        html: parsed.html || undefined,
      },
      raw: content,
    })
    this.server.hook('APPEND', 'after')
    return this.capabilities.has('UIDPLUS') ? { uid, uidValidity: String(box.uidValidity) } : {}
  }
  async createMailbox(path: string) {
    this.check('CREATE')
    this.server.addMailbox(path)
  }
  async renameMailbox(path: string, newPath: string) {
    this.check('RENAME')
    const box = this.server.box(path)
    this.server.boxes.delete(path)
    this.server.boxes.set(newPath, { ...box, path: newPath })
  }
  async deleteMailbox(path: string) {
    this.check('DELETE')
    this.server.boxes.delete(path)
  }
}
