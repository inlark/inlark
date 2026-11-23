import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { Button, IconButton, cn } from '@inlark/ui'
import { Check, X } from '@inlark/ui/icons'
import {
  closeFirstKeys,
  firstKeySteps,
  firstKeysSnapshot,
  nextFirstKey,
  skipFirstKeys,
  subscribeFirstKeys,
  updateFirstKeys,
  type FirstKeyStep,
} from './first-keys'
import {
  ShortcutHint,
  chordKeys,
  useShortcutText,
  useShortcuts,
  type ShortcutId,
} from './shortcuts'

/** What each step asks for, and the shortcuts whose keys it shows. */
const lessons: Record<FirstKeyStep, { shortcuts: ShortcutId[]; title: string }> = {
  move: { shortcuts: ['next', 'previous'], title: 'Move through your inbox' },
  open: { shortcuts: ['open'], title: 'Open a conversation' },
  archive: { shortcuts: ['archive'], title: 'Archive a conversation' },
  commands: { shortcuts: ['commandMenu'], title: 'Find any command' },
}

/** How long a finished step stays on screen, acknowledged, before the next one replaces it. */
const acknowledgeMs = 900

/**
 * A few keys worth knowing, offered above Settings after a first account is connected. Each one
 * is tried on the person's own mail and ticks itself off when it happens, whether a key or the
 * mouse did it. It can be closed at any time, and comes back only when asked for.
 */
export function FirstKeysCard({
  quiet,
  canAddAccount,
  onAddAccount,
  onShortcuts,
}: {
  /** The sidebar is collapsed or reporting a problem, which matters more than this. */
  quiet: boolean
  canAddAccount: boolean
  onAddAccount: () => void
  onShortcuts: () => void
}) {
  const state = useSyncExternalStore(subscribeFirstKeys, firstKeysSnapshot)
  const { bindings } = useShortcuts()
  const keys = useShortcutText()
  const titleId = useId()
  const active = state.phase === 'active'
  // A step whose shortcut was removed has no key to teach, so it is never the one shown.
  const untaught = firstKeySteps.filter((step) =>
    lessons[step].shortcuts.every((id) => !bindings[id].length),
  )
  const steps = firstKeySteps.filter((step) => !untaught.includes(step))
  const target = active ? nextFirstKey(state, untaught) : undefined
  // The step on screen lags behind the one to do next, so a step just done can be acknowledged.
  const [shown, setShown] = useState(target)
  // Worked out from what is stored rather than remembered, so starting over or closing can never
  // leave a “Done” behind on a step that isn't.
  const acknowledged = active && !!shown && shown !== target && state.done.includes(shown)
  useEffect(() => {
    if (shown === target) return
    if (!acknowledged) return setShown(target)
    const timer = window.setTimeout(() => setShown(target), acknowledgeMs)
    return () => window.clearTimeout(timer)
  }, [shown, target, acknowledged])
  const finished = active && !target
  // Both of these follow the stored state, so they hold again after the card is started over.
  useEffect(() => {
    if (!active) return
    // With no key left to teach, there is nothing to offer.
    if (!steps.length) updateFirstKeys(closeFirstKeys)
    // Once the steps with a key are done, the others count too: the next launch then knows the
    // card was finished, whatever shortcuts exist by then.
    else if (finished) updateFirstKeys((current) => skipFirstKeys(current, untaught))
  }, [active, finished, state, untaught.join(' ')])
  if (!active || quiet || !steps.length) return null
  const lesson = shown && lessons[shown]
  const caps = lesson
    ? lesson.shortcuts.flatMap((id) => (bindings[id][0] || []).flatMap(chordKeys))
    : []
  const detail: Record<FirstKeyStep, string> = {
    move: 'Down and up, one conversation at a time.',
    open: keys('back')
      ? keys('back') + ' brings you back to the list.'
      : 'Then go back to the list for the next one.',
    archive: keys('undo')
      ? 'For mail you’re done with. ' + keys('undo') + ' undoes it.'
      : 'For mail you’re done with. It stays in search.',
    commands: 'Every action, with its shortcut beside it.',
  }
  return (
    <section
      className={cn(
        'first-keys relative mb-2 mx-0.5 rounded-lg border border-solid border-border-strong bg-surface',
        'pt-2.5 pb-3 pl-3 pr-2.5 text-[12px] leading-[1.45] shadow-[0_1px_2px_#0000000f]',
        'animate-[rise-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] [@media(max-height:620px)]:hidden',
      )}
      aria-labelledby={titleId}
    >
      <div className="flex items-center gap-2 min-h-5.5">
        <strong id={titleId} className="flex-1 min-w-0 font-medium text-secondary">
          {lesson ? 'Keys worth knowing' : 'That’s the essentials'}
        </strong>
        <IconButton
          className="w-5.5 h-5.5 min-h-5.5 p-0 -mr-1 text-faint"
          label="Close"
          onClick={() => updateFirstKeys(closeFirstKeys)}
        >
          <X size={12} />
        </IconButton>
      </div>
      {/* Announced as it changes, so a step done by key is confirmed without looking here. */}
      <div role="status">
        {lesson ? (
          <div key={shown} className="animate-[rise-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
            <div className="flex items-center gap-1.5 h-7 mt-2">
              {caps.map((cap, index) => (
                <kbd
                  key={index}
                  className={cn(
                    'min-w-7 h-7 px-2 rounded-md bg-field text-[12px] font-medium text-strong',
                    'shadow-[inset_0_-1px_0_var(--border-strong)] transition-[color,background,border-color] duration-200',
                    acknowledged && 'border-primary/55 bg-primary-tint text-primary',
                  )}
                >
                  {cap}
                </kbd>
              ))}
              {acknowledged && (
                <span className="inline-flex items-center gap-1 ml-1 text-[11px] text-primary animate-[rise-in_240ms_ease-out_both]">
                  <Check size={12} />
                  Done
                </span>
              )}
            </div>
            <p className="mt-2.5 mb-0 mx-0 font-medium text-strong">{lesson.title}</p>
            {/* Two lines whatever the step says, so the sidebar doesn't shift between steps. */}
            <p className="mt-0.5 mb-0 mx-0 min-h-[33px] text-[11px] leading-[1.5] text-muted">
              {detail[shown]}
            </p>
          </div>
        ) : (
          <div className="animate-[rise-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
            <p className="mt-1.5 mb-0 mx-0 text-[11px] leading-[1.6] text-muted">
              {keys('shortcuts') ? (
                <>
                  Press <ShortcutHint id="shortcuts" className="mx-0.5 align-[-1px]" /> to see every
                  shortcut, whenever you want one.
                </>
              ) : (
                'Every shortcut is listed in the command menu and in Settings.'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-1 mt-2.5">
              <Button size="small" className="min-w-0" onClick={onShortcuts}>
                Shortcuts
              </Button>
              {canAddAccount && (
                <Button size="small" variant="ghost" className="min-w-0" onClick={onAddAccount}>
                  Add account
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <div
        className="flex gap-1 mt-3 mr-0.5"
        role="progressbar"
        aria-label="Keys tried"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={steps.filter((step) => state.done.includes(step)).length}
      >
        {steps.map((step) => (
          <span
            key={step}
            className={cn(
              'flex-1 h-[3px] rounded-[2px] bg-border-strong transition-[background] duration-300 ease-[ease]',
              state.done.includes(step) && 'bg-primary',
            )}
          />
        ))}
      </div>
    </section>
  )
}
