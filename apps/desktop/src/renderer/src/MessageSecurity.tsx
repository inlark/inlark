import { cn } from '@inlark/ui'
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  ChevronDown,
  Key,
  Lock,
  LockKeyhole,
  ShieldCheck,
  ShieldX,
  Signature,
  type IconComponent,
} from '@inlark/ui/icons'
import { Button, Spinner } from '@inlark/ui'
import { friendlyError, type MailSecurity, type Message } from '@inlark/core'
import { api } from './api'
import { Callout, FingerprintBlock, StateIcon, useEncryption } from './encryption-ui'

/** Whether a message's content was withheld, and so the body can't be shown at all. */
export const withheld = (security?: MailSecurity) =>
  !!security && ['locked', 'missingKey', 'integrityFailure'].includes(security.state)

function Pill({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'accent' | 'good' | 'neutral' | 'danger'
  icon?: IconComponent
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'security-pill inline-flex items-center gap-1 h-5.5 px-2 rounded-md text-[11px] font-medium whitespace-nowrap',
        tone === 'accent' && 'bg-primary-tint text-primary',
        tone === 'good' && 'bg-success/10 text-success',
        tone === 'neutral' && 'bg-hover text-muted',
        tone === 'danger' && 'bg-danger/10 text-danger',
      )}
    >
      {Icon && <Icon size={12} />}
      {children}
    </span>
  )
}

function Detail({
  icon,
  tone,
  title,
  children,
}: {
  icon: IconComponent
  tone: 'accent' | 'good' | 'neutral' | 'danger'
  title: string
  children: ReactNode
}) {
  return (
    <div className="security-detail flex gap-3 [&+.security-detail]:mt-3.5">
      <StateIcon icon={icon} tone={tone} size={28} />
      <div className="flex-1 min-w-0 text-[12px] leading-[1.6] text-muted [&_strong]:block [&_strong]:text-foreground [&_strong]:font-medium">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  )
}

/**
 * How a readable message was protected: encryption, signature, and whether the sender's key was
 * verified are separate things, so each is named on its own. Details explain what each means.
 */
export function SecuritySummary({ message }: { message: Message }) {
  const security = message.security!
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const sender = message.from[0]
  const senderName = sender?.name || sender?.email || 'the sender'
  const signed = security.signature === 'valid'
  const verify = async () => {
    if (!sender || !security.fingerprint) return
    setBusy(true)
    setError('')
    try {
      client.setQueryData(
        ['encryption'],
        await api.acceptEncryptionKey(sender.email, security.fingerprint, true),
      )
      await Promise.all([
        client.invalidateQueries({ queryKey: ['thread'] }),
        client.invalidateQueries({ queryKey: ['contact-keys'] }),
        client.invalidateQueries({ queryKey: ['recipient-encryption'] }),
      ])
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="message-security mb-4.5">
      {security.signature === 'invalid' && (
        <Callout tone="danger" icon={ShieldX} title="This signature doesn’t match" className="mb-3">
          <p>
            The message may have been changed after it was sent, or it wasn’t signed by {senderName}
            . Be careful with its links, attachments and requests.
          </p>
        </Callout>
      )}
      <button
        type="button"
        className={cn(
          'security-summary inline-flex items-center gap-1.5 flex-wrap py-1 pr-1.5 pl-1 -ml-1 rounded-lg border-0',
          'bg-transparent text-left transition-[background] duration-120 ease-[ease] hover:bg-hover',
        )}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {security.encrypted && (
          <Pill tone="accent" icon={Lock}>
            Encrypted
          </Pill>
        )}
        {security.signature === 'valid' ? (
          <Pill tone="good" icon={ShieldCheck}>
            Signed
          </Pill>
        ) : security.signature === 'invalid' ? (
          <Pill tone="danger" icon={ShieldX}>
            Signature invalid
          </Pill>
        ) : security.signature === 'unknown' ? (
          <Pill tone="neutral" icon={Signature}>
            Signature not checked
          </Pill>
        ) : (
          <Pill tone="neutral">Not signed</Pill>
        )}
        {signed &&
          (security.confirmed ? (
            <Pill tone="good" icon={BadgeCheck}>
              Verified sender
            </Pill>
          ) : (
            <span className="text-[11px] text-muted px-1">Sender not verified</span>
          ))}
        <ChevronDown
          size={13}
          className={cn(
            'text-muted transition-[transform] duration-140 ease-[ease]',
            open && 'transform-[rotate(180deg)]',
          )}
        />
      </button>
      {open && (
        <div className="security-details mt-2.5 py-4 px-4.5 rounded-xl border border-solid border-border-strong bg-surface">
          {security.encrypted && (
            <Detail icon={Lock} tone="accent" title="Encrypted">
              Only you and the other recipients could read this message and its attachments. Its
              subject, addresses and date weren’t encrypted.
            </Detail>
          )}
          {security.signature === 'valid' ? (
            <Detail icon={ShieldCheck} tone="good" title="Signed">
              It hasn’t changed since it was signed with the key below.
            </Detail>
          ) : security.signature === 'invalid' ? (
            <Detail icon={ShieldX} tone="danger" title="Signature invalid">
              The signature doesn’t match the content or the sender’s key.
            </Detail>
          ) : security.signature === 'unknown' ? (
            <Detail icon={Signature} tone="neutral" title="Signature not checked">
              The sender’s key isn’t available here, so the signature couldn’t be checked.
            </Detail>
          ) : (
            <Detail icon={Signature} tone="neutral" title="Not signed">
              Nothing proves who sent it.{' '}
              {security.encrypted && 'Encryption alone doesn’t confirm the sender.'}
            </Detail>
          )}
          {signed && (
            <Detail
              icon={BadgeCheck}
              tone={security.confirmed ? 'good' : 'neutral'}
              title={security.confirmed ? 'Verified sender' : 'Sender not verified'}
            >
              {security.confirmed
                ? 'You confirmed that this key belongs to ' + senderName + '.'
                : 'A valid signature shows which key signed it, not who owns that key. To be sure it’s ' +
                  senderName +
                  ', compare this fingerprint with them in person or on a call.'}
              {security.fingerprint && (
                <FingerprintBlock value={security.fingerprint} className="mt-2.5" />
              )}
              {!security.confirmed && security.fingerprint && (
                <Button
                  size="small"
                  className="mt-2.5"
                  disabled={busy}
                  onClick={() => void verify()}
                >
                  {busy ? <Spinner size={12} /> : <BadgeCheck size={13} />}
                  It matches, mark as verified
                </Button>
              )}
              {error && <span className="block mt-2 text-[11px] text-danger">{error}</span>}
            </Detail>
          )}
        </div>
      )}
    </div>
  )
}

/** Stands in for a body that can't be shown, saying why and what would open it. */
export function WithheldBody({
  security,
  onUnlock,
  onOpenEncryption,
}: {
  security: MailSecurity
  onUnlock?: () => void
  onOpenEncryption?: () => void
}) {
  const status = useEncryption()
  const unset = status.data?.vault === 'absent'
  const content =
    security.state === 'integrityFailure'
      ? {
          icon: ShieldX,
          tone: 'danger' as const,
          title: 'This message may have been tampered with',
          text: 'Inlark couldn’t confirm it arrived intact, so its content and attachments are hidden.',
        }
      : security.state === 'missingKey'
        ? {
            icon: Key,
            tone: 'neutral' as const,
            title: 'No key here can open this message',
            text: 'It was encrypted to a key that isn’t on this device. Import that private key, including older ones, to read it.',
            action: onOpenEncryption && (
              <Button onClick={onOpenEncryption}>Encryption settings…</Button>
            ),
          }
        : unset
          ? {
              icon: LockKeyhole,
              tone: 'accent' as const,
              title: 'This message is encrypted',
              text: 'Set up encryption with the key it was sent to, then you can read it here.',
              action: onOpenEncryption && (
                <Button variant="primary" onClick={onOpenEncryption}>
                  Set up encryption…
                </Button>
              ),
            }
          : {
              icon: LockKeyhole,
              tone: 'accent' as const,
              title: 'This message is encrypted',
              text: 'Unlock your keys to read it.',
              action: onUnlock && (
                <Button variant="primary" onClick={onUnlock}>
                  Unlock
                </Button>
              ),
            }
  return (
    <div
      className={cn(
        'withheld-body flex flex-col items-center text-center py-9 px-6 rounded-xl border border-dashed',
        content.tone === 'danger' ? 'border-danger/35' : 'border-border-strong',
      )}
      role="status"
    >
      <StateIcon icon={content.icon} tone={content.tone} size={44} />
      <h3 className="mt-3.5 mb-1 text-[14px] font-[550] text-strong tracking-[-0.2px]">
        {content.title}
      </h3>
      <p className="m-0 max-w-90 text-[12px] leading-[1.6] text-muted text-balance">
        {content.text}
      </p>
      {'action' in content && content.action && <div className="mt-4.5">{content.action}</div>}
    </div>
  )
}
