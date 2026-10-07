import { cn } from '@inlark/ui'
import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Lock,
  LockKeyhole,
  LockOpen,
  Signature,
  type IconComponent,
} from '@inlark/ui/icons'
import { Button, Dropdown, MenuItem, Spinner } from '@inlark/ui'
import {
  friendlyError,
  type EncryptionIdentity,
  type EncryptionReadiness,
  type EncryptionStatus,
  type RecipientReadiness,
} from '@inlark/core'
import { recipientProblems } from './encryption-ui'

export type Protection = 'none' | 'encrypt' | 'sign'

const modes: Record<
  Protection,
  { icon: IconComponent; label: string; current: string; detail: string }
> = {
  encrypt: {
    icon: Lock,
    label: 'Encrypt',
    current: 'Encrypted',
    detail: 'Only recipients can read it',
  },
  sign: {
    icon: Signature,
    label: 'Sign only',
    current: 'Signed',
    detail: 'Proves it’s from you; anyone can read it',
  },
  none: {
    icon: LockOpen,
    label: 'Don’t encrypt',
    current: 'Not encrypted',
    detail: 'Send as regular email',
  },
}

/** The composer toolbar's choice of encrypting, signing or neither. */
export function ProtectionMenu({
  mode,
  shortcut,
  onChange,
  onSettings,
}: {
  mode: Protection
  shortcut?: string
  onChange: (mode: Protection) => void
  onSettings: () => void
}) {
  const current = modes[mode]
  const Icon = current.icon
  return (
    <Dropdown
      className="compose-protection-menu w-66 [&_.menu-item]:py-1.5"
      trigger={
        <Button
          size="small"
          variant="ghost"
          className={cn(
            'compose-protection-trigger ml-auto h-7.25 gap-1.5 px-2.25 data-popup-open:bg-hover',
            '[&[data-popup-open]_.chevron]:transform-[rotate(180deg)]',
            mode === 'encrypt' &&
              'text-primary bg-primary-tint [&:hover:not(:disabled)]:text-primary [&:hover:not(:disabled)]:bg-primary-tint',
          )}
          aria-label={'Protection: ' + current.current}
          title={shortcut ? 'Encrypt or stop encrypting · ' + shortcut : undefined}
        >
          <Icon size={14} />
          {current.current}
          <ChevronDown
            size={12}
            className="chevron opacity-70 transition-[transform] duration-120"
          />
        </Button>
      }
    >
      {(Object.keys(modes) as Protection[]).map((value) => {
        const option = modes[value]
        const OptionIcon = option.icon
        return (
          <MenuItem key={value} onClick={() => onChange(value)}>
            <OptionIcon size={15} className={cn(value === mode && 'text-primary')} />
            <span className="flex flex-col min-w-0">
              <span>{option.label}</span>
              <span className="text-[11px] text-muted">{option.detail}</span>
            </span>
            {value === mode && <Check size={13} className="ml-auto text-primary" />}
          </MenuItem>
        )
      })}
      <div className="h-[1px] m-1.25 bg-border" />
      <MenuItem onClick={onSettings}>
        <LockKeyhole size={14} />
        Encryption settings…
      </MenuItem>
    </Dropdown>
  )
}

/**
 * One line between the addresses and the message that says how it will be protected, and
 * what to do when it can't be.
 */
export function ProtectionBar({
  mode,
  vault,
  own,
  ownKeyProblem,
  email,
  recipients,
  readiness,
  blocked,
  nameOf,
  earlierPlaintext,
  onUnlock,
  onSetUp,
  onTurnOn,
  onReview,
  onStop,
}: {
  mode: Protection
  vault?: EncryptionStatus['vault']
  own?: EncryptionIdentity
  ownKeyProblem?: string
  email: string
  recipients: number
  readiness: UseQueryResult<EncryptionReadiness>
  blocked: RecipientReadiness[]
  nameOf: (email: string) => string
  earlierPlaintext: boolean
  onUnlock: () => void
  onSetUp: () => void
  onTurnOn: () => void
  onReview: (email: string) => void
  onStop: () => void
}) {
  if (mode === 'none') return null
  const stop = (
    <Button size="small" variant="ghost" onClick={onStop}>
      {mode === 'encrypt' ? 'Don’t encrypt' : 'Don’t sign'}
    </Button>
  )
  let tone: 'calm' | 'neutral' | 'warning' | 'danger' = 'calm'
  let icon: IconComponent | 'spinner' = mode === 'encrypt' ? Lock : Signature
  let text: ReactNode
  let action: ReactNode
  let detail: ReactNode
  if (!vault) {
    icon = 'spinner'
    text = 'Checking encryption…'
  } else if (vault === 'locked') {
    tone = 'warning'
    icon = LockKeyhole
    text =
      mode === 'encrypt'
        ? 'Your keys are locked. Unlock them to keep writing this encrypted message.'
        : 'Your keys are locked. Unlock them to sign this message.'
    action = (
      <Button size="small" onClick={onUnlock}>
        Unlock
      </Button>
    )
  } else if (!own) {
    tone = 'warning'
    icon = AlertCircle
    text = 'Encryption isn’t set up for ' + email + ' yet.'
    action = (
      <>
        {stop}
        <Button size="small" onClick={onSetUp}>
          Set up…
        </Button>
      </>
    )
  } else if (!own.enabled) {
    tone = 'warning'
    icon = AlertCircle
    text = 'Encryption is turned off for ' + email + '.'
    action = (
      <>
        {stop}
        <Button size="small" onClick={onTurnOn}>
          Turn on
        </Button>
      </>
    )
  } else if (ownKeyProblem) {
    tone = 'danger'
    icon = AlertCircle
    text =
      'Your key for ' +
      email +
      (ownKeyProblem === 'revoked'
        ? ' was revoked.'
        : ownKeyProblem === 'expired'
          ? ' has expired.'
          : ' can’t be used.') +
      ' Replace it in Settings.'
    action = (
      <>
        {stop}
        <Button size="small" onClick={onSetUp}>
          Settings…
        </Button>
      </>
    )
  } else if (mode === 'sign') {
    tone = 'neutral'
    text =
      'Signed, not encrypted. Recipients can check it’s from you, but anyone handling it can read it.'
  } else if (readiness.isError) {
    tone = 'danger'
    icon = AlertCircle
    text = 'Couldn’t check recipients’ keys. ' + friendlyError(readiness.error)
    action = (
      <Button size="small" onClick={() => void readiness.refetch()}>
        Try again
      </Button>
    )
  } else if (recipients && !readiness.data) {
    icon = 'spinner'
    text = 'Checking recipients’ keys…'
  } else if (blocked.length) {
    tone = 'danger'
    icon = AlertCircle
    text =
      'Can’t encrypt to ' +
      (blocked.length === 1 ? nameOf(blocked[0].email) : blocked.length + ' recipients') +
      '. Review ' +
      (blocked.length === 1 ? 'their key' : 'their keys') +
      ', or send without encryption.'
    detail = (
      <span className="flex flex-wrap gap-1.5 mt-1.5">
        {blocked.map((recipient) => (
          <button
            type="button"
            key={recipient.email}
            className={cn(
              'inline-flex items-center gap-1.25 h-5.5 px-2 rounded-xl border border-solid border-danger/35 bg-transparent',
              'text-[11px] text-danger whitespace-nowrap transition-[background] duration-120 hover:bg-danger/10',
            )}
            title={'Review the key for ' + recipient.email}
            onClick={() => onReview(recipient.email)}
          >
            <LockOpen size={11} />
            {nameOf(recipient.email)}
            <span className="text-danger/75">
              · {recipientProblems[recipient.status as keyof typeof recipientProblems]}
            </span>
          </button>
        ))}
      </span>
    )
    action = stop
  } else {
    const count = readiness.data?.recipients.length || 0
    text = count
      ? 'Encrypted for ' +
        (count === 1
          ? nameOf(readiness.data!.recipients[0].email)
          : 'all ' + count + ' recipients') +
        '. The subject line isn’t encrypted.'
      : 'Encrypted. Add recipients to check their keys. The subject line isn’t encrypted.'
  }
  const Icon = icon === 'spinner' ? undefined : icon
  return (
    <div
      role="status"
      className={cn(
        'compose-protection flex items-start gap-2.5 py-2.25 px-6 text-[11px] leading-[1.55] shrink-0',
        'border-b border-solid border-b-border',
        tone === 'calm' && 'bg-primary-tint text-secondary [&>.protection-icon]:text-primary',
        tone === 'neutral' &&
          'bg-[color-mix(in_srgb,_var(--hover)_50%,_transparent)] text-secondary [&>.protection-icon]:text-muted',
        tone === 'warning' && 'bg-star/8 text-foreground [&>.protection-icon]:text-star',
        tone === 'danger' && 'bg-danger/7 text-foreground [&>.protection-icon]:text-danger',
      )}
    >
      <span className="protection-icon flex shrink-0 mt-[2px]">
        {Icon ? <Icon size={13} /> : <Spinner size={13} />}
      </span>
      <div className="flex-1 min-w-0">
        <span>{text}</span>
        {detail}
        {earlierPlaintext && mode === 'encrypt' && (
          <span className="block text-muted mt-0.5">
            An earlier copy of this draft was saved unencrypted and may remain on the server.
          </span>
        )}
      </div>
      {action && <div className="flex shrink-0 gap-1.5 -my-[3px]">{action}</div>}
    </div>
  )
}
