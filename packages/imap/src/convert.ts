import { parseUnsubscribe, type Attachment, type Message } from '@inlark/core'
import type { BodyPart, IndexedMessage, NewMessage } from './metadata-index'
import type { FetchedMessage } from './port'

const systemFlags: Record<string, string> = {
  '\\seen': '$seen',
  '\\flagged': '$flagged',
  '\\draft': '$draft',
  '\\answered': '$answered',
  '\\deleted': '$deleted',
}
const flagFor: Record<string, string> = Object.fromEntries(
  Object.entries(systemFlags).map(([flag, keyword]) => [
    keyword,
    flag.replace(/^\\(.)/, (_, c) => '\\' + c.toUpperCase()),
  ]),
)

/** IMAP flags → JMAP-style keywords. System flags get their `$` names; keywords are lowercased. */
export function keywordsFromFlags(flags: string[]): Record<string, boolean> {
  const keywords: Record<string, boolean> = {}
  for (const flag of flags) {
    const lower = flag.toLowerCase()
    if (systemFlags[lower]) keywords[systemFlags[lower]] = true
    else if (!lower.startsWith('\\')) keywords[lower] = true
  }
  return keywords
}
export function flagFromKeyword(keyword: string): string {
  return flagFor[keyword.toLowerCase()] || keyword
}

/** Every `<id>` in a header value, without brackets, in order. */
export function messageIds(value?: string | null): string[] {
  if (!value) return []
  const ids = [...value.matchAll(/<([^<>\s]{1,998})>/g)].map((m) => m[1])
  // Some mailers omit brackets for a single ID.
  if (!ids.length && /^[^<>\s@]+@[^<>\s@]+$/.test(value.trim())) return [value.trim()]
  return ids
}

/** Unfolded values of the requested header lines, keyed by lower-case name. */
export function parseHeaderLines(raw?: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!raw) return result
  for (const line of raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    if (!(name in result)) result[name] = line.slice(colon + 1).trim()
  }
  return result
}

const filename = (part: BodyPart) =>
  part.dispositionParameters?.filename || part.parameters?.name || undefined
const contentId = (part: BodyPart) => part.id?.replace(/^<|>$/g, '') || undefined

export function leaves(part?: BodyPart): BodyPart[] {
  if (!part) return []
  if (part.childNodes?.length) return part.childNodes.flatMap(leaves)
  return [part]
}
/** IMAP names a single-part message's body `1` in FETCH BODY[...]; ImapFlow may omit it. */
const section = (part: BodyPart) => part.part || '1'

const isText = (part: BodyPart) => part.type === 'text/plain' || part.type === 'text/html'
export function isAttachmentPart(part: BodyPart): boolean {
  if (part.type.startsWith('multipart/')) return false
  if (part.disposition === 'attachment') return true
  if (isText(part) && !filename(part)) return false
  // Inline images referenced by Content-ID are part of the body, not attachments.
  if (part.disposition === 'inline' && contentId(part)) return false
  return !!filename(part) || !isText(part)
}
export function hasAttachment(structure?: BodyPart): boolean {
  return leaves(structure).some(isAttachmentPart)
}

/** Parts to show and download: attachments plus inline images referenced by Content-ID. */
export function attachmentsOf(message: IndexedMessage): Attachment[] {
  return leaves(message.bodyStructure)
    .filter((part) => isAttachmentPart(part) || (contentId(part) && !isText(part)))
    .map((part) => ({
      blobId: blobId(message.id, section(part)),
      name: filename(part) || (part.type.startsWith('image/') ? 'image' : 'attachment'),
      type: part.type,
      size: part.size || 0,
      ...(contentId(part) ? { cid: contentId(part) } : {}),
      ...(part.disposition ? { disposition: part.disposition } : {}),
    }))
}
/** The body parts to render, preferring those not marked as attachments. */
export function textParts(structure?: BodyPart): { html?: BodyPart; text?: BodyPart } {
  const candidates = leaves(structure).filter((p) => isText(p) && p.disposition !== 'attachment')
  return {
    html: candidates.find((p) => p.type === 'text/html'),
    text: candidates.find((p) => p.type === 'text/plain'),
  }
}
export { section as partSection }

/** An attachment is addressed by its message's ID and IMAP section, never by Message-ID. */
export const blobId = (messageId: string, part: string) => messageId + '/' + part
export function parseBlobId(value: string): { messageId: string; part: string } | undefined {
  const slash = value.lastIndexOf('/')
  if (slash < 1 || !/^[0-9.]+$|^TEXT$/.test(value.slice(slash + 1))) return undefined
  return { messageId: value.slice(0, slash), part: value.slice(slash + 1) }
}

const previewInputLimit = 4096

/** Skip non-visible blocks in a forward scan, including an unterminated final block. */
function withoutHiddenBlocks(value: string): string {
  const opening = /<(style|script|head)(?=[\s/>])/gi
  const visible: string[] = []
  let start = 0
  let match: RegExpExecArray | null
  while ((match = opening.exec(value))) {
    visible.push(value.slice(start, match.index), ' ')
    const closing = new RegExp('</' + match[1] + '>', 'gi')
    closing.lastIndex = opening.lastIndex
    // Do not retry the suffix for every unmatched opener, or show truncated CSS/JS.
    if (!closing.exec(value)) return visible.join('')
    start = closing.lastIndex
    opening.lastIndex = start
  }
  visible.push(value.slice(start))
  return visible.join('')
}

export function previewText(value: string, html = false): string {
  // Opening a message supplies the full body. Bound work here for every caller,
  // before any HTML processing, entity decoding, or line splitting.
  value = value.slice(0, previewInputLimit)
  const text = html
    ? withoutHiddenBlocks(value)
        .replace(/<[^<>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
    : value
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256)
}

export const metadataQuery = {
  flags: true,
  envelope: true,
  bodyStructure: true,
  internalDate: true,
  size: true,
  headers: ['references', 'in-reply-to', 'list-unsubscribe', 'list-unsubscribe-post'],
}

export function toNewMessage(
  fetched: FetchedMessage,
  location: { mailboxId: string; uidValidity: string },
): NewMessage {
  const env = fetched.envelope || {}
  const headers = parseHeaderLines(fetched.headers)
  const references = messageIds(headers.references).slice(-50)
  const inReplyTo = messageIds(headers['in-reply-to'] || env.inReplyTo)
  const receivedAt = fetched.internalDate || env.date || new Date(0).toISOString()
  return {
    ...location,
    uid: fetched.uid,
    modseq: fetched.modseq,
    messageId: messageIds(env.messageId)[0] ?? null,
    inReplyTo,
    references,
    subject: env.subject || '',
    from: env.from?.length ? env.from : env.sender || [],
    to: env.to || [],
    cc: env.cc || [],
    bcc: env.bcc || [],
    replyTo: env.replyTo || [],
    receivedAt,
    sentAt: env.date,
    size: fetched.size || 0,
    flags: fetched.flags || [],
    hasAttachment: hasAttachment(fetched.bodyStructure),
    preview: '',
    bodyStructure: fetched.bodyStructure,
    unsubscribe: parseUnsubscribe(headers['list-unsubscribe'], headers['list-unsubscribe-post']),
  }
}

export function toMessage(accountId: string, m: IndexedMessage): Message {
  return {
    id: m.id,
    accountId,
    threadId: m.threadId,
    subject: m.subject,
    from: m.from,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    replyTo: m.replyTo,
    receivedAt: m.receivedAt,
    sentAt: m.sentAt,
    preview: m.preview,
    keywords: keywordsFromFlags(m.flags),
    mailboxIds: { [m.mailboxId]: true },
    size: m.size,
    hasAttachment: m.hasAttachment,
    messageId: m.messageId ? [m.messageId] : [],
    inReplyTo: m.inReplyTo,
    references: m.references,
    ...(m.unsubscribe ? { unsubscribe: m.unsubscribe } : {}),
  }
}

/** Compresses sorted UIDs into an IMAP set such as `1:4,9,12:13`. */
export function uidSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b)
  const ranges: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++
    ranges.push(start === sorted[i] ? String(start) : start + ':' + sorted[i])
  }
  return ranges.join(',')
}
