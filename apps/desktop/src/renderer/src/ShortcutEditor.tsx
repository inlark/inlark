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
      className="shortcut-recorder"
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
          <span className="shortcut-then">then…</span>
          <span
            className="shortcut-recorder-timer"
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
    <div className="shortcut-editor">
      <div className="shortcut-toolbar">
        <label className="shortcut-search">
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
        <p className="form-error shortcut-error" role="alert">
          <AlertCircle size={14} />
          <span>Couldn’t save your shortcuts. {error}</span>
        </p>
      )}
      <div className="shortcut-sections">
        {shortcutSections.map((section) => {
          const items = matches.filter((definition) => definition.section === section)
          if (!items.length) return null
          return (
            <section key={section}>
              <h3>{section}</h3>
              {items.map((definition) => {
                const { id } = definition
                const name = shortcutName(definition)
                const list = bindings[id]
                const rowNotice = notice?.id === id ? notice : undefined
                return (
                  <div
                    className={
                      'shortcut-item' + (recording?.id === id ? ' shortcut-item-recording' : '')
                    }
                    key={id}
                  >
                    <div className="shortcut-row">
                      <span className="shortcut-label">
                        {definition.label}
                        {'description' in definition && <small>{definition.description}</small>}
                      </span>
                      <span className="shortcut-bindings">
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
                            <span className="shortcut-binding" key={index}>
                              <button
                                id={elementId(id, index)}
                                className="shortcut-binding-keys"
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
                                className="shortcut-remove"
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
                            className="shortcut-add"
                            label={'Add another shortcut'}
                            aria-label={'Add a shortcut for ' + name}
                            onClick={() => startRecording({ id })}
                          >
                            <Plus size={13} />
                          </IconButton>
                        ) : (
                          <button
                            id={elementId(id)}
                            className="shortcut-empty"
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
                      <p className="shortcut-notice" role="status">
                        Press the keys you want to use, or Esc to cancel. For a sequence like{' '}
                        <ShortcutKeys binding={['G', 'I']} />, press the second key right after the
                        first.
                      </p>
                    )}
                    {rowNotice?.kind === 'duplicate' && (
                      <p className="shortcut-notice" role="status">
                        That’s already a shortcut for {name}.
                      </p>
                    )}
                    {rowNotice?.kind === 'conflict' && (
                      <div className="shortcut-notice shortcut-conflict" role="alert">
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
                        <span className="shortcut-conflict-actions">
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
          <p className="shortcut-no-results">No shortcuts match “{query.trim()}”.</p>
        )}
      </div>
      <Modal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore default shortcuts?"
        description="Every shortcut goes back to its original keys. Your changes are removed."
      >
        <div className="modal-actions">
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
