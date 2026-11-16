import { useSyncExternalStore } from 'react'
import { defaultSettings, type Message, type Settings } from '@inlark/core'

/** How a designed email looks while the app is dark: in dark colours, or as sent on white. */
export type MessageColors = NonNullable<Settings['messageColors']>

/** The chosen default, or dark colours for anyone who hasn't chosen. */
export const defaultColors = (settings: Pick<Settings, 'messageColors'>): MessageColors =>
  settings.messageColors ?? defaultSettings.messageColors ?? 'dark'

/** What the open conversation offers, for the shortcut and the command menu. */
export interface ColorSwitch {
  /** At least one of the open emails is showing dark colours. */
  dark: boolean
  toggle: () => void
}

// Emails switched by hand in this session. Keeping an entry after switching back is what keeps
// the email's switch on screen, so it never disappears under the pointer.
let overrides = new Map<string, MessageColors>()
let current: ColorSwitch | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const emit = () => listeners.forEach((listener) => listener())

export const colorKey = (message: Pick<Message, 'accountId' | 'id'>) =>
  message.accountId + '\n' + message.id

export const useColorOverrides = () => useSyncExternalStore(subscribe, () => overrides)

export function setColorOverrides(keys: string[], colors: MessageColors) {
  if (!keys.length) return
  overrides = new Map(overrides)
  for (const key of keys) overrides.set(key, colors)
  emit()
}

/** A new default applies to every email again. */
export function clearColorOverrides() {
  if (!overrides.size) return
  overrides = new Map()
  emit()
}

export const useColorSwitch = () => useSyncExternalStore(subscribe, () => current)

export function publishColorSwitch(next: ColorSwitch | null) {
  if (current === next) return
  current = next
  emit()
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const lightSwitchesKey = 'message-colors-light-switches'
const askedKey = 'message-colors-asked'
/** Switching one email back to its white background is expected; a few in a row is a preference. */
const askAfter = 3

/**
 * Counts an email switched to its white background by hand while dark colours are the default.
 * Returns true exactly once, on the switch that makes it a pattern, so inlark can ask whether
 * white should be the default. The count survives restarts; after asking, it never asks again.
 */
export function countLightSwitch(given?: Store): boolean {
  try {
    const store = given ?? localStorage
    if (store.getItem(askedKey) === 'true') return false
    const count = Number(store.getItem(lightSwitchesKey)) + 1 || 1
    if (count < askAfter) {
      store.setItem(lightSwitchesKey, String(count))
      return false
    }
    store.setItem(askedKey, 'true')
    store.removeItem(lightSwitchesKey)
    return true
  } catch {
    // Without storage the question could repeat on every launch, so it isn't asked at all.
    return false
  }
}
