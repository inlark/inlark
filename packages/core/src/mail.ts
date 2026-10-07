import type {
  Address,
  Conversation,
  Draft,
  Identity,
  Message,
  ProviderPage,
  QueryPage,
  Settings,
} from './model'

export const scopeKey = (accountId: string, id: string) => JSON.stringify([accountId, id])
export const accountKey = (connectionId: string, remoteId: string) =>
  JSON.stringify([connectionId, remoteId])
export const identityKey = (accountId: string, id: string) => scopeKey(accountId, id)
export interface Signature {
  format: 'text' | 'html'
  value: string
}
/** The signature for an identity: the user's own when they wrote one, else the server's. */
export function identitySignature(
  settings: Pick<Settings, 'signatures' | 'htmlSignatures'>,
  identity: Pick<Identity, 'accountId' | 'id' | 'textSignature' | 'htmlSignature'>,
): Signature {
  const key = identityKey(identity.accountId, identity.id)
  const own = settings.signatures[key]
  if (own !== undefined)
    return { format: settings.htmlSignatures?.[key] ? 'html' : 'text', value: own }
  if (identity.htmlSignature?.trim()) return { format: 'html', value: identity.htmlSignature }
  return { format: 'text', value: identity.textSignature ?? '' }
}
/** A saved but unsent message. Servers file reply drafts in the conversation they answer. */
export const isDraft = (message: Pick<Message, 'keywords'>) => !!message.keywords.$draft
/** The newest message of a conversation that was actually sent or received, oldest-first input. */
export const replyTarget = (messages: Message[]) => messages.filter((m) => !isDraft(m)).at(-1)
export function conversationFromMessages(
  accountId: string,
  threadId: string,
  messages: Message[],
): Conversation {
  const sorted = [...messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const latest = sorted[0]
  // The author of an unsent draft has not taken part yet.
  const said = sorted.filter((m) => !isDraft(m))
  return {
    id: threadId,
    accountId,
    key: scopeKey(accountId, threadId),
    subject: latest?.subject || '(No subject)',
    from: [
      ...new Map(
        (said.length ? said : sorted).flatMap((m) => m.from).map((a) => [a.email.toLowerCase(), a]),
      ).values(),
    ],
    preview: latest?.preview || '',
    receivedAt: latest?.receivedAt || '',
    unread: messages.some((m) => !m.keywords.$seen),
    starred: messages.some((m) => m.keywords.$flagged),
    hasAttachment: messages.some((m) => m.hasAttachment),
    count: messages.length,
    messages,
  }
}
export function mergePages(
  pages: { accountId: string; page: ProviderPage; position: number }[],
  limit: number,
): QueryPage {
  const all = pages
    .flatMap((p) => p.page.items)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.key.localeCompare(b.key))
  const items = all.slice(0, limit)
  const next: Record<string, number> = {}
  for (const p of pages) {
    const consumed = items.filter((i) => i.accountId === p.accountId).length
    if (consumed < p.page.items.length || p.page.next !== undefined)
      next[p.accountId] = p.position + consumed
  }
  const incomplete = pages.filter((p) => p.page.incomplete).map((p) => p.accountId)
  return {
    items,
    total: pages.reduce((n, p) => n + p.page.total, 0),
    next: Object.keys(next).length ? next : undefined,
    failedAccounts: [],
    ...(incomplete.length ? { incompleteAccounts: incomplete } : {}),
  }
}
/** Identifies a server draft's content, to detect edits made by another client. */
export function draftFingerprint(message: Message): string {
  if (message.protectedRevision) return message.protectedRevision
  return JSON.stringify([
    message.subject,
    message.to,
    message.cc,
    message.bcc,
    message.html,
    message.text,
    message.attachments?.map((a) => a.blobId),
  ])
}
export function unlinkedServerDrafts(conversations: Conversation[], local: Draft[]): Message[] {
  const linked = new Set(
    local.filter((d) => d.serverId).map((d) => scopeKey(d.accountId, d.serverId!)),
  )
  return [
    ...new Map(
      conversations
        .flatMap((c) => c.messages)
        .filter((m) => isDraft(m) && !linked.has(scopeKey(m.accountId, m.id)))
        .map((m) => [scopeKey(m.accountId, m.id), m]),
    ).values(),
  ].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}
export function parseAddresses(value: string): Address[] {
  return (value.match(/(?:[^,;"<]|"[^"]*"|<[^>]*>)+/g) || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const match = s.match(/^(.*?)\s*<([^>]+)>$/)
      return {
        name: match ? match[1].replace(/^"|"$/g, '').trim() : '',
        email: match ? match[2].trim() : s,
      }
    })
}
export function replyRecipients(
  message: Message,
  identities: Identity[],
  all: boolean,
): { to: Address[]; cc: Address[]; identity?: Identity } {
  const own = new Set(identities.map((i) => i.email.toLowerCase()))
  const identity =
    identities.find((i) =>
      message.to.some((a) => a.email.toLowerCase() === i.email.toLowerCase()),
    ) ||
    identities.find((i) =>
      message.cc.some((a) => a.email.toLowerCase() === i.email.toLowerCase()),
    ) ||
    identities[0]
  const sender = message.replyTo.length ? message.replyTo : message.from
  const to = sender.filter((a) => !own.has(a.email.toLowerCase()))
  if (!to.length) to.push(...message.to.filter((a) => !own.has(a.email.toLowerCase())))
  const seen = new Set(to.map((a) => a.email.toLowerCase()))
  const cc = all
    ? [...message.to, ...message.cc].filter((a) => {
        const key = a.email.toLowerCase()
        if (own.has(key) || seen.has(key)) return false
        seen.add(key)
        return true
      })
    : []
  return { to, cc, identity }
}
export function mailtoDraft(url: string): Partial<Draft> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'mailto:') throw new Error('Only email links are supported.')
  return {
    to: parseAddresses(decodeURIComponent(parsed.pathname)),
    cc: parseAddresses(parsed.searchParams.get('cc') || ''),
    bcc: parseAddresses(parsed.searchParams.get('bcc') || ''),
    subject: parsed.searchParams.get('subject') || '',
    text: parsed.searchParams.get('body') || '',
  }
}
export function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Something went wrong. Please try again.'
}
/** The first HTTPS (or else mailto) List-Unsubscribe target, never one carrying credentials. */
export function parseUnsubscribe(value?: string, post?: string): Message['unsubscribe'] {
  if (!value) return
  const matches = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1])
  const url =
    matches.find((s) => s.startsWith('https://')) || matches.find((s) => s.startsWith('mailto:'))
  if (!url) return
  try {
    const u = new URL(url)
    if (u.username || u.password) return
    return {
      url,
      oneClick: u.protocol === 'https:' && /List-Unsubscribe=One-Click/i.test(post || ''),
    }
  } catch {
    return
  }
}
