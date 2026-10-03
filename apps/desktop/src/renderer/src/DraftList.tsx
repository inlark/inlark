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
    <div className={'draft-rows' + (selected.size ? ' selecting' : '')}>
      {items.map((item) => {
        const subject =
          item.kind === 'server' ? item.message.subject : item.draft.subject || 'New message'
        const canDelete = deletable(item)
        return (
          <div className={'draft-row' + (selected.has(item.key) ? ' selected' : '')} key={item.key}>
            <span className="draft-selector">
              <FileText size={17} />
              <Checkbox
                aria-label={'Select ' + subject}
                checked={selected.has(item.key)}
                disabled={!canDelete}
                onCheckedChange={(_, event) => onSelect(item.key, !!(event as MouseEvent).shiftKey)}
              />
            </span>
            <button className="draft-open" onClick={() => onOpen(item)}>
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
            <span className="draft-actions">
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
    <div className="selection-bar" role="region" aria-label="Selection actions">
      <div className="selection-summary">
        <span className="selection-count" role="status">
          {count.toLocaleString()} selected
        </span>
        {total > count && (
          <button className="text-action" onClick={onSelectAll}>
            Select all {total.toLocaleString()}
          </button>
        )}
      </div>
      <span className="toolbar-divider" />
      <IconButton
        label={count > 1 ? 'Delete drafts' : 'Delete draft'}
        shortcut={keys('trash')}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </IconButton>
      <span className="toolbar-divider" />
      <IconButton label="Clear selection" shortcut={keys('back')} onClick={onClear}>
        <X size={14} />
      </IconButton>
    </div>
  )
}
