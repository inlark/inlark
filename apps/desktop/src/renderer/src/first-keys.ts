/**
 * The few keys inlark teaches someone who has just connected their first account. It is not a
 * tour: each step is done on the person's own mail, in any order, and noticed when it happens.
 * What it remembers stays on this device.
 */
export const firstKeySteps = ['move', 'open', 'archive', 'commands'] as const
export type FirstKeyStep = (typeof firstKeySteps)[number]

export interface FirstKeysState {
  /** `active` while the card is offered; `closed` once it was finished, closed or ignored. */
  phase?: 'active' | 'closed'
  /** Steps already done, by keyboard or mouse. */
  done: FirstKeyStep[]
  /** Launches the card was offered in, so one that is ignored goes away by itself. */
  launches: number
}

/** An ignored card is offered in this many launches, then never again. */
export const firstKeysRules = { launches: 3 } as const

export const emptyFirstKeys: FirstKeysState = { done: [], launches: 0 }

const fresh = (): FirstKeysState => ({ phase: 'active', done: [], launches: 1 })

/**
 * Offers the card once a first account is connected. Someone who already closed it, or who
 * removed their accounts and connected again, isn't taught twice.
 */
export function startFirstKeys(state: FirstKeysState): FirstKeysState {
  return state.phase ? state : fresh()
}

/** Offers the card again from the start, when it is asked for. */
export function restartFirstKeys(): FirstKeysState {
  return fresh()
}

export function completeFirstKey(state: FirstKeysState, step: FirstKeyStep): FirstKeysState {
  if (state.phase !== 'active' || state.done.includes(step)) return state
  return { ...state, done: [...state.done, step] }
}

export function closeFirstKeys(state: FirstKeysState): FirstKeysState {
  return state.phase === 'active' ? { ...state, phase: 'closed' } : state
}

/**
 * The steps still to do, in the order they are taught. `untaught` names steps whose shortcut was
 * removed: with no key to show they are passed over, never asked for.
 */
export const remainingFirstKeys = (
  state: FirstKeysState,
  untaught: readonly FirstKeyStep[] = [],
): FirstKeyStep[] =>
  firstKeySteps.filter((step) => !state.done.includes(step) && !untaught.includes(step))

export const firstKeysFinished = (state: FirstKeysState, untaught?: readonly FirstKeyStep[]) =>
  !remainingFirstKeys(state, untaught).length

/** The step the card shows: the first one still to do, or nothing once none is left. */
export const nextFirstKey = (
  state: FirstKeysState,
  untaught?: readonly FirstKeyStep[],
): FirstKeyStep | undefined => remainingFirstKeys(state, untaught)[0]

/**
 * Counts steps that were passed over as done. Used once the rest are, so the next launch can
 * tell the card was finished without knowing which shortcuts exist.
 */
export const skipFirstKeys = (state: FirstKeysState, steps: readonly FirstKeyStep[]) =>
  steps.reduce(completeFirstKey, state)

/**
 * Counts a launch. A card that was finished isn't shown again, and neither is one that was left
 * alone for several launches: it is an offer, not a reminder.
 */
export function resumeFirstKeys(state: FirstKeysState): FirstKeysState {
  if (state.phase !== 'active') return state
  if (firstKeysFinished(state) || state.launches >= firstKeysRules.launches)
    return { ...state, phase: 'closed' }
  return { ...state, launches: state.launches + 1 }
}

/** Accepts only well-formed saved state, so a damaged entry starts over instead of failing. */
export function parseFirstKeys(text: string | null): FirstKeysState {
  if (!text) return emptyFirstKeys
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyFirstKeys
    const done = Array.isArray(value.done)
      ? firstKeySteps.filter((step) => (value.done as unknown[]).includes(step))
      : []
    const launches =
      typeof value.launches === 'number' && Number.isInteger(value.launches) && value.launches >= 0
        ? value.launches
        : 0
    return {
      phase: value.phase === 'active' || value.phase === 'closed' ? value.phase : undefined,
      done,
      launches,
    }
  } catch {
    return emptyFirstKeys
  }
}

const storageKey = 'first-keys'
const listeners = new Set<() => void>()
let current: FirstKeysState | undefined

const save = (state: FirstKeysState) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    /* Without storage the card still works for this launch. */
  }
}

/** The saved state, counted once as a launch the first time it is read. */
export function firstKeysSnapshot(): FirstKeysState {
  if (!current) {
    const saved = parseFirstKeys(localStorage.getItem(storageKey))
    current = resumeFirstKeys(saved)
    if (current !== saved) save(current)
  }
  return current
}

export function subscribeFirstKeys(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function updateFirstKeys(change: (state: FirstKeysState) => FirstKeysState): void {
  const previous = firstKeysSnapshot()
  const next = change(previous)
  if (next === previous) return
  current = next
  save(next)
  for (const listener of listeners) listener()
}

/** Notes that a step happened. It costs nothing when the card isn't being offered. */
export const noteFirstKey = (step: FirstKeyStep) =>
  updateFirstKeys((state) => completeFirstKey(state, step))
