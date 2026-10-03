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

  it('offers every moving action in All mail, folders and search', () => {
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
