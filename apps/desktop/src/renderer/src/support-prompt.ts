/**
 * Where inlark sends people who want to support it. The site redirects to Buy Me a Coffee, where
 * one-time support needs no account, and the destination can change without an app update.
 */
export const supportUrl = 'https://inlark.com/support'

/**
 * What the sidebar's support card remembers, on this device only. Nothing here leaves the
 * computer: inlark has no telemetry, so “active” only means the window was used that day.
 */
export interface SupportPromptState {
  /** First local day inlark was used with an account, as `YYYY-MM-DD`. */
  firstDay?: string
  /** The last day counted, so each day counts once. */
  lastDay?: string
  /** Distinct days inlark was used with an account. */
  activeDays: number
  /** After “Later”, the card stays hidden until this day… */
  snoozedUntil?: string
  /** …and until inlark has been used this many days, so time away doesn't count as use. */
  snoozedUntilActiveDays?: number
  /** How often “Later” was chosen. Each one waits longer than the last. */
  snoozes?: number
  /** Hidden for good: closed, or the support page was opened from anywhere in inlark. */
  done?: 'dismissed' | 'supported'
}

/**
 * The card appears as soon as an account is connected, so everyone who might want to support
 * inlark sees it. “Later” asks again after a month of use, waiting longer each time.
 */
export const supportPromptRules = {
  activeDays: 1,
  snoozeDays: 30,
  maxSnoozeDays: 120,
  snoozeActiveDays: 5,
} as const

export const emptySupportPrompt: SupportPromptState = { activeDays: 0 }

/** The local calendar day, as `YYYY-MM-DD`, which also sorts correctly as a string. */
export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date) / 86_400_000
}

function addDays(day: string, days: number): string {
  const date = new Date((dayNumber(day) + days) * 86_400_000)
  return date.toISOString().slice(0, 10)
}

/** Counts `today` as an active day, once. A clock that moved backwards counts nothing. */
export function recordActiveDay(state: SupportPromptState, today: string): SupportPromptState {
  if (state.lastDay && today <= state.lastDay) return state
  return {
    ...state,
    firstDay: state.firstDay ?? today,
    lastDay: today,
    activeDays: state.activeDays + 1,
  }
}

export function shouldShowSupportPrompt(state: SupportPromptState, today: string): boolean {
  if (state.done || !state.firstDay) return false
  if (state.activeDays < supportPromptRules.activeDays) return false
  if (state.snoozedUntil && today < state.snoozedUntil) return false
  if (state.snoozedUntilActiveDays && state.activeDays < state.snoozedUntilActiveDays) return false
  return true
}

/** “Later”: a month at first, then twice as long each time, up to four months. */
export function snoozeSupportPrompt(state: SupportPromptState, today: string): SupportPromptState {
  const snoozes = (state.snoozes ?? 0) + 1
  const days = Math.min(
    supportPromptRules.snoozeDays * 2 ** (snoozes - 1),
    supportPromptRules.maxSnoozeDays,
  )
  return {
    ...state,
    snoozes,
    snoozedUntil: addDays(today, days),
    snoozedUntilActiveDays: state.activeDays + supportPromptRules.snoozeActiveDays,
  }
}

/** Accepts only well-formed saved state, so a damaged entry starts over instead of failing. */
export function parseSupportPrompt(text: string | null): SupportPromptState {
  if (!text) return emptySupportPrompt
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySupportPrompt
    const day = (key: string) =>
      typeof value[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value[key] as string)
        ? (value[key] as string)
        : undefined
    const count = (key: string) =>
      typeof value[key] === 'number' && Number.isInteger(value[key]) && (value[key] as number) >= 0
        ? (value[key] as number)
        : undefined
    return {
      firstDay: day('firstDay'),
      lastDay: day('lastDay'),
      activeDays: count('activeDays') ?? 0,
      snoozedUntil: day('snoozedUntil'),
      snoozedUntilActiveDays: count('snoozedUntilActiveDays'),
      snoozes: count('snoozes'),
      done: value.done === 'dismissed' || value.done === 'supported' ? value.done : undefined,
    }
  } catch {
    return emptySupportPrompt
  }
}

const storageKey = 'support-prompt'
const listeners = new Set<() => void>()
let current: SupportPromptState | undefined

export function supportPromptSnapshot(): SupportPromptState {
  current ??= parseSupportPrompt(localStorage.getItem(storageKey))
  return current
}

export function subscribeSupportPrompt(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function updateSupportPrompt(
  change: (state: SupportPromptState) => SupportPromptState,
): void {
  const previous = supportPromptSnapshot()
  const next = change(previous)
  if (next === previous) return
  current = next
  localStorage.setItem(storageKey, JSON.stringify(next))
  for (const listener of listeners) listener()
}

/** Someone who has opened the support page shouldn't be asked again, wherever they opened it. */
export function markSupported(): void {
  updateSupportPrompt((state) => (state.done ? state : { ...state, done: 'supported' }))
}
