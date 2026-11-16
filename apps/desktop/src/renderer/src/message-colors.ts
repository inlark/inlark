import { useSyncExternalStore } from 'react'
import type { Message, Settings } from '@inlark/core'

/** How a designed email looks while the app is dark: as sent on white, or in dark colours. */
export type MessageColors = NonNullable<Settings['messageColors']>

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
