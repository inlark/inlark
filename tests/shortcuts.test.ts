import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useHotkeys,
  useHotkeySequences,
} from '../apps/desktop/node_modules/@tanstack/react-hotkeys'
import {
  defaultBindings,
  findConflicts,
  ignoreInputsForCommand,
  overridesFor,
  resolveShortcuts,
  shortcutDefinitions,
  useShortcutHandlers,
} from '../apps/desktop/src/renderer/src/shortcuts'

vi.mock('../apps/desktop/node_modules/@tanstack/react-hotkeys', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../apps/desktop/node_modules/@tanstack/react-hotkeys')
  >()),
  useHotkeys: vi.fn(),
  useHotkeySequences: vi.fn(),
}))

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

describe('shortcut input priority', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps select-all and undo shortcuts out of focused fields', () => {
    useShortcutHandlers(resolveShortcuts(), {
      selectAll: { run: vi.fn() },
      undo: { run: vi.fn() },
    })
    const hotkeys = vi.mocked(useHotkeys).mock.calls[0][0]
    for (const hotkey of ['Mod+A', 'Mod+Z', 'Z'])
      expect(hotkeys.find((definition) => definition.hotkey === hotkey)?.options).toMatchObject({
        ignoreInputs: true,
        enabled: true,
      })
  })

  it('also protects fields from customized modifier shortcuts and sequences', () => {
    useShortcutHandlers(
      resolveShortcuts({ trash: [['Mod+Backspace']], archive: [['Mod+E', 'A']] }),
      { trash: { run: vi.fn() }, archive: { run: vi.fn() } },
    )
    expect(vi.mocked(useHotkeys).mock.calls[0][0][0]).toMatchObject({
      hotkey: 'Mod+Backspace',
      options: { ignoreInputs: true },
    })
    expect(vi.mocked(useHotkeySequences).mock.calls[0][0][0]).toMatchObject({
      sequence: ['Mod+E', 'A'],
      options: { ignoreInputs: true },
    })
  })

  it('allows deliberate field commands while keeping their custom typing bindings quiet', () => {
    useShortcutHandlers(
      resolveShortcuts({ send: [['Mod+Enter'], ['S'], ['Shift+S'], ['Alt+S'], ['Mod+S', 'S']] }),
      { send: { run: vi.fn(), ignoreInputs: ignoreInputsForCommand } },
    )
    const hotkeys = vi.mocked(useHotkeys).mock.calls[0][0]
    expect(hotkeys.find((definition) => definition.hotkey === 'Mod+Enter')?.options).toMatchObject({
      ignoreInputs: false,
    })
    for (const hotkey of ['S', 'Shift+S', 'Alt+S'])
      expect(hotkeys.find((definition) => definition.hotkey === hotkey)?.options).toMatchObject({
        ignoreInputs: true,
      })
    expect(vi.mocked(useHotkeySequences).mock.calls[0][0][0].options?.ignoreInputs).toBe(true)
    expect(ignoreInputsForCommand(['Ctrl+Enter'])).toBe(false)
    expect(ignoreInputsForCommand(['Meta+Enter'])).toBe(false)
    expect(ignoreInputsForCommand(['Escape'])).toBe(false)
  })
})
