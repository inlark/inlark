import { describe, expect, it } from 'vitest'
import {
  emptySupportPrompt,
  localDay,
  parseSupportPrompt,
  recordActiveDay,
  shouldShowSupportPrompt,
  snoozeSupportPrompt,
  type SupportPromptState,
} from '../apps/desktop/src/renderer/src/support-prompt'

/** Uses inlark on each listed day, in order. */
function use(days: string[], state: SupportPromptState = emptySupportPrompt) {
  return days.reduce(recordActiveDay, state)
}

const firstWeek = [
  '2026-03-01',
  '2026-03-02',
  '2026-03-03',
  '2026-03-04',
  '2026-03-05',
  '2026-03-06',
  '2026-03-07',
]

describe('support prompt', () => {
  it('counts each day once and ignores a clock that went backwards', () => {
    let state = use(['2026-03-01', '2026-03-01', '2026-03-02'])
    expect(state).toMatchObject({ firstDay: '2026-03-01', lastDay: '2026-03-02', activeDays: 2 })
    state = recordActiveDay(state, '2026-02-27')
    expect(state.activeDays).toBe(2)
  })

  it('asks on the first day inlark is used with a connected account', () => {
    expect(shouldShowSupportPrompt(emptySupportPrompt, '2026-03-01')).toBe(false)
    expect(shouldShowSupportPrompt(use(['2026-03-01']), '2026-03-01')).toBe(true)
  })

  it('never shows before any account was used, or after it was closed or answered', () => {
    expect(shouldShowSupportPrompt(emptySupportPrompt, '2026-03-30')).toBe(false)
    const ready = use(firstWeek)
    expect(shouldShowSupportPrompt({ ...ready, done: 'dismissed' }, '2027-01-01')).toBe(false)
    expect(shouldShowSupportPrompt({ ...ready, done: 'supported' }, '2027-01-01')).toBe(false)
  })

  it('waits a month and more use after “Later”, longer each time', () => {
    let state = snoozeSupportPrompt(use(firstWeek), '2026-03-15')
    expect(state).toMatchObject({ snoozes: 1, snoozedUntil: '2026-04-14' })
    // A month away from inlark is not a month of use.
    expect(shouldShowSupportPrompt(state, '2026-04-20')).toBe(false)
    state = use(['2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'], state)
    expect(shouldShowSupportPrompt(state, '2026-04-17')).toBe(false)
    state = recordActiveDay(state, '2026-04-18')
    expect(shouldShowSupportPrompt(state, '2026-04-18')).toBe(true)

    state = snoozeSupportPrompt(state, '2026-04-18')
    expect(state.snoozedUntil).toBe('2026-06-17')
    state = snoozeSupportPrompt(state, '2026-06-17')
    expect(state.snoozedUntil).toBe('2026-10-15')
    state = snoozeSupportPrompt(state, '2026-10-15')
    expect(state.snoozedUntil).toBe('2027-02-12')
  })

  it('starts over from damaged saved state', () => {
    expect(parseSupportPrompt(null)).toEqual(emptySupportPrompt)
    expect(parseSupportPrompt('{')).toEqual(emptySupportPrompt)
    expect(parseSupportPrompt('[1]')).toEqual(emptySupportPrompt)
    expect(
      parseSupportPrompt(
        JSON.stringify({ firstDay: 'soon', activeDays: -2, snoozes: 1.5, done: 'maybe' }),
      ),
    ).toEqual({ activeDays: 0 })
    const saved = snoozeSupportPrompt(use(firstWeek), '2026-03-15')
    expect(parseSupportPrompt(JSON.stringify(saved))).toEqual(saved)
  })

  it('names local days in a sortable form', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
