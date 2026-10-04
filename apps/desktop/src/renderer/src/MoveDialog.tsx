import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, Search } from '@inlark/ui/icons'
import { Modal, Spinner } from '@inlark/ui'
import { friendlyError, type Bootstrap, type Mailbox, type MutationTarget } from '@inlark/core'
import { api } from './api'
import { actionLimit } from './account-limits'

/** Folders whose name contains the typed text, those starting with it first. */
export function matchFolders<T extends Pick<Mailbox, 'name'>>(folders: T[], text: string): T[] {
  const query = text.trim().toLowerCase()
  if (!query) return folders
  const starts = (name: string) =>
    name.startsWith(query) || name.split(/[\s/._-]+/).some((word) => word.startsWith(query))
  const found = folders.filter((f) => f.name.toLowerCase().includes(query))
  return [
    ...found.filter((f) => starts(f.name.toLowerCase())),
    ...found.filter((f) => !starts(f.name.toLowerCase())),
  ]
}

export function MoveDialog({
  targets,
  accounts,
  onClose,
  onMove,
}: {
  targets?: MutationTarget[]
  accounts: Bootstrap['accounts']
  onClose: () => void
  onMove: (id: string) => void
}) {
  const ids = new Set(targets?.map((t) => t.accountId))
  const accountId = targets?.[0]?.accountId || ''
  const limit = actionLimit(
    accounts.find((a) => a.id === accountId),
    'move',
  )
  const boxes = useQuery({
    queryKey: ['mailboxes', accountId],
    queryFn: () => api.mailboxes(accountId),
    enabled: !!targets && ids.size === 1,
  })
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const open = !!targets
  useEffect(() => {
    if (open) {
      setText('')
      setActive(0)
    }
  }, [open])
  const folders = matchFolders(
    (boxes.data || []).filter(
      (b) => b.rights.mayAddItems && b.role !== 'drafts' && b.role !== 'sent',
    ),
    text,
  )
  const highlighted = Math.max(0, Math.min(active, folders.length - 1))
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, text])
  const choosable = ids.size === 1 && !limit
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Move to folder"
      description={
        ids.size > 1
          ? 'Select conversations within one account to move them to a folder.'
          : accounts.find((a) => a.id === accountId)?.email
      }
      className="move-modal"
    >
      {limit && <p className="modal-body-text">{limit}</p>}
      {choosable && (
        <>
          <div className="folder-search">
            <Search size={14} />
            <input
              autoFocus
              value={text}
              placeholder="Find a folder"
              aria-label="Find a folder"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={folders.length ? listId + '-' + highlighted : undefined}
              onChange={(event) => {
                setText(event.target.value)
                setActive(0)
              }}
              onKeyDown={(event) => {
                const step =
                  event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')
                    ? 1
                    : event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')
                      ? -1
                      : 0
                if (step && folders.length) {
                  event.preventDefault()
                  setActive((highlighted + step + folders.length) % folders.length)
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (folders[highlighted]) onMove(folders[highlighted].id)
                }
              }}
            />
          </div>
          <div className="folder-picker" role="listbox" id={listId} aria-label="Folders" ref={list}>
            {folders.map((b, i) => (
              <button
                key={b.id}
                id={listId + '-' + i}
                role="option"
                aria-selected={i === highlighted}
                tabIndex={-1}
                className={i === highlighted ? 'active' : ''}
                onMouseMove={() => i !== highlighted && setActive(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onMove(b.id)}
              >
                <Folder size={15} />
                <span>{b.name}</span>
                <ChevronRight size={13} />
              </button>
            ))}
            {boxes.isLoading && (
              <div className="folder-picker-note" role="status">
                <Spinner size={14} />
                Loading folders…
              </div>
            )}
            {boxes.isError && (
              <div className="folder-picker-note" role="alert">
                {friendlyError(boxes.error)}
              </div>
            )}
            {boxes.data && !folders.length && (
              <div className="folder-picker-note">
                {text.trim() ? 'No folders match “' + text.trim() + '”' : 'No folders to move to'}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
