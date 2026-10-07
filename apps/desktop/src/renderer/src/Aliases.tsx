import { cn } from '@inlark/ui'
import { useState } from 'react'
import { z } from 'zod'
import { AlertCircle, Plus, X } from '@inlark/ui/icons'
import { Button, IconButton, Modal, Spinner } from '@inlark/ui'
import { friendlyError, type Account, type AliasInput } from '@inlark/core'
import { api } from './api'
import { queryClient } from './cache'

const emailSchema = z.email()
const row = cn(
  'alias-row grid grid-cols-[minmax(0,_1fr)_200px_32px] gap-3 items-center min-h-12.5 py-2 px-0',
  '[&+.alias-row]:border-t [&+.alias-row]:border-solid [&+.alias-row]:border-t-border',
  'max-[700px]:grid-cols-[minmax(0,_1fr)_150px_32px]',
)
const formError =
  'form-error flex gap-2 text-[11px] leading-[1.6] my-3.75 mx-0 text-danger [&_svg]:shrink-0 [&_svg]:mt-[3px]'

/**
 * Settings → Accounts → Email addresses…: aliases this account may send from. They're only
 * used here; the provider must already deliver them to this account and accept them as sender.
 */
export function AliasesDialog({
  account,
  onClose,
  notify,
}: {
  account?: Account
  onClose: () => void
  notify: (message: string) => void
}) {
  const [aliases, setAliases] = useState<AliasInput[]>(account?.aliases || [])
  const [email, setEmail] = useState('')
  const [addError, setAddError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /** Why an address can't be added, if it can't. */
  const problem = (value: string) =>
    !emailSchema.safeParse(value).success
      ? 'Enter a valid email address.'
      : [account?.email || '', ...aliases.map((a) => a.email)].some(
            (known) => known.toLowerCase() === value.toLowerCase(),
          )
        ? 'This address is already listed.'
        : ''
  /** Adds what's typed in the new address field, and returns the list including it. */
  const add = () => {
    const value = email.trim()
    if (!value) return aliases
    const reason = problem(value)
    setAddError(reason)
    if (reason) return undefined
    const next = [...aliases, { email: value }]
    setAliases(next)
    setEmail('')
    return next
  }
  return (
    <Modal
      open={!!account}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={'Email addresses for ' + (account?.name || 'this account')}
      description="Send from aliases or custom-domain addresses that your provider delivers to this account. Set them up with your provider first; Inlark doesn’t create them."
      className="alias-modal w-[min(600px,_calc(100vw_-_40px))]"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!account) return
          // An address typed but not yet added is clearly meant to be saved too.
          const list = add()
          if (!list) return
          setSaving(true)
          setError('')
          try {
            await api.setAliases(
              account.id,
              list.map((a) => ({ id: a.id, email: a.email, name: a.name?.trim() || undefined })),
            )
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
              queryClient.invalidateQueries({ queryKey: ['identities', account.id] }),
            ])
            notify('Email addresses saved.')
            onClose()
          } catch (e) {
            setError(friendlyError(e))
          } finally {
            setSaving(false)
          }
        }}
      >
        <div className="alias-list grid">
          <div className={row}>
            <span className="alias-email min-w-0 text-[13px] [overflow-wrap:anywhere]">
              {account?.email}
            </span>
            <span className="alias-primary col-span-2 text-[11px] text-muted">Account address</span>
          </div>
          {aliases.map((alias, index) => (
            <div className={row} key={alias.id || alias.email}>
              <span className="alias-email min-w-0 text-[13px] [overflow-wrap:anywhere]">
                {alias.email}
              </span>
              <input
                className="alias-name h-8 py-0 px-2.5 text-[12px]"
                aria-label={'Name for ' + alias.email}
                value={alias.name || ''}
                maxLength={100}
                placeholder={account?.senderName || 'Your name'}
                disabled={saving}
                onChange={(e) =>
                  setAliases(
                    aliases.map((a, i) => (i === index ? { ...a, name: e.target.value } : a)),
                  )
                }
              />
              <IconButton
                label={'Remove ' + alias.email}
                disabled={saving}
                onClick={() => setAliases(aliases.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="alias-add flex gap-2 mt-3">
          <input
            className="h-8 py-0 px-2.5 text-[12px] aria-invalid:border-danger/70"
            type="email"
            aria-label="New email address"
            aria-invalid={!!addError}
            autoFocus
            value={email}
            maxLength={320}
            placeholder="alias@example.com"
            disabled={saving}
            onChange={(e) => {
              setEmail(e.target.value)
              setAddError('')
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              add()
            }}
          />
          <Button
            size="small"
            className="shrink-0"
            disabled={saving || !email.trim()}
            onClick={add}
          >
            <Plus size={13} />
            Add
          </Button>
        </div>
        {addError ? (
          <div role="alert" className={cn(formError, 'mt-2')}>
            <AlertCircle size={14} />
            {addError}
          </div>
        ) : (
          <p className="alias-hint mt-2 mb-0 text-[11px] leading-[1.6] text-muted">
            Addresses without a name of their own use the account’s.
          </p>
        )}
        {error && (
          <div role="alert" className={formError}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        <div className="modal-actions flex justify-end gap-2 mt-6">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving && <Spinner size={14} />}
            {saving ? 'Saving…' : 'Save addresses'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
