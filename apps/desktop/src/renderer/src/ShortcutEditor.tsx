import { cn } from '@inlark/ui'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Button, IconButton, Modal } from '@inlark/ui'
import { friendlyError } from '@inlark/core'
import { AlertCircle, Plus, Search, Undo2, X } from '@inlark/ui/icons'
import {
  bindingName,
  chordFromEvent,
  defaultBindings,
  findConflicts,
  isCustomized,
  sameBinding,
  shortcutDefinitions,
  shortcutSections,
  useShortcuts,
  ShortcutKeys,
  type Binding,
  type ShortcutBindings,
  type ShortcutConflict,
  type ShortcutDefinition,
  type ShortcutId,
} from './shortcuts'

/** How long a single key waits for a second one, so sequences like G then I can be recorded. */
const sequenceWait = 1000

const shortcutName = (definition: ShortcutDefinition) =>
  definition.section === 'Go to' ? 'Go to ' + definition.label : definition.label
const nameOf = (id: ShortcutId) =>
  shortcutName(shortcutDefinitions.find((definition) => definition.id === id)!)

/** A plain character may be the first key of a sequence; anything with Ctrl or Alt finishes at once. */
const canStartSequence = (chord: string) => /^(Shift\+)?.$/u.test(chord)

/** Captures the next shortcut pressed, before anything else in the app can react to it. */
function ShortcutRecorder({
  label,
  onRecord,
  onCancel,
}: {
  label: string
  onRecord: (binding: Binding) => void
  onCancel: () => void
}) {
  const [steps, setSteps] = useState<Binding>([])
  const ref = useRef<HTMLSpanElement>(null)
  const state = useRef({ steps, done: false, onRecord, onCancel })
  state.current.onRecord = onRecord
  state.current.onCancel = onCancel
  useEffect(() => {
    ref.current?.focus()
    let timer: number | undefined
    const finish = (binding?: Binding) => {
      window.clearTimeout(timer)
      if (state.current.done) return
      state.current.done = true
      if (binding?.length) state.current.onRecord(binding)
      else state.current.onCancel()
    }
    const listener = (event: KeyboardEvent) => {
      // Tab still moves focus, which finishes recording.
      if (event.key === 'Tab') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return
      if (event.key === 'Escape') return finish()
      const chord = chordFromEvent(event)
      if (!chord) return
      window.clearTimeout(timer)
      const next = [...state.current.steps, chord]
      if (next.length > 1 || !canStartSequence(chord)) return finish(next)
      state.current.steps = next
      setSteps(next)
      timer = window.setTimeout(() => finish(next), sequenceWait)
    }
    window.addEventListener('keydown', listener, true)
    return () => {
      window.removeEventListener('keydown', listener, true)
      window.clearTimeout(timer)
    }
  }, [])
  return (
    <span
      ref={ref}
      tabIndex={0}
      role="textbox"
      aria-label={'Press a new shortcut for ' + label}
      className={cn(
        'shortcut-recorder relative overflow-hidden inline-flex items-center gap-1 h-6 my-0 mx-[2px] py-0 px-2.25',
        'text-[11px] text-primary bg-primary-tint border border-solid border-primary-solid rounded-md',
        'shadow-[0_0_0_3px_var(--accent-tint)] animate-[shortcut-listen_1.6s_ease-in-out_infinite]',
        'focus-visible:outline-none [&_kbd]:text-primary [&_kbd]:border-primary/40 [&_.shortcut-then]:text-inherit',
        'motion-reduce:animate-none',
      )}
      onBlur={() => {
        if (state.current.done) return
        state.current.done = true
        if (state.current.steps.length) onRecord(state.current.steps)
        else onCancel()
      }}
    >
      {steps.length ? (
        <>
          <ShortcutKeys binding={steps} />
          <span className="shortcut-then my-0 mx-[1px] text-[10px] text-faint">then…</span>
          <span
            className="shortcut-recorder-timer inset-x-0 bottom-0 origin-left animate-[shortcut-timer_linear_forwards] absolute h-[2px] bg-primary-solid"
            style={{ animationDuration: sequenceWait + 'ms' }}
          />
        </>
      ) : (
        'Press keys…'
      )}
    </span>
  )
}

type Recording = { id: ShortcutId; index?: number }
type Notice =
  | { id: ShortcutId; kind: 'recording' }
  | { id: ShortcutId; kind: 'duplicate' }
  | {
      id: ShortcutId
      kind: 'conflict'
      index?: number
      binding: Binding
      conflicts: ShortcutConflict[]
    }

/**
 * Lists every shortcut with all of its keys. Click keys to change them, add more with +, and
 * restore the defaults per shortcut or all at once. Changes save immediately.
 */
export function ShortcutEditor({ autoFocus }: { autoFocus?: boolean }) {
  const { bindings, save } = useShortcuts()
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<Recording>()
  const [notice, setNotice] = useState<Notice>()
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string>()
  const persist = (next: ShortcutBindings) => {
    setError(undefined)
    save(next).catch((e) => setError(friendlyError(e)))
  }
  const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())
  const elementId = (id: ShortcutId, index?: number) =>
    'shortcut-' + id + '-' + (index === undefined ? 'add' : index)

  const apply = (
    id: ShortcutId,
    change: (current: Binding[]) => Binding[],
    taken: ShortcutConflict[] = [],
  ) => {
    const next: ShortcutBindings = { ...bindings }
    for (const conflict of taken)
      next[conflict.id] = next[conflict.id].filter((b) => !sameBinding(b, conflict.binding))
    next[id] = change(next[id])
    persist(next)
  }
  const place = (index: number | undefined, binding: Binding) => (current: Binding[]) =>
    index === undefined
      ? [...current, binding]
      : current.map((existing, i) => (i === index ? binding : existing))

  const record = ({ id, index }: Recording, binding: Binding) => {
    setRecording(undefined)
    setNotice(undefined)
    focus(elementId(id, index))
    const current = bindings[id]
    if (index !== undefined && sameBinding(current[index], binding)) return
    if (current.some((existing, i) => i !== index && sameBinding(existing, binding)))
      return setNotice({ id, kind: 'duplicate' })
    const conflicts = findConflicts(bindings, id, binding)
    if (conflicts.length) return setNotice({ id, kind: 'conflict', index, binding, conflicts })
    apply(id, place(index, binding))
  }
  const startRecording = (next: Recording) => {
    setRecording(next)
    setNotice({ id: next.id, kind: 'recording' })
  }
  const restore = (id: ShortcutId) => {
    const defaults = defaultBindings(id)
    // Defaults win back keys that were handed to another shortcut in the meantime.
    apply(
      id,
      () => defaults,
      defaults.flatMap((binding) => findConflicts(bindings, id, binding)),
    )
    setNotice(undefined)
  }

  const search = query.trim().toLowerCase()
  const matches = shortcutDefinitions.filter((definition) =>
    [definition.label, definition.section, 'description' in definition && definition.description]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(search)),
  )
  const customized = shortcutDefinitions.some(({ id }) => isCustomized(bindings, id))

  return (
    <div className="shortcut-editor flex flex-col gap-4.5">
      <div className="shortcut-toolbar flex items-center gap-2.5 [&>.button]:shrink-0 [&>.button]:text-secondary">
        <label
          className={cn(
            'shortcut-search flex-1 flex items-center gap-2 h-8 py-0 px-2.5 text-muted bg-field border border-solid',
            'border-border-strong rounded-[7px] transition-[border-color,box-shadow] duration-120 ease-[ease]',
            'focus-within:border-primary-solid focus-within:shadow-[0_0_0_3px_var(--accent-tint)] [&_input]:h-full',
            '[&_input]:p-0 [&_input]:text-[12px] [&_input]:bg-none [&_input]:bg-transparent [&_input]:border-0',
            '[&_input::-webkit-search-cancel-button]:hidden',
          )}
        >
          <Search size={14} />
          <input
            autoFocus={autoFocus}
            type="search"
            value={query}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Clear the search first; a second Escape closes the dialog.
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            }}
          />
        </label>
        {customized && (
          <Button size="small" variant="ghost" onClick={() => setConfirmReset(true)}>
            <Undo2 size={13} />
            Restore all defaults
          </Button>
        )}
      </div>
      {error && (
        <p
          className="form-error flex gap-2 text-[11px] leading-[1.6] text-danger [&_svg]:shrink-0 [&_svg]:mt-[3px] shortcut-error m-0"
          role="alert"
        >
          <AlertCircle size={14} />
          <span>Couldn’t save your shortcuts. {error}</span>
        </p>
      )}
      <div
        className={cn(
          'shortcut-sections [columns:2_280px] [&_section]:break-inside-avoid [&_section]:mb-5.5 [&_h3]:mt-0 [&_h3]:mb-1',
          '[&_h3]:mx-0 gap-x-9',
        )}
      >
        {shortcutSections.map((section) => {
          const items = matches.filter((definition) => definition.section === section)
          if (!items.length) return null
          return (
            <section key={section}>
              <h3 className="mt-0 mb-1 mx-0 text-[11px] font-medium text-muted [.settings-content_&]:tracking-[-0.5px]">
                {section}
              </h3>
              {items.map((definition) => {
                const { id } = definition
                const name = shortcutName(definition)
                const list = bindings[id]
                const rowNotice = notice?.id === id ? notice : undefined
                return (
                  <div
                    className={cn(
                      'shortcut-item [&:hover_.shortcut-add]:opacity-100 [&:focus-within_.shortcut-add]:opacity-100 break-inside-avoid',
                      'border-b border-solid border-b-border',
                      recording?.id === id && 'shortcut-item-recording',
                    )}
                    key={id}
                  >
                    <div className="shortcut-row flex items-center justify-between gap-3 min-h-8.5 text-[12px] text-secondary">
                      <span className="shortcut-label [&_small]:text-[10px] [&_small]:text-faint flex flex-col min-w-0 py-1.5 px-0">
                        {definition.label}
                        {'description' in definition && <small>{definition.description}</small>}
                      </span>
                      <span
                        className={cn(
                          'shortcut-bindings [&>.button]:w-6 [&>.button]:h-6 [&>.button]:min-h-6 [&>.button]:p-1 [&>.button]:text-muted',
                          '[&>.shortcut-reset]:text-primary flex flex-wrap items-center justify-end gap-[2px] py-1 px-0',
                        )}
                      >
                        {list.map((binding, index) =>
                          recording?.id === id && recording.index === index ? (
                            <ShortcutRecorder
                              key={index}
                              label={name}
                              onRecord={(next) => record({ id, index }, next)}
                              onCancel={() => {
                                setRecording(undefined)
                                setNotice(undefined)
                                focus(elementId(id, index))
                              }}
                            />
                          ) : (
                            <span
                              className={cn(
                                'shortcut-binding [&:hover_.shortcut-remove]:opacity-100 [&:hover_.shortcut-remove]:transform-none',
                                '[&:focus-within_.shortcut-remove]:opacity-100 [&:focus-within_.shortcut-remove]:transform-none relative',
                                'inline-flex',
                              )}
                              key={index}
                            >
                              <button
                                id={elementId(id, index)}
                                className={cn(
                                  'shortcut-binding-keys inline-flex items-center p-[3px] bg-none bg-transparent border-0 rounded-md',
                                  'transition-[background] duration-120 ease-[ease] hover:bg-hover focus-visible:bg-hover',
                                  'focus-visible:outline-offset-[0] [&_kbd]:transition-[color,border-color] [&_kbd]:duration-120',
                                  '[&_kbd]:ease-[ease] [&:hover_kbd]:text-foreground [&:hover_kbd]:border-muted',
                                  '[&:focus-visible_kbd]:text-foreground [&:focus-visible_kbd]:border-muted',
                                )}
                                aria-label={'Change ' + bindingName(binding) + ' for ' + name}
                                onClick={() => startRecording({ id, index })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Backspace' || event.key === 'Delete') {
                                    event.preventDefault()
                                    apply(id, (current) => current.filter((_, i) => i !== index))
                                    focus(elementId(id, list.length > 1 ? 0 : undefined))
                                  }
                                }}
                              >
                                <ShortcutKeys binding={binding} />
                              </button>
                              <button
                                className={cn(
                                  'shortcut-remove absolute top-[-3px] right-[-3px] grid place-items-center w-3.5 h-3.5 p-0 text-muted bg-raised',
                                  'border border-solid border-border-strong rounded-full opacity-0 transform-[scale(0.8)]',
                                  'transition-[opacity,transform,color] duration-120 ease-[ease] hover:text-danger hover:border-danger/45',
                                )}
                                aria-label={'Remove ' + bindingName(binding) + ' from ' + name}
                                title="Remove"
                                onClick={() => {
                                  apply(id, (current) => current.filter((_, i) => i !== index))
                                  setNotice(undefined)
                                }}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ),
                        )}
                        {recording?.id === id && recording.index === undefined ? (
                          <ShortcutRecorder
                            label={name}
                            onRecord={(next) => record({ id }, next)}
                            onCancel={() => {
                              setRecording(undefined)
                              setNotice(undefined)
                              focus(elementId(id))
                            }}
                          />
                        ) : list.length ? (
                          <IconButton
                            id={elementId(id)}
                            className="shortcut-add opacity-0 transition-[opacity] duration-120 ease-[ease]"
                            label={'Add another shortcut'}
                            aria-label={'Add a shortcut for ' + name}
                            onClick={() => startRecording({ id })}
                          >
                            <Plus size={13} />
                          </IconButton>
                        ) : (
                          <button
                            id={elementId(id)}
                            className={cn(
                              'shortcut-empty inline-flex items-center gap-1 h-6 py-0 px-2 text-[11px] text-faint bg-none bg-transparent',
                              'border border-dashed border-border-strong rounded-md transition-[color,border-color] duration-120 ease-[ease]',
                              'hover:text-foreground hover:border-muted',
                            )}
                            aria-label={'Add a shortcut for ' + name}
                            onClick={() => startRecording({ id })}
                          >
                            <Plus size={12} />
                            Add shortcut
                          </button>
                        )}
                        {isCustomized(bindings, id) && (
                          <IconButton
                            className="shortcut-reset"
                            label="Restore default"
                            aria-label={'Restore the default shortcut for ' + name}
                            onClick={() => restore(id)}
                          >
                            <Undo2 size={13} />
                          </IconButton>
                        )}
                      </span>
                    </div>
                    {rowNotice?.kind === 'recording' && (
                      <p
                        className="shortcut-notice mt-0 mb-2.5 mx-0 text-[11px] leading-[1.7] text-muted [&_kbd]:h-4 [&_kbd]:min-w-4 [&_kbd]:text-[9px]"
                        role="status"
                      >
                        Press the keys you want to use, or Esc to cancel. For a sequence like{' '}
                        <ShortcutKeys binding={['G', 'I']} />, press the second key right after the
                        first.
                      </p>
                    )}
                    {rowNotice?.kind === 'duplicate' && (
                      <p
                        className="shortcut-notice mt-0 mb-2.5 mx-0 text-[11px] leading-[1.7] text-muted [&_kbd]:h-4 [&_kbd]:min-w-4 [&_kbd]:text-[9px]"
                        role="status"
                      >
                        That’s already a shortcut for {name}.
                      </p>
                    )}
                    {rowNotice?.kind === 'conflict' && (
                      <div
                        className={cn(
                          'shortcut-notice mt-0 mb-2.5 mx-0 text-[11px] leading-[1.7] [&_kbd]:h-4 [&_kbd]:min-w-4 [&_kbd]:text-[9px]',
                          'shortcut-conflict flex flex-wrap items-center gap-[8px_12px] py-2 px-2.5 text-secondary bg-star/7 border',
                          'border-solid border-star/22 rounded-[7px] [&_p]:flex-[1_1_180px] [&_p]:m-0 [&_strong]:font-medium',
                          '[&_strong]:text-strong',
                        )}
                        role="alert"
                      >
                        <p>
                          <ShortcutKeys binding={rowNotice.binding} /> conflicts with{' '}
                          {rowNotice.conflicts.map((conflict, index) => (
                            <Fragment key={conflict.id + index}>
                              {index > 0 && ', '}
                              <strong>{nameOf(conflict.id)}</strong>
                              {rowNotice.conflicts.length === 1 &&
                                !sameBinding(conflict.binding, rowNotice.binding) && (
                                  <>
                                    {' '}
                                    (<ShortcutKeys binding={conflict.binding} />)
                                  </>
                                )}
                            </Fragment>
                          ))}
                          .
                        </p>
                        <span className="shortcut-conflict-actions flex gap-1.5 ml-auto">
                          <Button
                            size="small"
                            variant="ghost"
                            onClick={() => {
                              setNotice(undefined)
                              focus(elementId(id, rowNotice.index))
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="small"
                            onClick={() => {
                              apply(
                                id,
                                place(rowNotice.index, rowNotice.binding),
                                rowNotice.conflicts,
                              )
                              setNotice(undefined)
                              focus(elementId(id, rowNotice.index))
                            }}
                          >
                            Use for {name}
                          </Button>
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
        {!matches.length && (
          <p className="shortcut-no-results m-0 py-7 px-0 text-[12px] text-center text-muted">
            No shortcuts match “{query.trim()}”.
          </p>
        )}
      </div>
      <Modal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore default shortcuts?"
        description="Every shortcut goes back to its original keys. Your changes are removed."
      >
        <div
          className={cn(
            'modal-actions flex justify-end gap-2 mt-6 [&>.modal-action-start]:mr-auto [&>.modal-action-start]:-ml-2.5',
            '[&>.modal-action-start]:text-muted [&>.modal-action-start:hover:not(:disabled)]:text-danger',
          )}
        >
          <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              persist(
                Object.fromEntries(
                  shortcutDefinitions.map(({ id }) => [id, defaultBindings(id)]),
                ) as ShortcutBindings,
              )
              setNotice(undefined)
              setConfirmReset(false)
            }}
          >
            Restore defaults
          </Button>
        </div>
      </Modal>
    </div>
  )
}
