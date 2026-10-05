import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Check } from '@inlark/ui/icons'
import { Button, Modal, Select, Spinner } from '@inlark/ui'
import {
  folderRoles,
  friendlyError,
  type Account,
  type FolderMappingReview,
  type FolderMappings,
  type FolderRole,
} from '@inlark/core'
import { api } from './api'
import { queryClient } from './cache'

const roles: Record<FolderRole, { label: string; description: string; create: string }> = {
  sent: { label: 'Sent', description: 'Copies of messages you send.', create: 'Sent' },
  drafts: { label: 'Drafts', description: 'Messages you haven’t sent yet.', create: 'Drafts' },
  archive: {
    label: 'Archive',
    description: 'Where Archive moves conversations.',
    create: 'Archive',
  },
  junk: { label: 'Spam', description: 'Where Mark as spam moves conversations.', create: 'Junk' },
  trash: {
    label: 'Trash',
    description: 'Where Move to trash puts conversations.',
    create: 'Trash',
  },
}

/** A role is settled when the server declared it, the user chose it, or it is explicitly none. */
const settled = (review: FolderMappingReview, role: FolderRole) => {
  const mapping = review.mappings[role]
  return mapping === null || (!!mapping && mapping.source !== 'name')
}

export const needsFolderReview = (review: FolderMappingReview) =>
  folderRoles.some((role) => !settled(review, role))

/** What the review proposes: known folders as they are, a new folder for each missing role. */
export function initialFolderChoices(review: FolderMappingReview): FolderMappings {
  const choices: FolderMappings = {}
  for (const role of folderRoles) {
    const mapping = review.mappings[role]
    if (mapping === null) choices[role] = null
    else if (mapping) choices[role] = { path: mapping.path }
    else {
      const name = roles[role].create
      const existing = review.folders.find((f) => f.path.toLowerCase() === name.toLowerCase())
      choices[role] = existing ? { path: existing.path } : { path: name, create: true }
    }
  }
  return choices
}

const encode = (choice: FolderMappings[FolderRole]) =>
  choice === null || choice === undefined
    ? 'none'
    : choice.create
      ? 'create:' + choice.path
      : 'path:' + choice.path

/** One row per folder role: pick an existing folder, create one, or use none. */
export function FolderMappingEditor({
  review,
  value,
  onChange,
  disabled,
}: {
  review: FolderMappingReview
  value: FolderMappings
  onChange: (next: FolderMappings) => void
  disabled?: boolean
}) {
  // The server's Inbox can't hold any of these roles.
  const folders = review.folders.filter((f) => f.path.toUpperCase() !== 'INBOX')
  const proposal = useMemo(() => initialFolderChoices(review), [review])
  return (
    <div className="folder-roles grid">
      {folderRoles.map((role) => {
        const info = roles[role]
        const mapping = review.mappings[role]
        const choice = value[role]
        const createName = choice?.create ? choice.path : info.create
        const canCreate = !folders.some((f) => f.path.toLowerCase() === createName.toLowerCase())
        const options = [
          ...folders.map((f) => ({
            value: 'path:' + f.path,
            label: f.path === f.name ? f.name : f.path,
          })),
          ...(canCreate
            ? [{ value: 'create:' + createName, label: 'Create “' + createName + '”' }]
            : []),
          { value: 'none', label: 'None' },
        ]
        const changed = encode(choice) !== encode(proposal[role])
        const status = changed
          ? { text: 'Your choice', tone: 'confirmed' }
          : mapping?.source === 'server'
            ? { text: 'Set by the server', tone: 'confirmed' }
            : mapping?.source === 'user'
              ? { text: 'Your choice', tone: 'confirmed' }
              : mapping === null
                ? { text: 'Not used', tone: '' }
                : mapping?.source === 'name' || !proposal[role]?.create
                  ? { text: 'Guessed from the name · check this', tone: 'uncertain' }
                  : { text: 'Not found on the server · check this', tone: 'uncertain' }
        const id = 'folder-role-' + role
        return (
          <div className="folder-role" key={role}>
            <div className="folder-role-text flex flex-wrap items-baseline gap-[2px_10px] min-w-0">
              <label htmlFor={id}>
                <strong>{info.label}</strong>
              </label>
              <span className={'folder-role-status ' + status.tone}>
                {status.tone === 'confirmed' ? (
                  <Check size={11} />
                ) : status.tone === 'uncertain' ? (
                  <span
                    className="folder-role-dot w-1.5 h-1.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                ) : null}
                {status.text}
              </span>
              <p>{info.description}</p>
            </div>
            <Select
              id={id}
              aria-label={info.label + ' folder'}
              className="folder-role-select"
              disabled={disabled}
              value={encode(choice)}
              options={options}
              onValueChange={(next) =>
                onChange({
                  ...value,
                  [role]:
                    next === 'none'
                      ? null
                      : next.startsWith('create:')
                        ? { path: next.slice(7), create: true }
                        : { path: next.slice(5) },
                })
              }
            />
          </div>
        )
      })}
    </div>
  )
}

/** Settings → Accounts → Folders…: the same editor as setup, saved straight to the account. */
export function FolderMappingsDialog({
  account,
  onClose,
  notify,
}: {
  account?: Account
  onClose: () => void
  notify: (message: string) => void
}) {
  const accountId = account?.id || ''
  const review = useQuery({
    queryKey: ['folder-mappings', accountId],
    queryFn: () => api.folderMappings(accountId),
    enabled: !!account,
    staleTime: 0,
  })
  const [choices, setChoices] = useState<FolderMappings>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setChoices(review.data ? initialFolderChoices(review.data) : undefined)
    setError('')
  }, [review.data])
  return (
    <Modal
      open={!!account}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={'Folders for ' + (account?.name || 'this account')}
      description="Choose where Inlark keeps sent mail and drafts, and where Archive, Mark as spam and Move to trash put conversations."
      className="folder-modal w-[min(600px,_calc(100vw_-_40px))]"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!choices || !account) return
          setSaving(true)
          setError('')
          try {
            const saved = await api.setFolderMappings(account.id, choices)
            queryClient.setQueryData(['folder-mappings', account.id], saved)
            await queryClient.invalidateQueries({ queryKey: ['mailboxes', account.id] })
            notify('Folder settings saved.')
            onClose()
          } catch (e) {
            setError(friendlyError(e))
          } finally {
            setSaving(false)
          }
        }}
      >
        {review.isError ? (
          <div role="alert" className="form-error">
            <AlertCircle size={14} />
            {friendlyError(review.error)}
          </div>
        ) : review.data && choices ? (
          <FolderMappingEditor
            review={review.data}
            value={choices}
            onChange={setChoices}
            disabled={saving}
          />
        ) : (
          <div
            className="folder-roles-loading flex items-center gap-2 py-5 px-0 text-[12px] text-muted"
            role="status"
          >
            <Spinner size={14} />
            Loading folders…
          </div>
        )}
        {error && (
          <div role="alert" className="form-error">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!choices || saving}>
            {saving && <Spinner size={14} />}
            {saving ? 'Saving…' : 'Save folders'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
