import { describe, it, expect } from 'vitest'
import {
  accountKey,
  unlinkedServerDrafts,
  scopeKey,
  conversationFromMessages,
  mergePages,
  replyRecipients,
  replyTarget,
  parseAddresses,
  mailtoDraft,
  draftSchema,
  sendDraftSchema,
  defaultSettings,
  identityKey,
  identitySignature,
  settingsSchema,
  appearanceSchema,
  nextAccountColor,
  accountColors,
  type Message,
  type Draft,
} from '../packages/core/src'
export const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'message',
  accountId: 'account',
  threadId: 'thread',
  subject: 'Hello',
  from: [{ name: 'Friend', email: 'friend@example.com' }],
  to: [{ name: 'Me', email: 'me@example.com' }],
  cc: [],
  bcc: [],
  replyTo: [],
  receivedAt: '2026-09-23T10:00:00Z',
  preview: 'Hello',
  keywords: {},
  mailboxIds: { inbox: true },
  size: 100,
  hasAttachment: false,
  ...overrides,
})
export const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17',
  accountId: 'account',
  identityId: 'identity',
  to: [{ name: 'Friend', email: 'friend@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: [],
  updatedAt: '2026-09-23T10:00:00.000Z',
  status: 'local',
  ...overrides,
})
describe('mail domain', () => {
  it('keeps identical remote IDs in different connections and accounts separate', () => {
    const a = accountKey('connection-a', 'same'),
      b = accountKey('connection-b', 'same')
    expect(scopeKey(a, 'same')).not.toBe(scopeKey(b, 'same'))
    expect(scopeKey('a,b', 'c')).not.toBe(scopeKey('a', 'b,c'))
  })
  it('offers every remote draft version without opening a related sent message', () => {
    const local = message({ id: 'local', keywords: { $draft: true } })
    const conflict = message({ id: 'conflict', keywords: { $draft: true } })
    const sent = message({ id: 'sent', keywords: { $seen: true } })
    const other = message({ id: 'local', accountId: 'other', keywords: { $draft: true } })
    const conversations = [
      conversationFromMessages('account', 'thread', [sent, local, conflict]),
      conversationFromMessages('other', 'thread', [other]),
    ]
    expect(
      unlinkedServerDrafts(conversations, [draft({ serverId: 'local' })]).map((m) =>
        scopeKey(m.accountId, m.id),
      ),
    ).toEqual([scopeKey('account', 'conflict'), scopeKey('other', 'local')])
  })
  it('replies to the newest sent or received message, never to an unsent draft', () => {
    const first = message({ id: 'first' })
    const answer = message({ id: 'answer', receivedAt: '2026-09-23T11:00:00Z' })
    const reply = message({
      id: 'reply',
      receivedAt: '2026-09-23T12:00:00Z',
      keywords: { $draft: true, $seen: true },
    })
    expect(replyTarget([first, answer, reply])?.id).toBe('answer')
    expect(replyTarget([reply])).toBeUndefined()
  })
  it('lists only the people who wrote, not the author of an unsent draft', () => {
    const received = message({ id: 'received' })
    const reply = message({
      id: 'reply',
      from: [{ name: 'Me', email: 'me@example.com' }],
      receivedAt: '2026-09-23T12:00:00Z',
      keywords: { $draft: true, $seen: true },
    })
    expect(
      conversationFromMessages('account', 'thread', [received, reply]).from.map((a) => a.email),
    ).toEqual(['friend@example.com'])
    expect(conversationFromMessages('account', 'thread', [reply]).from.map((a) => a.email)).toEqual(
      ['me@example.com'],
    )
  })
  it('merges pages without skipping unconsumed messages from another account', () => {
    const conv = (a: string, id: string, time: string) =>
      conversationFromMessages(a, id, [message({ accountId: a, threadId: id, receivedAt: time })])
    const page = mergePages(
      [
        {
          accountId: 'a',
          position: 0,
          page: {
            items: [
              conv('a', 'a1', '2026-09-23T11:00:00Z'),
              conv('a', 'a2', '2026-09-23T09:00:00Z'),
            ],
            total: 2,
          },
        },
        {
          accountId: 'b',
          position: 0,
          page: {
            items: [
              conv('b', 'b1', '2026-09-23T10:00:00Z'),
              conv('b', 'b2', '2026-09-23T08:00:00Z'),
            ],
            total: 2,
          },
        },
      ],
      2,
    )
    expect(page.items.map((c) => c.id)).toEqual(['a1', 'b1'])
    expect(page.next).toEqual({ a: 1, b: 1 })
  })
  it('derives unread/starred state from the entire conversation', () => {
    const c = conversationFromMessages('a', 't', [
      message({ keywords: { $seen: true }, receivedAt: '2026-09-23T12:00:00Z' }),
      message({ keywords: { $flagged: true }, receivedAt: '2026-09-22T12:00:00Z' }),
    ])
    expect(c.unread).toBe(true)
    expect(c.starred).toBe(true)
    expect(c.count).toBe(2)
  })
  it('selects the receiving identity and excludes own aliases from reply-all', () => {
    const m = message({
      to: [
        { name: '', email: 'alias@example.com' },
        { name: '', email: 'colleague@example.com' },
      ],
      cc: [{ name: '', email: 'me@example.com' }],
    })
    const result = replyRecipients(
      m,
      [
        { id: 'main', accountId: 'account', name: 'Me', email: 'me@example.com' },
        { id: 'alias', accountId: 'account', name: 'Me', email: 'alias@example.com' },
      ],
      true,
    )
    expect(result.identity?.id).toBe('alias')
    expect(result.cc.map((a) => a.email)).toEqual(['colleague@example.com'])
  })
  it('parses quoted recipient names and mailto fields', () => {
    expect(parseAddresses('"Chen, Maya" <maya@example.com>; alex@example.com')).toEqual([
      { name: 'Chen, Maya', email: 'maya@example.com' },
      { name: '', email: 'alex@example.com' },
    ])
    expect(
      mailtoDraft('mailto:a@example.com?subject=Hello%20world&body=Line%201%0ALine%202').text,
    ).toBe('Line 1\nLine 2')
  })
  it('autosaves incomplete addresses but disallows sending them', () => {
    const incomplete = draft({ to: [{ name: '', email: 'typing@' }] })
    expect(draftSchema.safeParse(incomplete).success).toBe(true)
    expect(sendDraftSchema.safeParse(incomplete).success).toBe(false)
    expect(sendDraftSchema.safeParse(draft()).success).toBe(true)
  })
})

describe('five-account pagination acceptance fixture', () => {
  it('visits 250,000 distinct conversations in globally descending order with bounded per-account windows', () => {
    const count = 50_000,
      accounts = ['a', 'b', 'c', 'd', 'e']
    let cursor: Record<string, number> | undefined
    let seen = 0
    let previous = '9999'
    const ids = new Set<string>()
    do {
      const pages = accounts
        .filter((a) => !cursor || a in cursor)
        .map((a, accountIndex) => {
          const position = cursor?.[a] || 0
          const items = Array.from({ length: Math.min(50, count - position) }, (_, offset) => {
            const index = position + offset,
              time = new Date(
                Date.UTC(2026, 8, 23) - index * 60_000 - accountIndex * 1000,
              ).toISOString()
            return conversationFromMessages(a, String(index), [
              message({ accountId: a, threadId: String(index), receivedAt: time }),
            ])
          })
          return {
            accountId: a,
            position,
            page: { items, total: count, next: position + 50 < count ? position + 50 : undefined },
          }
        })
      const page = mergePages(pages, 50)
      for (const item of page.items) {
        expect(item.receivedAt <= previous).toBe(true)
        previous = item.receivedAt
        ids.add(item.key)
      }
      seen += page.items.length
      cursor = page.next
    } while (cursor)
    expect(seen).toBe(250_000)
    expect(ids.size).toBe(250_000)
  }, 15000)
})

describe('account appearance', () => {
  it('accepts a pattern seed and a small raster picture and rejects anything else', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(appearanceSchema.safeParse({}).success).toBe(true)
    expect(appearanceSchema.safeParse({ seed: 'a1b2c3d4', image: png }).success).toBe(true)
    expect(appearanceSchema.safeParse({ seed: '' }).success).toBe(false)
    expect(
      appearanceSchema.safeParse({ image: 'data:image/svg+xml;base64,PHN2Zz4=' }).success,
    ).toBe(false)
    expect(appearanceSchema.safeParse({ image: 'https://example.com/me.png' }).success).toBe(false)
    expect(appearanceSchema.safeParse({ image: png + 'A'.repeat(256 * 1024) }).success).toBe(false)
  })
  it('gives new accounts a colour no other account uses yet', () => {
    expect(nextAccountColor([])).toBe(accountColors[1])
    expect(nextAccountColor([accountColors[1], accountColors[2].toUpperCase()])).toBe(
      accountColors[3],
    )
  })
})

describe('signatures', () => {
  const identity = { accountId: 'a', id: 'i' }
  const key = identityKey('a', 'i')

  it('prefers the signature written in Inlark, in the format it was written in', () => {
    const server = { ...identity, textSignature: 'Server', htmlSignature: '<b>Server</b>' }
    expect(identitySignature({ signatures: { [key]: 'Paul' } }, server)).toEqual({
      format: 'text',
      value: 'Paul',
    })
    expect(
      identitySignature(
        { signatures: { [key]: '<b>Paul</b>' }, htmlSignatures: { [key]: true } },
        server,
      ),
    ).toEqual({ format: 'html', value: '<b>Paul</b>' })
    // Clearing a signature is a choice, not a reason to fall back to the server's.
    expect(identitySignature({ signatures: { [key]: '' } }, server).value).toBe('')
  })

  it('falls back to the server identity, preferring its HTML signature', () => {
    expect(identitySignature(defaultSettings, { ...identity, htmlSignature: '<i>Hi</i>' })).toEqual(
      { format: 'html', value: '<i>Hi</i>' },
    )
    expect(
      identitySignature(defaultSettings, { ...identity, textSignature: 'Hi', htmlSignature: ' ' }),
    ).toEqual({ format: 'text', value: 'Hi' })
    expect(identitySignature(defaultSettings, identity)).toEqual({ format: 'text', value: '' })
  })

  it('accepts settings saved before the system title bar preference existed', () => {
    const { systemTitleBar: _, ...legacySettings } = defaultSettings
    expect(settingsSchema.parse(legacySettings)).toEqual(legacySettings)
    expect(settingsSchema.parse(legacySettings).systemTitleBar).toBeUndefined()
  })

  it('accepts settings saved before HTML signatures existed', () => {
    expect(settingsSchema.parse({ ...defaultSettings, signatures: { [key]: 'Paul' } })).toEqual({
      ...defaultSettings,
      signatures: { [key]: 'Paul' },
    })
  })
})
