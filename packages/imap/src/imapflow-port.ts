import { isIP } from 'node:net'
import {
  ImapFlow,
  type ImapFlowOptions,
  type ListResponse,
  type MessageStructureObject,
} from 'imapflow'
import { ProviderError, type Address, type ServerSettings } from '@inlark/core'
import { certificateError, certificateOptions, isCertificateFailure } from './certificate'
import type { BodyPart, FolderListing } from './metadata-index'
import type {
  AppendResult,
  CopyResult,
  Envelope,
  FetchQuery,
  FetchedMessage,
  ImapPort,
  ImapServerOptions,
  MailboxStatus,
  SearchCriteria,
  SelectedMailbox,
} from './port'

const tlsCodes = new Set(['ERR_SSL_WRONG_VERSION_NUMBER', 'EPROTO'])

/** Maps a connection-phase failure to a calm, specific error. Never includes the password. */
export function connectionError(
  error: unknown,
  server: Pick<ServerSettings, 'host' | 'certificate'>,
): ProviderError {
  const host = server.host
  const e = error as {
    code?: string
    authenticationFailed?: boolean
    tlsFailed?: boolean
    message?: string
  }
  if (e?.authenticationFailed)
    return new ProviderError(
      'authentication',
      'The incoming server rejected this login. Check the username and password, or create an app password.',
    )
  if (isCertificateFailure(e?.code)) return certificateError('incoming', server, e.code)
  if (
    e?.tlsFailed ||
    (e?.code && tlsCodes.has(e.code)) ||
    /certificate|TLS|SSL/i.test(e?.message || '')
  )
    return new ProviderError(
      'tls',
      'A secure connection to ' +
        host +
        ' could not be established or its certificate could not be verified. Inlark never falls back to an unencrypted connection.',
    )
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN')
    return new ProviderError(
      'network',
      'The server ' + host + ' could not be found. Check its name.',
    )
  if (e?.code === 'ECONNREFUSED')
    return new ProviderError(
      'network',
      host + ' refused the connection. Check the port and security setting.',
    )
  return new ProviderError(
    'network',
    'The incoming server could not be reached. Check your connection and the server settings.',
  )
}

/** The exact ImapFlow options, exported so tests can assert the TLS policy. */
export function imapFlowOptions(
  options: ImapServerOptions,
  purpose: 'command' | 'idle',
): ImapFlowOptions {
  const implicit = options.security === 'tls'
  return {
    host: options.host,
    port: options.port,
    secure: implicit,
    // STARTTLS is required, never opportunistic: without it the login is not sent at all.
    doSTARTTLS: implicit ? undefined : true,
    ...(isIP(options.host.replace(/^\[|\]$/g, '')) ? {} : { servername: options.host }),
    auth: { user: options.username, pass: options.password },
    tls: certificateOptions(options, options.tls?.ca),
    logger: false,
    // No client identification is sent to the server.
    clientInfo: { name: false },
    disableAutoIdle: purpose === 'command',
    maxIdleTime: purpose === 'idle' ? 25 * 60_000 : undefined,
    connectionTimeout: options.timeoutMs ?? 30_000,
    greetingTimeout: options.timeoutMs ?? 16_000,
    socketTimeout: purpose === 'idle' ? 30 * 60_000 : 5 * 60_000,
    // Bound memory against a broken or hostile server.
    maxLiteralSize: 200_000_000,
    maxResponseSize: 250_000_000,
  }
}

const address = (list?: { name?: string; address?: string }[]): Address[] =>
  (list || []).filter((a) => a.address).map((a) => ({ name: a.name || '', email: a.address! }))

function bodyPart(node: MessageStructureObject): BodyPart {
  return {
    part: node.part,
    type: (node.type || 'application/octet-stream').toLowerCase(),
    ...(node.parameters ? { parameters: node.parameters } : {}),
    ...(node.id ? { id: node.id } : {}),
    ...(node.encoding ? { encoding: node.encoding } : {}),
    ...(node.size !== undefined ? { size: node.size } : {}),
    ...(node.disposition ? { disposition: node.disposition.toLowerCase() } : {}),
    ...(node.dispositionParameters ? { dispositionParameters: node.dispositionParameters } : {}),
    ...(node.childNodes ? { childNodes: node.childNodes.map(bodyPart) } : {}),
  }
}

const iso = (value?: Date | string) => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function bytes(
  stream: AsyncIterable<Buffer | Uint8Array>,
  maxBytes: number,
  truncate: boolean,
) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    chunks.push(chunk)
    if (size > maxBytes) {
      if (truncate) break
      throw new ProviderError(
        'tooLarge',
        'Attachments over 100 MB are not supported in this version.',
      )
    }
  }
  return new Uint8Array(Buffer.concat(chunks)).subarray(0, maxBytes)
}

export class ImapFlowPort implements ImapPort {
  private client: ImapFlow
  constructor(
    private options: ImapServerOptions,
    purpose: 'command' | 'idle',
  ) {
    this.client = new ImapFlow(imapFlowOptions(options, purpose))
    // Errors also surface as rejected commands and a `close` event; never crash the process.
    this.client.on('error', () => {})
  }
  get capabilities(): ReadonlySet<string> {
    return new Set([...this.client.capabilities.keys()].map((c) => c.toUpperCase()))
  }
  get condstore() {
    return this.client.enabled.has('CONDSTORE')
  }
  private can(name: string) {
    return this.client.capabilities.has(name)
  }
  async connect() {
    try {
      await this.client.connect()
    } catch (error) {
      throw connectionError(error, this.options)
    }
  }
  async close() {
    try {
      await this.client.logout()
    } catch {
      this.client.close()
    }
  }
  on(event: 'close' | 'exists' | 'expunge' | 'flags', listener: (path: string) => void) {
    if (event === 'close') this.client.on('close', () => listener(''))
    else this.client.on(event, (data: { path: string }) => listener(data.path))
  }
  /** Commands on a closed connection become `network` errors so callers can reconnect. */
  private async wrap<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } catch (error) {
      if (error instanceof ProviderError) throw error
      const e = error as { code?: string; responseStatus?: string; responseText?: string }
      if (e?.code === 'NoConnection' || e?.code === 'EConnectionClosed' || !this.client.usable)
        throw new ProviderError('network', 'The connection to the incoming server was interrupted.')
      throw new ProviderError(
        'command',
        'The server refused the request' + (e?.responseText ? ': ' + e.responseText : '.'),
      )
    }
  }
  list(): Promise<FolderListing[]> {
    return this.wrap(async () =>
      (await this.client.list()).map((entry: ListResponse) => ({
        path: entry.path,
        name: entry.name,
        delimiter: entry.delimiter || '/',
        parentPath: entry.parentPath || null,
        specialUse:
          entry.specialUseSource === 'extension' && entry.specialUse !== '\\Inbox'
            ? entry.specialUse || null
            : null,
        guessedSpecialUse:
          entry.specialUseSource === 'name' && entry.specialUse !== '\\Inbox'
            ? entry.specialUse || null
            : null,
        noSelect: [...entry.flags].some((f) => /^\\(noselect|nonexistent)$/i.test(f)),
      })),
    )
  }
  status(path: string): Promise<MailboxStatus> {
    return this.wrap(async () => {
      const s = await this.client.status(path, {
        messages: true,
        unseen: true,
        uidNext: true,
        uidValidity: true,
        ...(this.condstore || this.can('CONDSTORE') ? { highestModseq: true } : {}),
      })
      return {
        messages: s.messages ?? 0,
        unseen: s.unseen ?? 0,
        uidNext: s.uidNext,
        uidValidity: s.uidValidity?.toString(),
        highestModseq: s.highestModseq?.toString(),
      }
    })
  }
  select(path: string): Promise<SelectedMailbox> {
    return this.wrap(async () => {
      const box = await this.client.mailboxOpen(path)
      return {
        path: box.path,
        uidValidity: box.uidValidity.toString(),
        uidNext: box.uidNext,
        exists: box.exists,
        highestModseq: box.noModseq ? undefined : box.highestModseq?.toString(),
      }
    })
  }
  search(criteria: SearchCriteria): Promise<number[]> {
    return this.wrap(async () => {
      const result = await this.client.search(criteria, { uid: true })
      return result ? [...result].sort((a, b) => a - b) : []
    })
  }
  fetch(range: string, query: FetchQuery, changedSince?: string): Promise<FetchedMessage[]> {
    return this.wrap(async () => {
      const result: FetchedMessage[] = []
      for await (const m of this.client.fetch(
        range,
        { uid: true, ...query },
        {
          uid: true,
          ...(changedSince && this.condstore ? { changedSince: BigInt(changedSince) } : {}),
        },
      )) {
        const env = m.envelope
        const envelope: Envelope | undefined = env
          ? {
              date: iso(env.date),
              subject: env.subject,
              messageId: env.messageId,
              inReplyTo: env.inReplyTo,
              from: address(env.from),
              sender: address(env.sender),
              replyTo: address(env.replyTo),
              to: address(env.to),
              cc: address(env.cc),
              bcc: address(env.bcc),
            }
          : undefined
        result.push({
          uid: m.uid,
          modseq: m.modseq?.toString(),
          flags: m.flags ? [...m.flags] : undefined,
          envelope,
          bodyStructure: m.bodyStructure ? bodyPart(m.bodyStructure) : undefined,
          internalDate: iso(m.internalDate),
          size: m.size,
          headers: m.headers?.toString('utf8'),
        })
      }
      return result
    })
  }
  source(uid: number, maxBytes: number): Promise<Uint8Array | undefined> {
    return this.wrap(async () => {
      const [size] = await this.fetch(String(uid), { size: true })
      if (!size || (size.size ?? 0) > maxBytes) return undefined
      const message = await this.client.fetchOne(String(uid), { source: true }, { uid: true })
      return message && message.source ? new Uint8Array(message.source) : undefined
    })
  }
  download(uid: number, part: string, maxBytes: number, truncate = false): Promise<Uint8Array> {
    return this.wrap(async () => {
      const { content } = await this.client.download(String(uid), part, {
        uid: true,
        maxBytes: maxBytes + 1,
        ...(truncate ? { chunkSize: Math.min(65536, Math.max(1024, maxBytes)) } : {}),
      })
      return bytes(content, maxBytes, truncate)
    })
  }
  store(uids: number[], operation: 'add' | 'remove', flags: string[], unchangedSince?: string) {
    return this.wrap(async () => {
      const options = {
        uid: true,
        ...(unchangedSince && this.condstore ? { unchangedSince: BigInt(unchangedSince) } : {}),
      }
      return operation === 'add'
        ? this.client.messageFlagsAdd(uids.join(','), flags, options)
        : this.client.messageFlagsRemove(uids.join(','), flags, options)
    })
  }
  move(uids: number[], destination: string): Promise<CopyResult | false> {
    // ImapFlow would emulate a missing MOVE with COPY and a mailbox-wide EXPUNGE.
    if (!this.can('MOVE'))
      throw new ProviderError('unsupported', 'This server does not support MOVE.')
    return this.wrap(async () => {
      const result = await this.client.messageMove(uids.join(','), destination, { uid: true })
      return result ? { uidValidity: result.uidValidity?.toString(), uidMap: result.uidMap } : false
    })
  }
  copy(uids: number[], destination: string): Promise<CopyResult | false> {
    return this.wrap(async () => {
      const result = await this.client.messageCopy(uids.join(','), destination, { uid: true })
      return result ? { uidValidity: result.uidValidity?.toString(), uidMap: result.uidMap } : false
    })
  }
  expunge(uids: number[]): Promise<boolean> {
    // Without UIDPLUS ImapFlow issues a plain EXPUNGE, which removes every \Deleted message.
    if (!this.can('UIDPLUS'))
      throw new ProviderError('unsupported', 'This server does not support UIDPLUS.')
    return this.wrap(async () => this.client.messageDelete(uids.join(','), { uid: true }))
  }
  append(path: string, content: Uint8Array, flags: string[], date?: Date): Promise<AppendResult> {
    return this.wrap(async () => {
      const result = await this.client.append(path, Buffer.from(content), flags, date)
      if (!result) throw new ProviderError('command', 'The server did not store the message.')
      return { uid: result.uid, uidValidity: result.uidValidity?.toString() }
    })
  }
  createMailbox(path: string) {
    return this.wrap(async () => void (await this.client.mailboxCreate(path)))
  }
  renameMailbox(path: string, newPath: string) {
    return this.wrap(async () => void (await this.client.mailboxRename(path, newPath)))
  }
  deleteMailbox(path: string) {
    return this.wrap(async () => void (await this.client.mailboxDelete(path)))
  }
}
