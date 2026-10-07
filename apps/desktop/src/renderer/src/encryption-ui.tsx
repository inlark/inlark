import { cn } from '@inlark/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Check, Copy, Info, type IconComponent } from '@inlark/ui/icons'
import { IconButton } from '@inlark/ui'
import { friendlyError, type EncryptionKeySummary, type RecipientReadiness } from '@inlark/core'
import { api } from './api'

export const useEncryption = () =>
  useQuery({ queryKey: ['encryption'], queryFn: () => api.encryptionStatus() })

/** Gives open composers a chance to save, then locks the vault. */
export async function lockVault() {
  const tasks: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent('inlark-before-lock', { detail: tasks }))
  await Promise.all(tasks)
  await api.lockEncryption()
}

/** Groups a fingerprint in fours, as other OpenPGP apps show it, so it can be read aloud. */
export const formatFingerprint = (fingerprint: string) =>
  fingerprint
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join(' ') || ''
/** The last 16 digits, enough to tell keys apart at a glance. */
export const shortFingerprint = (fingerprint: string) => formatFingerprint(fingerprint.slice(-16))

export const recipientProblems: Record<Exclude<RecipientReadiness['status'], 'ready'>, string> = {
  missing: 'No key found',
  expired: 'Key expired',
  revoked: 'Key revoked',
  unusable: 'Key can’t be used',
  changed: 'Key changed',
  conflict: 'Several keys found',
}
const sourceLabels: Record<EncryptionKeySummary['sources'][number], string> = {
  own: 'created in inlark',
  import: 'imported',
  wkd: 'their provider’s key directory',
  autocrypt: 'mail they sent you',
  gossip: 'a message to several people',
}
export const keySources = (key: EncryptionKeySummary) =>
  key.sources.map((source) => sourceLabels[source]).join(', ')

/** Explains failures from importing a key file in terms of what to try next. */
export function keyFileError(error: unknown, password: string) {
  const text = friendlyError(error)
  if (/passphrase/i.test(text))
    return password
      ? 'That password didn’t unlock the key file. Check it and try again.'
      : 'This key file is password protected. Enter its password, then choose the file again.'
  if (/armor|packet|misformed|no key/i.test(text))
    return 'This file doesn’t contain a private key inlark can read. Choose an exported private key or a backup.'
  return text
}

/** Why a new password can't be used, if it can't. */
export const newPasswordProblem = (password: string, confirm: string) =>
  password.length < 10
    ? 'Use at least 10 characters.'
    : password !== confirm
      ? 'The passwords don’t match.'
      : ''

const formField =
  "form-field block [&+.form-field]:mt-3.5 [&_input]:mt-1.5 [&_input]:text-[12px] [&_input[aria-invalid='true']]:border-danger/70"
export const dialogLead = 'mt-0 mb-4.5 text-[12px] leading-[1.6] text-secondary'
export const formError =
  'form-error flex gap-2 text-[11px] leading-[1.6] mt-3.5 mb-0 mx-0 text-danger [&_svg]:shrink-0 [&_svg]:mt-[3px]'
export const modalActions =
  'modal-actions flex justify-end gap-2 mt-6 [&>.modal-action-start]:mr-auto [&>.modal-action-start]:-ml-2.5'

export function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
  autoFocus,
  autoComplete = 'off',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  error?: string
  autoFocus?: boolean
  autoComplete?: string
}) {
  return (
    <label className={formField}>
      {label}
      <input
        type="password"
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        value={value}
        aria-invalid={!!error || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <span className="field-error block mt-1.25 text-[11px] text-danger">{error}</span>
      ) : (
        hint && <span className="field-hint text-muted text-[11px] block mt-1.25">{hint}</span>
      )}
    </label>
  )
}

/** A password chosen now and typed again, with the mismatch shown once the form was submitted. */
export function NewPasswordFields({
  label,
  password,
  confirm,
  onChange,
  hint,
  showProblems,
  autoFocus,
}: {
  label: string
  password: string
  confirm: string
  onChange: (password: string, confirm: string) => void
  hint: ReactNode
  showProblems: boolean
  autoFocus?: boolean
}) {
  const problem = showProblems ? newPasswordProblem(password, confirm) : ''
  return (
    <>
      <PasswordField
        label={label}
        value={password}
        autoFocus={autoFocus}
        autoComplete="new-password"
        onChange={(value) => onChange(value, confirm)}
        error={problem && password.length < 10 ? problem : undefined}
        hint={hint}
      />
      <PasswordField
        label="Confirm password"
        value={confirm}
        autoComplete="new-password"
        onChange={(value) => onChange(password, value)}
        error={problem && password.length >= 10 ? problem : undefined}
      />
    </>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className={formError}>
      <AlertCircle size={14} />
      <span>{children}</span>
    </div>
  )
}

/** A short boxed note: what happened or what to know, and optionally what to do about it. */
export function Callout({
  tone = 'info',
  icon: Icon = Info,
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  icon?: IconComponent
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'callout flex gap-3 items-start rounded-lg border border-solid py-3 px-3.5 text-[12px] leading-[1.6]',
        tone === 'info' &&
          'border-border-strong bg-[color-mix(in_srgb,_var(--hover)_55%,_transparent)]',
        tone === 'warning' && 'border-star/28 bg-star/7',
        tone === 'danger' && 'border-danger/30 bg-danger/7',
        tone === 'success' && 'border-success/28 bg-success/7',
        className,
      )}
    >
      <Icon
        size={16}
        className={cn(
          'shrink-0 mt-[1px]',
          tone === 'info' && 'text-muted',
          tone === 'warning' && 'text-star',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      />
      <div className="callout-copy flex-1 min-w-0 text-secondary [&_strong]:block [&_strong]:text-strong [&_strong]:font-medium [&_p]:m-0">
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {action && <div className="callout-action shrink-0 self-center flex gap-1.5">{action}</div>}
    </div>
  )
}

/** A small label for a key's state. */
export function KeyBadge({
  tone = 'neutral',
  icon: Icon,
  children,
}: {
  tone?: 'neutral' | 'good' | 'warning' | 'danger' | 'accent'
  icon?: IconComponent
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'key-badge inline-flex items-center gap-1 h-5 px-1.75 rounded-sm text-[11px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-hover text-muted',
        tone === 'good' && 'bg-success/12 text-success',
        tone === 'warning' && 'bg-star/12 text-star',
        tone === 'danger' && 'bg-danger/12 text-danger',
        tone === 'accent' && 'bg-primary-tint text-primary',
      )}
    >
      {Icon && <Icon size={12} />}
      {children}
    </span>
  )
}

/** The whole fingerprint, in rows of five groups, with a way to copy it for comparison. */
export function FingerprintBlock({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const groups = value.toUpperCase().match(/.{1,4}/g) || []
  return (
    <div
      className={cn(
        'fingerprint flex items-center gap-3 py-2.5 pr-1.5 pl-3.5 rounded-md bg-field border border-solid border-border',
        className,
      )}
    >
      <span
        className="fingerprint-groups flex-1 grid grid-cols-[repeat(5,_max-content)] gap-x-2.5 gap-y-0.5 font-mono text-[12px] tracking-[0.4px] text-foreground select-text"
        aria-label={'Fingerprint ' + groups.join(' ')}
      >
        {groups.map((group, index) => (
          <span key={index}>{group}</span>
        ))}
      </span>
      <IconButton
        label={copied ? 'Copied' : 'Copy fingerprint'}
        onClick={() =>
          void navigator.clipboard.writeText(groups.join(' ')).then(() => setCopied(true))
        }
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </IconButton>
    </div>
  )
}

/** A tile for a dialog or empty state, so each state reads at a glance. */
export function StateIcon({
  icon: Icon,
  tone = 'accent',
  size = 40,
}: {
  icon: IconComponent
  tone?: 'accent' | 'good' | 'warning' | 'danger' | 'neutral'
  size?: number
}) {
  return (
    <span
      className={cn(
        'state-icon grid place-items-center shrink-0 rounded-xl',
        tone === 'accent' && 'bg-primary-tint text-primary',
        tone === 'good' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-star/10 text-star',
        tone === 'danger' && 'bg-danger/10 text-danger',
        tone === 'neutral' && 'bg-hover text-muted',
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.6} />
    </span>
  )
}
