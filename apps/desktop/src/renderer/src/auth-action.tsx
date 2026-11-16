import { useSyncExternalStore, type ReactNode } from 'react'
import { scopeKey, type AuthLinkAction, type AuthValue } from '@inlark/core'
import { api } from './api'

const linkLabels: Record<AuthLinkAction, string> = {
  signIn: 'Sign in',
  verifyEmail: 'Verify email',
  verify: 'Verify',
  resetPassword: 'Reset password',
}

/** What acting on a code or link does, as a button label. */
export const authLabel = (candidate: AuthValue) =>
  candidate.type === 'code'
    ? 'Copy code'
    : candidate.action
      ? linkLabels[candidate.action]
      : 'Open link'

const linkCommands: Record<AuthLinkAction, string> = {
  signIn: 'Open sign-in link',
  verifyEmail: 'Open verification link',
  verify: 'Open verification link',
  resetPassword: 'Open password reset link',
}

/** The same action, named for the command menu where it stands without its email. */
export const authCommandLabel = (candidate: AuthValue) =>
  candidate.type === 'code'
    ? 'Copy verification code'
    : candidate.action
      ? linkCommands[candidate.action]
      : 'Open verification link'

export function linkHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

/** Identifies one message's value, so every place showing it confirms the same copy. */
export const authKey = (accountId: string, messageId: string) => scopeKey(accountId, messageId)

let copied: string | undefined
let clear: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
function confirmCopy(key: string) {
  copied = key
  listeners.forEach((listener) => listener())
  if (clear) clearTimeout(clear)
  clear = setTimeout(() => {
    copied = undefined
    listeners.forEach((listener) => listener())
  }, 1500)
}

/** True briefly after this message's value was copied, wherever the copy started. */
export const useAuthCopied = (key: string) => useSyncExternalStore(subscribe, () => copied === key)

/** Copies a code or link. Resolves false when the clipboard refused it. */
export async function copyAuthValue(value: string, key: string) {
  try {
    await navigator.clipboard.writeText(value)
    confirmCopy(key)
    return true
  } catch {
    return false
  }
}

/** Copies a code or opens a link. Resolves false when that failed. Never marks mail as read. */
export async function runAuth(candidate: AuthValue, key: string) {
  if (candidate.type === 'code') return copyAuthValue(candidate.value, key)
  try {
    await api.openExternal(candidate.value)
    return true
  } catch {
    return false
  }
}

/** Announces a copy once for assistive technology; the button itself shows it visually. */
export function AuthAnnouncer() {
  const key = useSyncExternalStore(subscribe, () => copied)
  return (
    <span role="status" className="sr-only">
      {key ? 'Copied' : ''}
    </span>
  )
}

/** Shows one of two labels in the space of the wider, so confirming a copy never shifts layout. */
export function SwapLabel({
  showAlternate,
  label,
  alternate,
}: {
  showAlternate: boolean
  label: ReactNode
  alternate: ReactNode
}) {
  return (
    <span className="grid [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:text-left">
      <span className={showAlternate ? 'invisible' : undefined} aria-hidden={showAlternate}>
        {label}
      </span>
      <span className={showAlternate ? undefined : 'invisible'} aria-hidden={!showAlternate}>
        {alternate}
      </span>
    </span>
  )
}
