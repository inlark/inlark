import { describe, expect, it } from 'vitest'
import { conversationFromMessages, type MailAction, type Message } from '../packages/core/src'
import {
  forgettable,
  isLeaving,
  leavesList,
  listConversations,
  targetKey,
  withPendingFlags,
  type ListPage,
  type PendingChange,
} from '../apps/desktop/src/renderer/src/pending-changes'

const message = (accountId: string, threadId: string, keywords: Message['keywords'] = {}) => ({
  id: threadId + '-message',
  accountId,
  threadId,
  subject: 'Hello',
  from: [{ name: 'Friend', email: 'friend@example.com' }],
  to: [{ name: 'Me', email: 'me@example.com' }],
  cc: [],
  bcc: [],
  replyTo: [],
  receivedAt: '2026-11-26T10:00:00Z',
  preview: 'Hello',
  keywords,
  mailboxIds: { inbox: true },
  size: 100,
  hasAttachment: false,
})
const conversation = (accountId: string, threadId: string, keywords: Message['keywords'] = {}) =>
  conversationFromMessages(accountId, threadId, [message(accountId, threadId, keywords)])

let ids = 0
const change = (
  action: MailAction,
  targets: [string, string][],
  state: Partial<PendingChange> = {},
): PendingChange => ({
  id: ++ids,
  action,
  keys: new Set(targets.map(([accountId, threadId]) => targetKey({ accountId, threadId }))),
  list: 'inbox',
  ...state,
})

const personal1 = conversation('personal', '1')
const studio1 = conversation('studio', '1')
const personal2 = conversation('personal', '2', { $seen: true })
const page = (requestedAt?: number, items = [personal1, studio1, personal2]): ListPage => ({
  items,
  total: items.length,
  failedAccounts: [],
  requestedAt,
})
const keys = (pages: ListPage[], pending: PendingChange[], list = 'inbox') =>
  listConversations(pages, pending, list).map((c) => c.key)

describe('actions the window shows before the server confirms them', () => {
  it('names conversations the way the list keys them', () => {
    expect(targetKey({ accountId: 'studio', threadId: '1' })).toBe(studio1.key)
  })

  it('keeps a removed conversation out of lists asked for before the server answered', () => {
    const trashed = [change('trash', [['studio', '1']], { answeredAt: 100 })]
    // A reload that set out too early, a list kept from before, or one restored from disk.
    for (const requestedAt of [50, 99.5, undefined])
      expect(keys([page(requestedAt)], trashed)).toEqual([personal1.key, personal2.key])
    // Not yet answered, even a list asked for a moment ago can't show it.
    expect(keys([page(500)], [change('trash', [['studio', '1']])])).toEqual([
      personal1.key,
      personal2.key,
    ])
  })

  it('shows what the server did in lists asked for after it answered', () => {
    // Moving this conversation failed, so the server still lists it, and so does the window.
    const failed = [change('trash', [['studio', '1']], { answeredAt: 100, settled: true })]
    expect(keys([page(101)], failed)).toEqual([personal1.key, studio1.key, personal2.key])
  })

  it('judges each page by when it was asked for', () => {
    const trashed = [change('trash', [['studio', '1']], { answeredAt: 100 })]
    expect(keys([page(150, [personal1]), page(50, [studio1, personal2])], trashed)).toEqual([
      personal1.key,
      personal2.key,
    ])
    // Listed again on a page asked for since, it's what the server says now, whichever came first.
    for (const pages of [
      [page(150, [personal1, studio1]), page(50, [studio1, personal2])],
      [page(50, [personal1, studio1]), page(150, [studio1, personal2])],
    ])
      expect(keys(pages, trashed)).toContain(studio1.key)
  })

  it('takes conversations out only of the list they were removed from', () => {
    const archived = [change('archive', [['personal', '1']], { list: 'inbox' })]
    expect(keys([page(1)], archived, 'inbox')).toEqual([studio1.key, personal2.key])
    // All mail and Archive may well list it.
    expect(keys([page(1)], archived, 'all')).toEqual([personal1.key, studio1.key, personal2.key])
  })

  it('tells apart conversations with the same thread ID in different accounts', () => {
    expect(keys([page(1)], [change('archive', [['personal', '1']])])).toEqual([
      studio1.key,
      personal2.key,
    ])
  })

  it('shows read and starred changes in every list', () => {
    const shown = listConversations(
      [page(1)],
      [
        change('read', [['personal', '1']]),
        change('unread', [['personal', '2']], { list: 'elsewhere' }),
        change('star', [['studio', '1']]),
      ],
      'inbox',
    )
    expect(shown.map((c) => [c.unread, c.starred])).toEqual([
      [false, false],
      [true, true],
      [true, false],
    ])
  })

  it('applies changes in the order they were made', () => {
    const shown = listConversations(
      [page(1)],
      [change('star', [['personal', '1']]), change('unstar', [['personal', '1']])],
      'inbox',
    )
    expect(shown[0].starred).toBe(false)
  })

  it('lists a conversation that appears on two pages once', () => {
    expect(keys([page(1, [personal1, studio1]), page(2, [studio1, personal2])], [])).toEqual([
      personal1.key,
      studio1.key,
      personal2.key,
    ])
  })

  it('shows read and star changes in the open conversation until the window has reloaded', () => {
    const key = targetKey({ accountId: 'studio', threadId: '1' })
    const messages = [message('studio', '1'), message('studio', '1', { $flagged: true })]
    const starred = withPendingFlags(messages, [change('star', [['studio', '1']])], key)
    expect(starred.every((m) => m.keywords.$flagged)).toBe(true)
    // A second press of the star undoes the first.
    const toggled = withPendingFlags(
      messages,
      [change('star', [['studio', '1']]), change('unstar', [['studio', '1']])],
      key,
    )
    expect(toggled.some((m) => m.keywords.$flagged)).toBe(false)
    expect(
      withPendingFlags(messages, [change('read', [['studio', '1']], { settled: true })], key),
    ).toBe(messages)
    expect(withPendingFlags(messages, [change('star', [['personal', '1']])], key)).toBe(messages)
  })

  it('acts on a conversation again only once the server answered its removal', () => {
    const target = { accountId: 'studio', threadId: '1' }
    expect(isLeaving([change('move', [['studio', '1']])], target)).toBe(true)
    expect(isLeaving([change('read', [['studio', '1']])], target)).toBe(false)
    // If the server couldn't move it, it's listed again and can be tried again.
    expect(isLeaving([change('move', [['studio', '1']], { answeredAt: 1 })], target)).toBe(false)
  })

  it('forgets a change once the window reloaded and its list was asked for since', () => {
    const answered = change('trash', [['studio', '1']], { answeredAt: 100 })
    expect(forgettable(answered, [page(150)])).toBe(false)
    const settled = { ...answered, settled: true }
    expect(forgettable(settled, [page(150), page(50)])).toBe(false)
    expect(forgettable(settled, [page(150), page(160)])).toBe(true)
    // The list it was made in is no longer kept.
    expect(forgettable(settled, undefined)).toBe(true)
  })

  it('counts only actions that move conversations elsewhere as leaving the list', () => {
    const leaving: MailAction[] = ['archive', 'trash', 'spam', 'move', 'destroy']
    const staying: MailAction[] = ['read', 'unread', 'star', 'unstar', 'restore', 'notSpam']
    expect(leaving.every(leavesList)).toBe(true)
    expect(staying.some(leavesList)).toBe(false)
  })
})
