import { describe, expect, it, vi } from 'vitest'
import { offersAction } from '../apps/desktop/src/renderer/src/view-actions'

describe('actions offered per view', () => {
  it('leaves out actions that would change nothing where the conversation already is', () => {
    expect(offersAction('archive', 'archive')).toBe(false)
    expect(offersAction('trash', 'trash')).toBe(false)
    expect(offersAction('junk', 'spam')).toBe(false)
    expect(offersAction('inbox', 'restore')).toBe(false)
    expect(offersAction('inbox', 'notSpam')).toBe(false)
  })

  it('offers permanent deletion only in Trash', () => {
    expect(offersAction('trash', 'destroy')).toBe(true)
    expect(offersAction('inbox', 'destroy')).toBe(false)
    expect(offersAction('all', 'destroy')).toBe(false)
  })

  it('offers every moving action in All mail and folders', () => {
    for (const action of ['archive', 'trash', 'spam', 'notSpam', 'restore'] as const)
      expect(offersAction('all', action)).toBe(true)
  })
})

describe('action wording', async () => {
  vi.stubGlobal('location', { search: '', protocol: 'file:' })
  vi.stubGlobal('window', {})
  const { confirmActionCopy } = await import('../apps/desktop/src/renderer/src/AppDialogs')
  const { emptyListState } = await import('../apps/desktop/src/renderer/src/empty-states')
  const { matchFolders } = await import('../apps/desktop/src/renderer/src/MoveDialog')
  vi.unstubAllGlobals()

  it('names the action and how many conversations it reaches', () => {
    expect(confirmActionCopy('archive', 1234)).toMatchObject({
      title: 'Archive all ' + (1234).toLocaleString() + ' conversations?',
      confirm: 'Archive',
    })
    expect(confirmActionCopy('read', 2).title).toBe('Mark all 2 conversations as read?')
    expect(confirmActionCopy('destroy', 1)).toMatchObject({
      title: 'Delete this conversation permanently?',
      confirm: 'Delete permanently',
    })
  })

  it('quotes the shortcut the user actually has, or none when it was removed', () => {
    expect(
      emptyListState('starred', { searching: false, unreadOnly: false, keys: () => 'L' })
        .description,
    ).toBe('Press L to star the selected conversation.')
    expect(
      emptyListState('starred', { searching: false, unreadOnly: false, keys: () => undefined })
        .description,
    ).not.toMatch(/Press/)
  })

  it('names the folder a search missed in, so it is not read as a miss everywhere', () => {
    expect(emptyListState('sent', { searching: true, unreadOnly: false, scope: 'Sent' })).toEqual(
      expect.objectContaining({
        title: 'No results in Sent',
        description: 'Try a different search or adjust your filters.',
      }),
    )
    expect(emptyListState('all', { searching: true, unreadOnly: false }).title).toBe(
      'No conversations found',
    )
    expect(
      emptyListState('drafts', { searching: true, unreadOnly: false, scope: 'Drafts' }).description,
    ).toBe('Try a different search.')
  })

  it('says mail is still arriving instead of calling a list empty during a first sync', () => {
    const idle = { searching: false, unreadOnly: false }
    expect(
      emptyListState('inbox', { ...idle, syncing: { names: ['Personal'], only: true } }),
    ).toMatchObject({
      title: 'Bringing in your mail',
      description: 'Your mail is still being indexed. Conversations appear here as they arrive.',
    })
    // An account is named only when there are others to tell it from.
    expect(
      emptyListState('archive', { ...idle, syncing: { names: ['Studio'], only: false } })
        .description,
    ).toMatch(/^Studio is still being indexed\./)
    expect(
      emptyListState('inbox', { ...idle, syncing: { names: ['Studio', 'Personal'], only: false } })
        .description,
    ).toMatch(/^Some accounts are still being indexed\./)
    // Once nothing is syncing, an empty inbox is simply empty.
    expect(emptyListState('inbox', { ...idle, syncing: { names: [], only: true } }).title).toBe(
      'You’re all caught up',
    )
    // A search or filter that finds nothing says so, whatever is still arriving.
    expect(
      emptyListState('inbox', {
        searching: true,
        unreadOnly: false,
        syncing: { names: ['Personal'], only: true },
      }).title,
    ).toBe('No conversations found')
    expect(
      emptyListState('inbox', {
        searching: false,
        unreadOnly: true,
        syncing: { names: ['Personal'], only: true },
      }).title,
    ).toBe('No unread conversations')
  })

  it('finds folders by any part of their name, word starts first', () => {
    const folders = [{ name: 'Archive' }, { name: 'Receipts' }, { name: 'Projects' }]
    expect(matchFolders(folders, 'r').map((f) => f.name)).toEqual([
      'Receipts',
      'Archive',
      'Projects',
    ])
    expect(matchFolders(folders, 'PRO').map((f) => f.name)).toEqual(['Projects'])
    expect(matchFolders(folders, '  ')).toBe(folders)
    expect(matchFolders(folders, 'zzz')).toEqual([])
  })
})
