import { cn } from '@inlark/ui'
import { ArrowUpRight, FileText, Trash2, X } from '@inlark/ui/icons'
import { Checkbox, IconButton } from '@inlark/ui'
import type { Account, Draft, Message } from '@inlark/core'
import { shortDate } from './mail-date'
import { useShortcutText } from './shortcuts'

export type DraftItem =
  { kind: 'local'; key: string; draft: Draft } | { kind: 'server'; key: string; message: Message }

/** A send whose delivery is unconfirmed must be resolved before its draft can go. */
export const deletable = (item: DraftItem) =>
  item.kind === 'server' || item.draft.status !== 'uncertain'

export function DraftRows({
  items,
  accounts,
  selected,
  onOpen,
  onSelect,
  onDelete,
}: {
  items: DraftItem[]
  accounts: Account[]
  selected: ReadonlySet<string>
  onOpen: (item: DraftItem) => void
  onSelect: (key: string, range: boolean) => void
  onDelete: (keys: string[]) => void
}) {
  const keys = useShortcutText()
  return (
    <div
      className={cn(
        'draft-rows [&:has(.selected)]:pb-22',
        '[&.selecting_.draft-selector:not(:has([data-disabled]))_.checkbox]:opacity-100',
        '[&.selecting_.draft-selector:not(:has([data-disabled]))>svg]:opacity-0',
        selected.size && 'selecting',
      )}
    >
      {items.map((item) => {
        const subject =
          item.kind === 'server' ? item.message.subject : item.draft.subject || 'New message'
        const canDelete = deletable(item)
        return (
          <div
            className={cn(
              'draft-row flex gap-4 items-center border-b border-solid border-b-border py-0 pr-6.5 pl-8 text-secondary',
              'hover:bg-hover [&.selected]:bg-selected',
              '[&:hover_.draft-selector:not(:has([data-disabled]))_.checkbox]:opacity-100',
              '[&:hover_.draft-selector:not(:has([data-disabled]))>svg]:opacity-0 [&:hover_.draft-actions_.button]:opacity-100',
              '[&:hover_.draft-actions:has(.button)>svg]:opacity-0',
              selected.has(item.key) && 'selected',
            )}
            key={item.key}
          >
            <span
              className={cn(
                'draft-selector [&_.checkbox]:absolute [&_.checkbox]:opacity-0 [&:focus-within_.checkbox]:opacity-100',
                '[&:focus-within>svg]:opacity-0 relative grid place-items-center shrink-0 w-4.25 h-4.25',
              )}
            >
              <FileText size={17} />
              <Checkbox
                aria-label={'Select ' + subject}
                checked={selected.has(item.key)}
                disabled={!canDelete}
                onCheckedChange={(_, event) => onSelect(item.key, !!(event as MouseEvent).shiftKey)}
              />
            </span>
            <button
              className={cn(
                'draft-open [&>div]:flex-1 [&>div]:min-w-0 [&_strong]:block [&_strong]:font-medium [&_strong]:text-[13px]',
                '[&_strong]:text-foreground [&_span]:block [&_span]:text-[11px] [&_span]:text-muted [&_span]:mt-1',
                '[&_small]:text-[11px] [&_small]:text-muted [&_time]:text-[11px] [&_time]:text-muted flex flex-1 gap-4',
                'items-center min-w-0 py-4.75 px-0 bg-none bg-transparent border-0 text-left',
              )}
              onClick={() => onOpen(item)}
            >
              <div>
                <strong>{subject}</strong>
                <span>
                  {item.kind === 'server'
                    ? accounts.find((a) => a.id === item.message.accountId)?.email
                    : item.draft.to.map((a) => a.email).join(', ') || 'No recipients yet'}
                </span>
              </div>
              <small>
                {item.kind === 'server'
                  ? 'Server draft'
                  : item.draft.status === 'uncertain'
                    ? 'Delivery unconfirmed'
                    : 'Saved draft'}
              </small>
              <time>
                {shortDate(item.kind === 'server' ? item.message.receivedAt : item.draft.updatedAt)}
              </time>
            </button>
            <span
              className={cn(
                'draft-actions [&_.button]:absolute [&_.button]:inset-0 [&_.button]:opacity-0',
                '[&:focus-within_.button]:opacity-100 [&:focus-within>svg]:opacity-0 relative grid place-items-center shrink-0',
                'w-7 h-7',
              )}
            >
              <ArrowUpRight size={14} aria-hidden="true" />
              {canDelete && (
                <IconButton
                  label="Delete draft"
                  shortcut={keys('trash')}
                  onClick={() => onDelete([item.key])}
                >
                  <Trash2 size={15} />
                </IconButton>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function DraftSelectionBar({
  count,
  total,
  onSelectAll,
  onDelete,
  onClear,
}: {
  count: number
  total: number
  onSelectAll: () => void
  onDelete: () => void
  onClear: () => void
}) {
  const keys = useShortcutText()
  return (
    <div
      className={cn(
        'selection-bar absolute z-10 bottom-12.5 left-[50%] transform-[translateX(-50%)] flex items-center gap-1.25',
        'py-2.5 px-3 max-w-[calc(100%_-_24px)] whitespace-nowrap border border-solid border-border-strong rounded-xl',
        'bg-raised shadow-[0_8px_28px_#0003,_0_2px_5px_#0002] animate-[selection-appear_140ms_ease-out]',
        '@max-[440px]/mail:gap-[2px] @max-[440px]/mail:p-2 @max-[440px]/mail:[&_.toolbar-divider]:my-0',
        '@max-[440px]/mail:[&_.toolbar-divider]:mx-[2px]',
      )}
      role="region"
      aria-label="Selection actions"
    >
      <div className="selection-summary flex flex-col gap-[2px] min-w-20.5 py-0 px-1.5 @max-[440px]/mail:min-w-18.5 @max-[440px]/mail:py-0 @max-[440px]/mail:px-1">
        <span
          className="selection-count text-[12px] text-foreground font-medium tabular-nums"
          role="status"
        >
          {count.toLocaleString()} selected
        </span>
        {total > count && (
          <button
            className="border-0 bg-none bg-transparent text-primary text-[11px] p-0 text-left hover:underline"
            onClick={onSelectAll}
          >
            Select all {total.toLocaleString()}
          </button>
        )}
      </div>
      <span className="toolbar-divider w-[1px] h-4.25 bg-border-strong my-0 mx-1" />
      <IconButton
        label={count > 1 ? 'Delete drafts' : 'Delete draft'}
        shortcut={keys('trash')}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </IconButton>
      <span className="toolbar-divider w-[1px] h-4.25 bg-border-strong my-0 mx-1" />
      <IconButton label="Clear selection" shortcut={keys('back')} onClick={onClear}>
        <X size={14} />
      </IconButton>
    </div>
  )
}
