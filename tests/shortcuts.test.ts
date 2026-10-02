import { describe, expect, it } from 'vitest'
import {
  defaultBindings,
  findConflicts,
  overridesFor,
  resolveShortcuts,
  shortcutDefinitions,
} from '../apps/desktop/src/renderer/src/shortcuts'

describe('shortcut defaults and saved preferences', () => {
  it('has no conflicting default chords or sequence prefixes', () => {
    const bindings = resolveShortcuts()
    for (const { id } of shortcutDefinitions)
      for (const binding of bindings[id]) expect(findConflicts(bindings, id, binding)).toEqual([])
  })

  it('adds new actions without changing existing customized or disabled shortcuts', () => {
    const saved = { archive: [['W']], trash: [], goInbox: [['G', 'H']] }
    const bindings = resolveShortcuts(saved)
    expect(bindings.archive).toEqual(saved.archive)
    expect(bindings.trash).toEqual([])
    expect(bindings.goInbox).toEqual(saved.goInbox)
    expect(bindings.refresh).toEqual([['Mod+R'], ['F5']])
    expect(bindings.goSpam).toEqual([['G', 'J']])
    expect(bindings.attachFiles).toEqual([['Mod+Shift+A']])
    expect(overridesFor(bindings)).toEqual(saved)
  })

  it('round-trips customized refresh bindings and opt-in actions', () => {
    const saved = { refresh: [['Mod+Shift+R'], ['G', 'R']], createFolder: [['Shift+C']] }
    expect(overridesFor(resolveShortcuts(saved))).toEqual(saved)
    expect(resolveShortcuts({ refresh: [] }).refresh).toEqual([])
    expect(defaultBindings('refresh')).toEqual([['Mod+R'], ['F5']])
  })

  it('gives saved assignments priority over conflicting new defaults', () => {
    const bindings = resolveShortcuts({ archive: [['Mod+R']], compose: [['G', 'J']] })
    expect(bindings.archive).toEqual([['Mod+R']])
    expect(bindings.compose).toEqual([['G', 'J']])
    expect(bindings.refresh).toEqual([['F5']])
    expect(bindings.goSpam).toEqual([])
    expect(resolveShortcuts({ archive: [['G']] }).goTrash).toEqual([])
    // Removing that customization makes the default available again.
    expect(resolveShortcuts().refresh).toEqual(defaultBindings('refresh'))
  })

  it('detects conflicts when assigning new actions to existing keys or sequences', () => {
    const bindings = resolveShortcuts()
    expect(findConflicts(bindings, 'refresh', ['R'])).toEqual([{ id: 'reply', binding: ['R'] }])
    expect(findConflicts(bindings, 'createFolder', ['G'])).toContainEqual({
      id: 'goTrash',
      binding: ['G', 'B'],
    })
  })
})
