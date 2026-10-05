import { cn } from '@inlark/ui'
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
      className="move-modal w-[min(440px,_calc(100vw_-_40px))]"
    >
      {limit && (
        <p className="modal-body-text m-0 text-[12px] leading-[1.6] text-secondary">{limit}</p>
      )}
      {choosable && (
        <>
          <div
            className={cn(
              'folder-search flex items-center gap-2 h-9 mb-2 py-0 px-2.75 text-muted bg-field border border-solid',
              'border-border-strong rounded-[7px] transition-[border-color,box-shadow] duration-120 ease-[ease]',
              'focus-within:border-primary-solid focus-within:shadow-[0_0_0_3px_var(--accent-tint)] [&_input]:h-full',
              '[&_input]:p-0 [&_input]:text-[12px] [&_input]:bg-none [&_input]:bg-transparent [&_input]:border-0',
              '[&_input:focus-visible]:outline-none',
            )}
          >
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
          <div
            className={cn(
              'folder-picker [&_button]:w-full [&_button]:flex [&_button]:items-center [&_button]:gap-3 [&_button]:bg-none',
              '[&_button]:bg-transparent [&_button]:border-0 [&_button]:py-2.5 [&_button]:px-3 [&_button]:rounded-md',
              '[&_button]:text-[12px] [&_button]:text-left [&_button]:text-secondary [&_button>span]:flex-1',
              '[&_button>span]:min-w-0 [&_button>span]:overflow-hidden [&_button>span]:text-ellipsis',
              '[&_button>span]:whitespace-nowrap [&_button_svg]:text-muted [&_button.active]:bg-hover',
              '[&_button.active]:text-strong [&_button.active_svg]:text-strong max-h-[min(340px,_calc(100vh_-_280px))]',
              'overflow-y-auto my-0 -mx-1.5 py-0 px-1.5',
            )}
            role="listbox"
            id={listId}
            aria-label="Folders"
            ref={list}
          >
            {folders.map((b, i) => (
              <button
                key={b.id}
                id={listId + '-' + i}
                role="option"
                aria-selected={i === highlighted}
                tabIndex={-1}
                className={cn(i === highlighted && 'active')}
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
              <div
                className="folder-picker-note flex items-center gap-2 py-3.5 px-3 text-[12px] text-muted"
                role="status"
              >
                <Spinner size={14} />
                Loading folders…
              </div>
            )}
            {boxes.isError && (
              <div
                className="folder-picker-note flex items-center gap-2 py-3.5 px-3 text-[12px] text-muted"
                role="alert"
              >
                {friendlyError(boxes.error)}
              </div>
            )}
            {boxes.data && !folders.length && (
              <div className="folder-picker-note flex items-center gap-2 py-3.5 px-3 text-[12px] text-muted">
                {text.trim() ? 'No folders match “' + text.trim() + '”' : 'No folders to move to'}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
