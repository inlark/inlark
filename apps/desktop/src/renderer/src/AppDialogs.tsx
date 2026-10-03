import { Fragment, useState } from 'react'
import { Button, DatePicker, Modal, Switch } from '@inlark/ui'
import type { MailAction, Mailbox, MailQuery } from '@inlark/core'
import { ShortcutEditor } from './ShortcutEditor'

export function ShortcutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title="Keyboard shortcuts"
      description="Click any keys to change them, or + to add another. Letter shortcuts are paused while you type in a field."
      className="shortcut-modal"
    >
      <ShortcutEditor />
    </Modal>
  )
}

const filterKeys = ['from', 'to', 'subject', 'after', 'before', 'hasAttachment'] as const

export function FilterDialog({
  open,
  filters,
  onClose,
  onApply,
}: {
  open: boolean
  filters: Partial<MailQuery>
  onClose: () => void
  onApply: (filters: Partial<MailQuery>) => void
}) {
  const [values, setValues] = useState<Partial<MailQuery>>(filters)
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title="Filter conversations"
      description="Searches your whole mailbox on the server, not just what’s loaded."
      className="filter-modal"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onApply(values)
        }}
      >
        <div className="filter-fields">
          {(['from', 'to'] as const).map((key) => (
            <label key={key}>
              {{ from: 'From', to: 'To' }[key]}
              <input
                value={values[key] || ''}
                placeholder="Name or address"
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value || undefined }))
                }
              />
            </label>
          ))}
          <label className="filter-wide">
            Subject
            <input
              value={values.subject || ''}
              placeholder="Contains these words"
              onChange={(event) =>
                setValues((current) => ({ ...current, subject: event.target.value || undefined }))
              }
            />
          </label>
          <div className="filter-field filter-wide">
            <span>Date</span>
            <div className="filter-date-range">
              {(['after', 'before'] as const).map((key, index) => (
                <Fragment key={key}>
                  {index > 0 && <span className="filter-date-separator">to</span>}
                  <DatePicker
                    aria-label={{ after: 'After', before: 'Before' }[key]}
                    placeholder={{ after: 'Start date', before: 'End date' }[key]}
                    value={values[key]?.slice(0, 10)}
                    onValueChange={(day) =>
                      setValues((current) => ({
                        ...current,
                        [key]: day ? new Date(day).toISOString() : undefined,
                      }))
                    }
                  />
                </Fragment>
              ))}
            </div>
          </div>
          <div className="filter-switch filter-wide">
            <span>
              <strong>Has attachments</strong>
              <small>Only show conversations with files attached.</small>
            </span>
            <Switch
              aria-label="Has attachments"
              checked={!!values.hasAttachment}
              onCheckedChange={(checked) =>
                setValues((current) => ({ ...current, hasAttachment: checked || undefined }))
              }
            />
          </div>
        </div>
        <div className="modal-actions filter-actions">
          <Button
            variant="ghost"
            disabled={!filterKeys.some((key) => values[key])}
            onClick={() =>
              setValues((current) => ({
                ...current,
                ...Object.fromEntries(filterKeys.map((key) => [key, undefined])),
              }))
            }
          >
            Clear all
          </Button>
          <Button variant="primary" type="submit">
            Show results
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export type FolderDialogState = {
  operation: 'create' | 'rename' | 'delete'
  accountId?: string
  folder?: Mailbox
}

export function FolderDialog({
  dialog,
  onClose,
  onSave,
}: {
  dialog?: FolderDialogState
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(dialog?.folder?.name || '')
  const operation = dialog?.operation
  // Renaming to the same name would only make a round trip to the server.
  const ready = !!name.trim() && !(operation === 'rename' && name.trim() === dialog?.folder?.name)
  return (
    <Modal
      open={!!dialog}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={
        operation === 'delete'
          ? 'Delete “' + name + '”?'
          : operation === 'rename'
            ? 'Rename folder'
            : 'Create a folder'
      }
      description={
        operation === 'delete'
          ? 'The folder is deleted on the server. Messages that are also in other folders stay there.'
          : undefined
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) onSave(name)
        }}
      >
        {operation !== 'delete' && (
          <label className="modal-field">
            Folder name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        )}
        <div className="modal-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant={operation === 'delete' ? 'danger' : 'primary'}
            disabled={!ready}
          >
            {operation === 'delete'
              ? 'Delete folder'
              : operation === 'rename'
                ? 'Rename folder'
                : 'Create folder'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Names the action and how many conversations it reaches, so the choice is never vague. */
export function confirmActionCopy(action: MailAction, count: number) {
  const n = count.toLocaleString()
  const them = count === 1 ? 'this conversation' : 'all ' + n + ' conversations'
  if (action === 'destroy')
    return {
      title:
        count === 1
          ? 'Delete this conversation permanently?'
          : 'Delete ' + n + ' conversations permanently?',
      description:
        (count === 1 ? 'Its' : 'Their') +
        ' messages are removed from the server. This can’t be undone.',
      confirm: 'Delete permanently',
    }
  const copy: Record<Exclude<MailAction, 'destroy'>, [title: string, confirm: string]> = {
    archive: ['Archive ' + them + '?', 'Archive'],
    trash: ['Move ' + them + ' to trash?', 'Move to trash'],
    spam: ['Mark ' + them + ' as spam?', 'Mark as spam'],
    notSpam: ['Move ' + them + ' to the inbox?', 'Not spam'],
    read: ['Mark ' + them + ' as read?', 'Mark as read'],
    unread: ['Mark ' + them + ' as unread?', 'Mark as unread'],
    star: ['Star ' + them + '?', 'Star'],
    unstar: ['Remove the star from ' + them + '?', 'Remove star'],
    move: ['Move ' + them + '?', 'Move'],
    restore: ['Restore ' + them + ' to the inbox?', 'Restore'],
  }
  const [title, confirm] = copy[action]
  return {
    title,
    description:
      'Includes conversations that haven’t loaded yet. Inlark tells you about any it couldn’t change.',
    confirm,
  }
}

export function ConfirmActionDialog({
  action,
  count,
  onClose,
  onConfirm,
}: {
  action?: MailAction
  /** How many conversations the action reaches. */
  count: number
  onClose: () => void
  onConfirm: (action: MailAction) => void
}) {
  // Keep the wording while the dialog fades out after the action is cleared.
  const [shown, setShown] = useState({ action, count })
  if (action && (action !== shown.action || count !== shown.count)) setShown({ action, count })
  const copy = shown.action && confirmActionCopy(shown.action, shown.count)
  return (
    <Modal
      open={!!action}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={copy ? copy.title : ''}
      description={copy?.description}
    >
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant={shown.action === 'destroy' ? 'danger' : 'primary'}
          onClick={() => {
            if (action) onConfirm(action)
          }}
        >
          {copy?.confirm}
        </Button>
      </div>
    </Modal>
  )
}
