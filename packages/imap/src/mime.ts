import MailComposer from 'nodemailer/lib/mail-composer'
import { simpleParser, type AddressObject } from 'mailparser'
import { parseUnsubscribe, ProviderError, type Address } from '@inlark/core'

export interface ComposeInput {
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  html: string
  text: string
  /** Without angle brackets. */
  messageId: string
  inReplyTo?: string[]
  references?: string[]
  date?: Date
  attachments: { name: string; type: string; cid?: string; content: Uint8Array }[]
  /** Drafts keep Bcc so another client resuming the draft sees it; transmitted/Sent copies never do. */
  keepBcc?: boolean
}

export interface ParsedMime {
  subject: string
  from: Address[]
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  date?: string
  /** Message ids are returned without angle brackets. */
  messageId?: string
  inReplyTo: string[]
  references: string[]
  /** '' when the message has no HTML part; never generated from the text. */
  html: string
  text: string
  attachments: {
    name: string
    type: string
    size: number
    cid?: string
    disposition?: string
    content: Uint8Array
  }[]
  unsubscribe?: { url: string; oneClick: boolean }
}

export const defaultMaxMimeBytes = 64 * 1024 * 1024

const bracketed = (id: string) => `<${id.trim().replace(/^<|>$/g, '')}>`
const addresses = (list: Address[]) =>
  list.length ? list.map((a) => ({ name: a.name, address: a.email })) : undefined
// A copy, so the result never shares a pooled ArrayBuffer with unrelated memory.
const plain = (bytes: Uint8Array) => new Uint8Array(bytes)

export async function composeMime(input: ComposeInput): Promise<Uint8Array> {
  const node = new MailComposer({
    from: { name: input.from.name, address: input.from.email },
    to: addresses(input.to),
    cc: addresses(input.cc),
    bcc: addresses(input.bcc),
    subject: input.subject,
    text: input.text || undefined,
    html: input.html || undefined,
    messageId: bracketed(input.messageId),
    inReplyTo: input.inReplyTo?.length ? input.inReplyTo.map(bracketed).join(' ') : undefined,
    references: input.references?.length ? input.references.map(bracketed) : undefined,
    date: input.date ?? new Date(),
    attachments: input.attachments.map((a) => ({
      filename: a.name,
      contentType: a.type || 'application/octet-stream',
      content: Buffer.from(a.content.buffer, a.content.byteOffset, a.content.byteLength),
      contentDisposition: a.cid ? 'inline' : 'attachment',
      ...(a.cid ? { cid: a.cid } : {}),
    })),
    // Content is always supplied in memory; never let a value be read as a path or URL.
    disableFileAccess: true,
    disableUrlAccess: true,
    // The default prefix names the library; boundaries should not identify the client.
    boundaryPrefix: '--',
    // Canonical CRLF, so the bytes stored as a Sent copy are exactly the bytes transmitted.
    newline: 'windows',
  }).compile()
  node.keepBcc = !!input.keepBcc
  return plain(await node.build())
}

const ids = (value: unknown): string[] =>
  [value ?? []]
    .flat()
    .flatMap((v) => String(v).match(/<[^<>]+>/g) ?? (String(v).trim() ? [String(v).trim()] : []))
    .map((id) => id.replace(/^<|>$/g, '').trim())
    .filter(Boolean)

const addressList = (value?: AddressObject | AddressObject[]): Address[] =>
  [value ?? []].flat().flatMap((object) =>
    object.value
      .flatMap((a) => (a.group ? a.group : [a]))
      .filter((a) => a.address)
      .map((a) => ({ name: a.name || '', email: a.address! })),
  )

/** Mirrors the JMAP provider: https or mailto only, never credentials in the URL. */

export async function parseMime(
  source: Uint8Array,
  options: { maxBytes?: number } = {},
): Promise<ParsedMime> {
  const maxBytes = options.maxBytes ?? defaultMaxMimeBytes
  if (source.byteLength > maxBytes)
    throw new ProviderError('tooLarge', 'This message is too large to open.')
  const mail = await simpleParser(
    Buffer.from(source.buffer, source.byteOffset, source.byteLength),
    { skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true, keepCidLinks: true },
  )
  const header = (key: string) => {
    const line = mail.headerLines?.find((h) => h.key === key)?.line
    return line
      ?.slice(line.indexOf(':') + 1)
      .replace(/\r?\n[ \t]+/g, ' ')
      .trim()
  }
  const date = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date.toISOString() : undefined
  const messageId = ids(mail.messageId)[0]
  const unsubscribe = parseUnsubscribe(header('list-unsubscribe'), header('list-unsubscribe-post'))
  return {
    subject: mail.subject ?? '',
    from: addressList(mail.from),
    to: addressList(mail.to),
    cc: addressList(mail.cc),
    bcc: addressList(mail.bcc),
    replyTo: addressList(mail.replyTo),
    ...(date ? { date } : {}),
    ...(messageId ? { messageId } : {}),
    inReplyTo: ids(mail.inReplyTo),
    references: ids(mail.references),
    html: typeof mail.html === 'string' ? mail.html : '',
    text: mail.text ?? '',
    attachments: mail.attachments.map((a) => ({
      name: a.filename || 'attachment',
      type: a.contentType || 'application/octet-stream',
      size: a.content.byteLength,
      ...(a.cid ? { cid: a.cid.replace(/^<|>$/g, '') } : {}),
      ...(a.contentDisposition ? { disposition: a.contentDisposition } : {}),
      content: plain(a.content),
    })),
    ...(unsubscribe ? { unsubscribe } : {}),
  }
}
