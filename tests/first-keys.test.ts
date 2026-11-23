import { describe, expect, it } from 'vitest'
import {
  closeFirstKeys,
  completeFirstKey,
  emptyFirstKeys,
  firstKeySteps,
  firstKeysFinished,
  firstKeysRules,
  nextFirstKey,
  parseFirstKeys,
  remainingFirstKeys,
  restartFirstKeys,
  resumeFirstKeys,
  skipFirstKeys,
  startFirstKeys,
  type FirstKeysState,
} from '../apps/desktop/src/renderer/src/first-keys'
import { expectsAccounts } from '../apps/desktop/src/renderer/src/first-run'

/** Does each listed step, in order. */
const after = (steps: readonly (typeof firstKeySteps)[number][], state: FirstKeysState) =>
  steps.reduce(completeFirstKey, state)

describe('first keys', () => {
  it('is offered once a first account is connected, starting with moving through the inbox', () => {
    expect(emptyFirstKeys.phase).toBeUndefined()
    const state = startFirstKeys(emptyFirstKeys)
    expect(state).toEqual({ phase: 'active', done: [], launches: 1 })
    expect(nextFirstKey(state)).toBe('move')
  })

  it('notices nothing until it is offered, so people who never saw it are left alone', () => {
    expect(completeFirstKey(emptyFirstKeys, 'open')).toBe(emptyFirstKeys)
    const closed = closeFirstKeys(startFirstKeys(emptyFirstKeys))
    expect(completeFirstKey(closed, 'open')).toBe(closed)
  })

  it('takes the steps in any order and shows the first one still to do', () => {
    let state = startFirstKeys(emptyFirstKeys)
    state = completeFirstKey(state, 'commands')
    expect(nextFirstKey(state)).toBe('move')
    state = after(['move', 'open'], state)
    expect(nextFirstKey(state)).toBe('archive')
    // Doing a step again changes nothing, so the stored state isn't rewritten.
    expect(completeFirstKey(state, 'open')).toBe(state)
    expect(firstKeysFinished(state)).toBe(false)
    state = completeFirstKey(state, 'archive')
    expect(firstKeysFinished(state)).toBe(true)
    expect(nextFirstKey(state)).toBeUndefined()
  })

  it('is not offered again after it was closed, even when an account is connected anew', () => {
    const closed = closeFirstKeys(startFirstKeys(emptyFirstKeys))
    expect(closed.phase).toBe('closed')
    expect(startFirstKeys(closed)).toBe(closed)
    expect(closeFirstKeys(closed)).toBe(closed)
  })

  it('starts over when it is asked for', () => {
    const closed = closeFirstKeys(after(firstKeySteps, startFirstKeys(emptyFirstKeys)))
    expect(restartFirstKeys()).toEqual({ phase: 'active', done: [], launches: 1 })
    expect(restartFirstKeys()).not.toBe(closed)
  })

  it('passes over a step whose shortcut was removed, and still does after starting over', () => {
    const untaught = ['move'] as const
    let state = startFirstKeys(emptyFirstKeys)
    expect(nextFirstKey(state, untaught)).toBe('open')
    expect(remainingFirstKeys(state, untaught)).toEqual(['open', 'archive', 'commands'])
    state = after(['open', 'archive', 'commands'], state)
    expect(firstKeysFinished(state, untaught)).toBe(true)
    // Nothing was recorded for the step that was never asked for.
    expect(state.done).not.toContain('move')
    // Starting over clears what was done; the step without a key is still never the one shown.
    state = restartFirstKeys()
    expect(nextFirstKey(state, untaught)).toBe('open')
    expect(nextFirstKey(state, firstKeySteps)).toBeUndefined()
  })

  it('counts passed-over steps as done once the rest are, so the next launch sees it finished', () => {
    const untaught = ['archive'] as const
    const taught = after(['move', 'open', 'commands'], startFirstKeys(emptyFirstKeys))
    // Without knowing which shortcuts exist, a launch would bring the finished card back.
    expect(resumeFirstKeys(taught).phase).toBe('active')
    const settled = skipFirstKeys(taught, untaught)
    expect(firstKeysFinished(settled)).toBe(true)
    expect(resumeFirstKeys(settled).phase).toBe('closed')
    // Settling again changes nothing, so it is safe to repeat.
    expect(skipFirstKeys(settled, untaught)).toBe(settled)
    // Starting over undoes it, so it has to be settled again rather than once.
    const again = restartFirstKeys()
    expect(firstKeysFinished(again)).toBe(false)
    expect(firstKeysFinished(skipFirstKeys(again, firstKeySteps))).toBe(true)
  })

  it('goes away by itself when it is left alone for several launches', () => {
    let state = startFirstKeys(emptyFirstKeys)
    for (let launch = 1; launch < firstKeysRules.launches; launch++) {
      state = resumeFirstKeys(state)
      expect(state).toMatchObject({ phase: 'active', launches: launch + 1 })
    }
    expect(resumeFirstKeys(state).phase).toBe('closed')
  })

  it('keeps what was done between launches, and is gone the launch after it was finished', () => {
    const partly = resumeFirstKeys(after(['move'], startFirstKeys(emptyFirstKeys)))
    expect(partly).toMatchObject({ phase: 'active', done: ['move'] })
    const finished = after(firstKeySteps, startFirstKeys(emptyFirstKeys))
    // Finishing leaves the card up to say so; the next launch doesn't bring it back.
    expect(finished.phase).toBe('active')
    expect(resumeFirstKeys(finished).phase).toBe('closed')
    expect(resumeFirstKeys(emptyFirstKeys)).toBe(emptyFirstKeys)
  })

  it('reads saved state back, and starts over from anything damaged', () => {
    const state = after(['move', 'commands'], startFirstKeys(emptyFirstKeys))
    expect(parseFirstKeys(JSON.stringify(state))).toEqual({
      phase: 'active',
      // Always in the order the steps are taught, whatever order they were done in.
      done: ['move', 'commands'],
      launches: 1,
    })
    expect(parseFirstKeys(null)).toBe(emptyFirstKeys)
    expect(parseFirstKeys('not json')).toBe(emptyFirstKeys)
    expect(parseFirstKeys('[]')).toBe(emptyFirstKeys)
    expect(
      parseFirstKeys(JSON.stringify({ phase: 'paused', done: ['move', 'fly', 7], launches: -2 })),
    ).toEqual({ phase: undefined, done: ['move'], launches: 0 })
  })
})

describe('what the window shows before accounts have loaded', () => {
  it('follows what the last run saved', () => {
    expect(expectsAccounts('true', false)).toBe(true)
    // Mail still cached after the last account was removed doesn't bring the mailbox back.
    expect(expectsAccounts('false', true)).toBe(false)
  })

  it('takes cached mail as the sign of an account when an older version saved nothing', () => {
    expect(expectsAccounts(null, true)).toBe(true)
  })

  it('treats a device with neither as a first launch', () => {
    expect(expectsAccounts(null, false)).toBe(false)
  })
})
