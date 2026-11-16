import { describe, expect, it } from 'vitest'
import type { Draft, Mailbox } from '@inlark/core'
import {
  draftMatches,
  locationOptions,
  matchesWords,
  widerLocation,
} from '../apps/desktop/src/renderer/src/search-scope'

const views = [
  { id: 'inbox', title: 'Inbox' },
  { id: 'starred', title: 'Starred' },
  { id: 'sent', title: 'Sent' },
  { id: 'drafts', title: 'Drafts' },
  { id: 'archive', title: 'Archive' },
  { id: 'junk', title: 'Spam' },
  { id: 'trash', title: 'Trash' },
] as const
const accounts = [
  { id: 'work', name: 'Work' },
  { id: 'home', name: 'Personal' },
]
const box = (accountId: string, id: string, name: string, role: string | null = null) =>
  ({ id, accountId, name, role }) as Mailbox
const boxesByAccount = {
  work: [box('work', 'w-inbox', 'Inbox', 'inbox'), box('work', 'w-receipts', 'Receipts')],
  home: [box('home', 'h-sent', 'Sent', 'sent'), box('home', 'h-trips', 'Trips')],
}

describe('widening a search', () => {
  it('goes from a folder or view to all mail in the same account', () => {
    expect(widerLocation({ view: 'sent', account: 'home' }, 2)).toEqual({
      label: 'Search all mail',
      location: { view: 'all', account: 'home' },
    })
    expect(widerLocation({ view: 'all', account: 'work', folder: 'w-receipts' }, 2)).toEqual({
      label: 'Search all mail',
      location: { view: 'all', account: 'work' },
    })
    expect(widerLocation({ view: 'starred' }, 1)?.location).toEqual({ view: 'all' })
  })

  it('then to every account, and no further', () => {
    expect(widerLocation({ view: 'all', account: 'home' }, 2)).toEqual({
      label: 'Search all accounts',
      location: { view: 'all' },
    })
    expect(widerLocation({ view: 'all', account: 'home' }, 1)).toBeUndefined()
    expect(widerLocation({ view: 'all' }, 2)).toBeUndefined()
  })
})

describe('folder picker options', () => {
  it('offers every view but Drafts, then the folders of each account', () => {
    const { value, options } = locationOptions({
      location: { view: 'sent' },
      views,
      accounts,
      boxesByAccount,
      currentLabel: 'Sent',
    })
    expect(value).toBe('view:sent')
    expect(options.map((o) => [o.label, o.group])).toEqual([
      ['All mail', undefined],
      ['Inbox', undefined],
      ['Starred', undefined],
      ['Sent', undefined],
      ['Archive', undefined],
      ['Spam', undefined],
      ['Trash', undefined],
      ['Receipts', 'Work'],
      ['Trips', 'Personal'],
    ])
    // A folder belongs to one account, so choosing it narrows to that account too.
    expect(options.find((o) => o.label === 'Trips')?.location).toEqual({
      view: 'all',
      account: 'home',
      folder: 'h-trips',
    })
    expect(options.find((o) => o.label === 'Archive')?.location).toEqual({ view: 'archive' })
  })

  it('keeps the chosen account and lists only its folders', () => {
    const { value, options } = locationOptions({
      location: { view: 'all', account: 'work', folder: 'w-receipts' },
      views,
      accounts,
      boxesByAccount,
      currentLabel: 'Receipts',
    })
    expect(options.find((o) => o.value === value)?.label).toBe('Receipts')
    expect(options.filter((o) => o.group).map((o) => [o.label, o.group])).toEqual([
      ['Receipts', 'Folders'],
    ])
    expect(options.find((o) => o.label === 'Sent')?.location).toEqual({
      view: 'sent',
      account: 'work',
    })
  })

  it('still names the current place while its folders are loading', () => {
    const { value, options } = locationOptions({
      location: { view: 'all', account: 'work', folder: 'w-new' },
      views,
      accounts,
      boxesByAccount: {},
      currentLabel: 'New',
    })
    expect(options.find((o) => o.value === value)).toMatchObject({
      label: 'New',
      location: { view: 'all', account: 'work', folder: 'w-new' },
    })
  })

  it('ignores an account that was removed', () => {
    const { options } = locationOptions({
      location: { view: 'inbox', account: 'gone' },
      views,
      accounts,
      boxesByAccount,
      currentLabel: 'Inbox',
    })
    expect(options.find((o) => o.label === 'Inbox')?.location).toEqual({ view: 'inbox' })
  })
})

describe('matching drafts on this device', () => {
  const draft = {
    subject: 'Quarterly invoice',
    to: [{ name: 'Ada Lovelace', email: 'ada@example.com' }],
    cc: [],
    bcc: [{ name: '', email: 'books@example.org' }],
    text: 'Attached is the March statement.',
  } as unknown as Draft

  it('needs every word somewhere in the subject, recipients or text', () => {
    expect(draftMatches(draft, 'invoice')).toBe(true)
    expect(draftMatches(draft, 'INVOICE ada')).toBe(true)
    expect(draftMatches(draft, 'books@example')).toBe(true)
    expect(draftMatches(draft, 'march statement')).toBe(true)
    expect(draftMatches(draft, 'invoice april')).toBe(false)
  })

  it('matches everything for an empty search', () => {
    expect(matchesWords(['anything'], '   ')).toBe(true)
    expect(matchesWords([undefined, ''], 'x')).toBe(false)
  })
})
