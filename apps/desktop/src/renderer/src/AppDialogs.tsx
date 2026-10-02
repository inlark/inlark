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
  return (
    <Modal
      open={!!dialog}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={
        dialog?.operation === 'delete'
          ? 'Delete “' + name + '”?'
          : dialog?.operation === 'rename'
            ? 'Rename folder'
            : 'Create a folder'
      }
      description={
        dialog?.operation === 'delete'
          ? 'The folder is deleted on the server. Messages that are also in other folders stay there.'
          : undefined
      }
    >
      {dialog?.operation !== 'delete' && (
        <label>
          Folder name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim()) onSave(name)
            }}
          />
        </label>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant={dialog?.operation === 'delete' ? 'danger' : 'primary'}
          disabled={!name.trim()}
          onClick={() => onSave(name)}
        >
          {dialog?.operation === 'delete' ? 'Delete folder' : 'Save folder'}
        </Button>
      </div>
    </Modal>
  )
}

export function ConfirmActionDialog({
  action,
  total,
  onClose,
  onConfirm,
}: {
  action?: MailAction
  total: number
  onClose: () => void
  onConfirm: (action: MailAction) => void
}) {
  return (
    <Modal
      open={!!action}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={
        action === 'destroy'
          ? 'Permanently delete these conversations?'
          : 'Update all matching conversations?'
      }
      description={
        action === 'destroy'
          ? 'This removes messages from the server permanently and cannot be undone.'
          : 'This applies to all ' +
            total.toLocaleString() +
            ' matching conversations, including those beyond the loaded page. Partial failures will be reported.'
      }
    >
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant={action === 'destroy' ? 'danger' : 'primary'}
          onClick={() => {
            if (action) onConfirm(action)
          }}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  )
}
