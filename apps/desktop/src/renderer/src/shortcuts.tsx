import { Fragment, createContext, useContext } from 'react'
import {
  detectPlatform,
  formatForDisplay,
  normalizeHotkey,
  normalizeRegisterableHotkey,
  parseKeyboardEvent,
  useHotkeys,
  useHotkeySequences,
  validateHotkey,
  type Hotkey,
  type UseHotkeyDefinition,
  type UseHotkeySequenceDefinition,
} from '@tanstack/react-hotkeys'

/** One way to trigger a shortcut: a single chord such as `Mod+K`, or a sequence such as `G I`. */
export type Binding = string[]

export const shortcutSections = ['Navigate', 'Go to', 'Organize', 'Select', 'Write', 'App'] as const

export const shortcutDefinitions = [
  { id: 'next', section: 'Navigate', label: 'Next conversation', defaults: [['J'], ['ArrowDown']] },
  {
    id: 'previous',
    section: 'Navigate',
    label: 'Previous conversation',
    defaults: [['K'], ['ArrowUp']],
  },
  { id: 'open', section: 'Navigate', label: 'Open conversation', defaults: [['Enter'], ['O']] },
  {
    id: 'back',
    section: 'Navigate',
    label: 'Back to list',
    description: 'Also clears the selection or search.',
    defaults: [['Escape']],
  },
  { id: 'search', section: 'Navigate', label: 'Search mail', defaults: [['/']] },
  { id: 'commandMenu', section: 'Navigate', label: 'Command menu', defaults: [['Mod+K']] },
  { id: 'toggleSidebar', section: 'Navigate', label: 'Toggle sidebar', defaults: [['[']] },
  { id: 'goInbox', section: 'Go to', label: 'Inbox', defaults: [['G', 'I']] },
  { id: 'goStarred', section: 'Go to', label: 'Starred', defaults: [['G', 'S']] },
  { id: 'goSent', section: 'Go to', label: 'Sent', defaults: [['G', 'T']] },
  { id: 'goDrafts', section: 'Go to', label: 'Drafts', defaults: [['G', 'D']] },
  { id: 'goArchive', section: 'Go to', label: 'Archive', defaults: [['G', 'A']] },
  { id: 'archive', section: 'Organize', label: 'Archive', defaults: [['E']] },
  {
    id: 'trash',
    section: 'Organize',
    label: 'Move to trash',
    description: 'In Drafts, deletes the selected drafts.',
    defaults: [['#'], ['Backspace'], ['Delete']],
  },
  { id: 'spam', section: 'Organize', label: 'Mark as spam', defaults: [['!']] },
  { id: 'move', section: 'Organize', label: 'Move to folder', defaults: [['V']] },
  {
    id: 'unsubscribe',
    section: 'Organize',
    label: 'Unsubscribe from mailing list',
    defaults: [['Mod+U']],
  },
  { id: 'star', section: 'Organize', label: 'Star or unstar', defaults: [['S']] },
  { id: 'unread', section: 'Organize', label: 'Mark as unread', defaults: [['U'], ['Shift+U']] },
  { id: 'read', section: 'Organize', label: 'Mark as read', defaults: [['Shift+I']] },
  { id: 'undo', section: 'Organize', label: 'Undo last action', defaults: [['Z'], ['Mod+Z']] },
  { id: 'select', section: 'Select', label: 'Select conversation', defaults: [['X']] },
  { id: 'selectRange', section: 'Select', label: 'Select a range', defaults: [['Shift+X']] },
  { id: 'selectAll', section: 'Select', label: 'Select all loaded', defaults: [['Mod+A']] },
  { id: 'compose', section: 'Write', label: 'Compose', defaults: [['C']] },
  { id: 'reply', section: 'Write', label: 'Reply', defaults: [['R']] },
  { id: 'replyAll', section: 'Write', label: 'Reply all', defaults: [['A']] },
  { id: 'forward', section: 'Write', label: 'Forward', defaults: [['F']] },
  { id: 'send', section: 'Write', label: 'Send message', defaults: [['Mod+Enter']] },
  { id: 'settings', section: 'App', label: 'Open settings', defaults: [['Mod+,']] },
  { id: 'shortcuts', section: 'App', label: 'Keyboard shortcuts', defaults: [['?']] },
] as const satisfies readonly {
  id: string
  section: (typeof shortcutSections)[number]
  label: string
  description?: string
  defaults: readonly (readonly string[])[]
}[]

export type ShortcutId = (typeof shortcutDefinitions)[number]['id']
export type ShortcutDefinition = (typeof shortcutDefinitions)[number]
export type ShortcutBindings = Record<ShortcutId, Binding[]>
/** Saved changes from the defaults, keyed by shortcut. An empty list means “no shortcut”. */
export type ShortcutOverrides = Record<string, Binding[]>

export const platform = detectPlatform()

const definitionById = new Map<string, ShortcutDefinition>(
  shortcutDefinitions.map((definition) => [definition.id, definition]),
)
export const defaultBindings = (id: ShortcutId): Binding[] =>
  definitionById.get(id)!.defaults.map((binding) => [...binding])

const bindingKey = (binding: Binding) =>
  binding.map((chord) => normalizeHotkey(chord as Hotkey, platform)).join(' ')
export const sameBinding = (a: Binding, b: Binding) => bindingKey(a) === bindingKey(b)
const sameBindings = (a: Binding[], b: Binding[]) =>
  a.length === b.length && a.every((binding, index) => sameBinding(binding, b[index]))

export function resolveShortcuts(overrides: ShortcutOverrides = {}): ShortcutBindings {
  return Object.fromEntries(
    shortcutDefinitions.map(({ id }) => {
      // Skip malformed keys so one bad saved value can't break registering the rest.
      const saved = overrides[id]?.filter((binding) =>
        binding.every((chord) => validateHotkey(chord as Hotkey).valid),
      )
      return [id, saved || defaultBindings(id)]
    }),
  ) as ShortcutBindings
}

/** Records only what differs from the defaults, so improved defaults still reach everyone else. */
export function overridesFor(bindings: ShortcutBindings): ShortcutOverrides {
  return Object.fromEntries(
    shortcutDefinitions
      .filter(({ id }) => !sameBindings(bindings[id], defaultBindings(id)))
      .map(({ id }) => [id, bindings[id]]),
  )
}

export const isCustomized = (bindings: ShortcutBindings, id: ShortcutId) =>
  !sameBindings(bindings[id], defaultBindings(id))

/** The keys of one chord as they read on this platform, such as `['⌘', 'K']` or `['Ctrl', 'K']`. */
export const chordKeys = (chord: string) =>
  formatForDisplay(chord as Hotkey, { platform, parts: true })

/** A compact label for tooltips and menus, such as `Ctrl K` or `G I`. */
export const bindingText = (binding: Binding) =>
  binding.map((chord) => chordKeys(chord).join(' ')).join(' ')

/** Reads a binding aloud, such as “Control K” or “G then I”. */
export const bindingName = (binding: Binding) =>
  binding
    .map((chord) =>
      formatForDisplay(chord as Hotkey, { platform, useSymbols: false, parts: true }).join(' '),
    )
    .join(' then ')

/**
 * The chord a keydown produces, or nothing for keys that can't start a shortcut yet (modifiers,
 * dead keys, composition). Characters are recorded rather than key positions so `#` and `?` mean
 * the same thing on every layout.
 */
export function chordFromEvent(event: KeyboardEvent): string | undefined {
  if (event.isComposing || ['Dead', 'Unidentified', 'Process', 'AltGraph'].includes(event.key))
    return
  const parsed = parseKeyboardEvent(event, platform)
  if (!parsed.key || ['Control', 'Shift', 'Alt', 'Meta'].includes(parsed.key)) return
  let key = parsed.key
  let { ctrl, alt } = parsed
  // AltGr types characters; it is not a Ctrl+Alt shortcut.
  if (event.getModifierState?.('AltGraph')) ctrl = alt = false
  // Option and Alt change the character a key types, so use the key's position for letters and digits.
  const position = /^Key([A-Z])$|^Digit(\d)$/.exec(event.code)
  if (alt && position) key = position[1] || position[2]
  // Shift is part of a character such as # or ? on some layouts and not others; matching allows both.
  const shift = parsed.shift && !(key.length === 1 && !/\p{Letter}/u.test(key))
  const chord = normalizeRegisterableHotkey(
    { key, ctrl, alt, shift, meta: parsed.meta },
    platform,
  ) as string
  return validateHotkey(chord as Hotkey).valid ? chord : undefined
}

export type ShortcutConflict = { id: ShortcutId; binding: Binding }

/**
 * Other shortcuts that would fire instead of, or alongside, this binding: the same keys, or a
 * sequence that one starts with the other.
 */
export function findConflicts(
  bindings: ShortcutBindings,
  id: ShortcutId,
  binding: Binding,
): ShortcutConflict[] {
  const keys = binding.map((chord) => bindingKey([chord]))
  return shortcutDefinitions.flatMap(({ id: other }) =>
    other === id
      ? []
      : bindings[other]
          .filter((existing) => {
            const steps = existing.map((chord) => bindingKey([chord]))
            const length = Math.min(steps.length, keys.length)
            return steps.slice(0, length).join(' ') === keys.slice(0, length).join(' ')
          })
          .map((existing) => ({ id: other, binding: existing })),
  )
}

export type ShortcutsValue = {
  bindings: ShortcutBindings
  /** Shows the change at once, and puts it back (and rejects) if it cannot be saved. */
  save: (bindings: ShortcutBindings) => Promise<void>
}
export const ShortcutsContext = createContext<ShortcutsValue>({
  bindings: resolveShortcuts(),
  save: async () => {},
})

export const useShortcuts = () => useContext(ShortcutsContext)

/** The label of a shortcut's first binding, for tooltips and hints. */
export function useShortcutText() {
  const { bindings } = useShortcuts()
  return (id: ShortcutId) => {
    const first = bindings[id][0]
    return first ? bindingText(first) : undefined
  }
}

export type ShortcutHandler = {
  run: () => void
  /** Defaults to the hook's `enabled`. */
  enabled?: boolean
  ignoreInputs?: boolean
}

/** Registers every binding of each handled shortcut. */
export function useShortcutHandlers(
  bindings: ShortcutBindings,
  handlers: Partial<Record<ShortcutId, ShortcutHandler>>,
  enabled = true,
) {
  const hotkeys: UseHotkeyDefinition[] = []
  const sequences: UseHotkeySequenceDefinition[] = []
  for (const [id, handler] of Object.entries(handlers) as [ShortcutId, ShortcutHandler][]) {
    const options = {
      conflictBehavior: 'replace',
      enabled: handler.enabled ?? enabled,
      ...(handler.ignoreInputs !== undefined && { ignoreInputs: handler.ignoreInputs }),
    } as const
    for (const binding of bindings[id]) {
      if (binding.length === 1)
        hotkeys.push({ hotkey: binding[0] as Hotkey, callback: handler.run, options })
      else sequences.push({ sequence: binding as Hotkey[], callback: handler.run, options })
    }
  }
  useHotkeys(hotkeys)
  useHotkeySequences(sequences)
}

/** The keys of a binding, with “then” between the steps of a sequence. */
export function ShortcutKeys({ binding, className }: { binding: Binding; className?: string }) {
  return (
    <span className={'shortcut-keys' + (className ? ' ' + className : '')}>
      {binding.map((chord, step) => (
        <Fragment key={step}>
          {step > 0 && <span className="shortcut-then">then</span>}
          {chordKeys(chord).map((key, index) => (
            <kbd key={index}>{key}</kbd>
          ))}
        </Fragment>
      ))}
    </span>
  )
}

/** The first keys of a shortcut, or nothing when it has none. */
export function ShortcutHint({ id, className }: { id: ShortcutId; className?: string }) {
  const binding = useShortcuts().bindings[id][0]
  return binding ? <ShortcutKeys binding={binding} className={className} /> : null
}
