import { cn } from '@inlark/ui'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, BadgeCheck, Key, RefreshCw } from '@inlark/ui/icons'
import { Button, Modal, Spinner } from '@inlark/ui'
import { friendlyError, type EncryptionKeySummary, type EncryptionStatus } from '@inlark/core'
import { api } from './api'
import { queryClient } from './cache'
import {
  Callout,
  FingerprintBlock,
  FormError,
  KeyBadge,
  PasswordField,
  keySources,
  modalActions,
  shortFingerprint,
  useEncryption,
} from './encryption-ui'

const keyProblems: Record<string, string> = {
  expired: 'Expired',
  revoked: 'Revoked',
}

function UnlockDialog({
  open,
  initialError,
  onDone,
}: {
  open: boolean
  initialError?: string
  onDone: (unlocked: boolean) => void
}) {
  const status = useEncryption()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError || '')
  const [busy, setBusy] = useState(false)
  const passwordMode = status.data?.protection === 'password'
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onDone(false)
      }}
      title="Unlock your encryption keys"
      description={
        passwordMode
          ? 'Enter your vault password to read encrypted mail and keep writing encrypted drafts.'
          : 'Inlark couldn’t open your keys with the system keyring. Make sure it’s unlocked, then try again.'
      }
      className="w-[min(440px,_calc(100vw_-_40px))]"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (passwordMode && !password) {
            setError('Enter your vault password.')
            return
          }
          setBusy(true)
          setError('')
          try {
            queryClient.setQueryData(
              ['encryption'],
              await api.unlockEncryption(passwordMode ? password : undefined),
            )
            onDone(true)
          } catch (e) {
            setError(
              passwordMode && /authenticat|decrypt|password/i.test(friendlyError(e))
                ? 'That password didn’t work. Check it and try again.'
                : friendlyError(e),
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        {passwordMode && (
          <PasswordField
            label="Vault password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(value) => {
              setPassword(value)
              setError('')
            }}
          />
        )}
        {error && <FormError>{error}</FormError>}
        <div className={modalActions}>
          <Button onClick={() => onDone(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner size={14} />}
            {busy ? 'Unlocking…' : passwordMode ? 'Unlock' : 'Try again'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Unlocks the vault when needed. Keyring-protected vaults open without asking; a vault password
 * is asked for in a dialog. Resolves whether the keys are unlocked afterwards.
 */
export function useUnlock() {
  const [request, setRequest] = useState<{
    id: number
    error?: string
    resolve: (unlocked: boolean) => void
  }>()
  const unlock = async (): Promise<boolean> => {
    const status = await queryClient.fetchQuery<EncryptionStatus>({
      queryKey: ['encryption'],
      queryFn: () => api.encryptionStatus(),
      staleTime: 0,
    })
    if (status.vault !== 'locked') return status.vault === 'unlocked'
    let error: string | undefined
    if (status.protection !== 'password') {
      try {
        queryClient.setQueryData(['encryption'], await api.unlockEncryption())
        return true
      } catch (e) {
        error = friendlyError(e)
      }
    }
    return new Promise((resolve) => setRequest({ id: Date.now(), error, resolve }))
  }
  const dialog = (
    <UnlockDialog
      key={request?.id ?? 'closed'}
      open={!!request}
      initialError={request?.error}
      onDone={(unlocked) => {
        request?.resolve(unlocked)
        setRequest(undefined)
      }}
    />
  )
  return [unlock, dialog] as const
}

/** Refreshes everything that shows which keys are trusted. */
export function keysChanged(status?: EncryptionStatus) {
  if (status) queryClient.setQueryData(['encryption'], status)
  void queryClient.invalidateQueries({ queryKey: ['encryption'] })
  void queryClient.invalidateQueries({ queryKey: ['contact-keys'] })
  void queryClient.invalidateQueries({ queryKey: ['recipient-encryption'] })
}

/**
 * The keys known for one contact: which one Inlark uses, where each came from, and whether it
 * was verified. A changed or conflicting key is explained before anything else.
 */
export function ContactKeyDialog({ email, onClose }: { email?: string; onClose: () => void }) {
  const keys = useQuery({
    queryKey: ['contact-keys', email],
    queryFn: () => api.discoverEncryptionKeys(email!),
    enabled: !!email,
    retry: false,
  })
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  const refresh = async () => {
    setBusy('refresh')
    setError('')
    try {
      queryClient.setQueryData(
        ['contact-keys', email],
        await api.discoverEncryptionKeys(email!, true),
      )
      void queryClient.invalidateQueries({ queryKey: ['recipient-encryption'] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(undefined)
    }
  }
  const accept = async (fingerprint: string, confirmed: boolean) => {
    setBusy(fingerprint)
    setError('')
    try {
      keysChanged(await api.acceptEncryptionKey(email!, fingerprint, confirmed))
      await keys.refetch()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(undefined)
    }
  }
  const list = keys.data || []
  const current = list.find((k) => k.accepted && !k.retired)
  const active = list.filter((k) => !k.retired)
  const previous = list.filter((k) => k.retired)
  const changed = !!current && active.some((k) => k !== current && k.usable)
  const conflict = !current && active.filter((k) => k.usable).length > 1
  const card = (key: EncryptionKeySummary, old = false) => {
    const inUse = key === current
    return (
      <div
        key={key.fingerprint}
        className={cn(
          'key-card rounded-lg border border-solid p-3.5 [&+.key-card]:mt-2.5',
          inUse && !changed ? 'border-primary-solid/45' : 'border-border-strong',
          old && 'opacity-70',
        )}
      >
        <div className="key-card-heading flex items-center gap-2 flex-wrap mb-1">
          <strong className="text-[12px] font-medium text-strong">
            {old
              ? 'Previous key'
              : inUse
                ? 'Key in use'
                : changed
                  ? 'New key'
                  : 'Key ' + shortFingerprint(key.fingerprint).slice(-9)}
          </strong>
          {!old &&
            (key.confirmed ? (
              <KeyBadge tone="good" icon={BadgeCheck}>
                Verified
              </KeyBadge>
            ) : (
              <KeyBadge>Not verified</KeyBadge>
            ))}
          {key.problem && (
            <KeyBadge tone="danger">{keyProblems[key.problem] || 'Can’t be used'}</KeyBadge>
          )}
        </div>
        <p className="mt-0 mb-2.5 text-[11px] text-muted">Found in {keySources(key)}</p>
        <FingerprintBlock value={key.fingerprint} />
        {!old && key.usable && (!inUse || !key.confirmed) && (
          <div className="key-card-actions flex gap-2 mt-3">
            {!inUse && (
              <Button
                size="small"
                variant={conflict || changed ? 'default' : 'primary'}
                disabled={!!busy}
                onClick={() => void accept(key.fingerprint, false)}
              >
                {busy === key.fingerprint && <Spinner size={12} />}
                {changed ? 'Use the new key' : 'Use this key'}
              </Button>
            )}
            <Button
              size="small"
              variant={inUse ? 'primary' : 'default'}
              disabled={!!busy}
              onClick={() => void accept(key.fingerprint, true)}
            >
              <BadgeCheck size={13} />
              {inUse ? 'Mark as verified' : 'Use and mark verified'}
            </Button>
          </div>
        )}
      </div>
    )
  }
  return (
    <Modal
      open={!!email}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      title={'Keys for ' + (email || 'this contact')}
      description={'Inlark encrypts mail to ' + (email || 'them') + ' with the key in use.'}
      className="w-[min(520px,_calc(100vw_-_40px))]"
    >
      {keys.isPending && (
        <div className="flex items-center gap-2 py-6 justify-center text-muted text-[12px]">
          <Spinner size={14} /> Looking for keys…
        </div>
      )}
      {keys.isError && (
        <Callout tone="danger" icon={AlertCircle} title="Couldn’t look up keys">
          {friendlyError(keys.error)}
        </Callout>
      )}
      {keys.isSuccess && !list.length && (
        <Callout icon={Key} title="No key found">
          <p>
            {email} hasn’t published a key, and none came with their mail. Ask them to send you a
            message from an app with OpenPGP encryption, then check again.
          </p>
        </Callout>
      )}
      {changed && (
        <Callout
          tone="warning"
          icon={AlertCircle}
          title="This contact’s key changed"
          className="mb-4"
        >
          <p>
            This is normal after someone sets up a new device or app, but it can also mean someone
            is pretending to be them. Check the new fingerprint with {email} before using it.
          </p>
        </Callout>
      )}
      {conflict && (
        <Callout tone="warning" icon={AlertCircle} title="Choose the right key" className="mb-4">
          <p>Several keys were found for {email}. Ask them which fingerprint is theirs.</p>
        </Callout>
      )}
      {current && card(current)}
      {active.filter((k) => k !== current).map((k) => card(k))}
      {previous.length > 0 && (
        <div className="previous-keys mt-4">{previous.map((k) => card(k, true))}</div>
      )}
      {list.some((k) => !k.confirmed && !k.retired) && (
        <p className="mt-4 mb-0 text-[11px] leading-[1.6] text-muted">
          To verify a key, compare its fingerprint with {email} in person or on a call. If every
          group matches, only they can read what you encrypt to it.
        </p>
      )}
      {error && <FormError>{error}</FormError>}
      <div className={modalActions}>
        <Button
          variant="ghost"
          className="modal-action-start"
          disabled={!!busy || keys.isPending}
          onClick={() => void refresh()}
        >
          {busy === 'refresh' ? <Spinner size={14} /> : <RefreshCw size={14} />}
          Check again
        </Button>
        <Button onClick={onClose} disabled={!!busy}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
