import { Archive, Mail, MailOpen, Paperclip, Star, Trash2 } from '@inlark/ui/icons'
import { Checkbox, IconButton } from '@inlark/ui'
import type { Account, Conversation } from '@inlark/core'
import { shortDate } from './mail-date'
import { SenderAvatar } from './SenderAvatar'
import { AccountMark } from './AccountMark'
import { HintIconButton } from './HintIconButton'
import { actionLimit } from './account-limits'

export function senderLabel(conversation: Conversation) {
  return conversation.from.map((sender) => sender.name || sender.email.split('@')[0]).join(', ')
}

export function ConversationRow({
  conversation: c,
  account: a,
  selected,
  focused,
  busy,
  remoteImages,
  onOpen,
  onFocus,
  onSelect,
  onStar,
  onArchive,
  onTrash,
  onToggleRead,
}: {
  conversation: Conversation
  account?: Account
  selected: boolean
  focused: boolean
  busy: boolean
  remoteImages: boolean
  onOpen: () => void
  onFocus: () => void
  onSelect: (range: boolean) => void
  onStar: () => void
  onArchive?: () => void
  onTrash?: () => void
  onToggleRead: () => void
}) {
  const moveLimit = actionLimit(a, 'move')
  return (
    <div
      className={
        'mail-row ' +
        (c.unread ? 'unread ' : '') +
        (selected ? 'selected ' : '') +
        (focused ? 'focused' : '')
      }
      role="row"
      id={'mail-' + encodeURIComponent(c.key)}
      aria-selected={selected}
      onClick={onOpen}
      onMouseDown={onFocus}
    >
      <div className="row-selector" role="gridcell" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={'Select ' + c.subject}
          checked={selected}
          disabled={busy}
          onCheckedChange={(_, event) => onSelect(!!(event as MouseEvent).shiftKey)}
        />
        <span className={'unread-dot ' + (c.unread ? 'visible' : '')} />
      </div>
      <div className="row-sender" role="gridcell">
        <SenderAvatar
          name={c.from[0]?.name || c.from[0]?.email || '?'}
          email={c.from[0]?.email}
          color={a?.color}
          size={28}
          remoteImages={remoteImages}
        />
        <span title={c.from.map((sender) => sender.email).join(', ')}>{senderLabel(c)}</span>
        {c.count > 1 && <small>{c.count}</small>}
      </div>
      <div className="row-content" role="gridcell">
        <span className="row-subject">{c.subject || '(No subject)'}</span>
        <span className="row-preview">{c.preview}</span>
      </div>
      <div className="row-meta" role="gridcell">
        <span className="row-attachment">
          {c.hasAttachment && <Paperclip size={13} aria-label="Has attachments" />}
        </span>
        {a && <AccountMark account={a} size={22} title={a.name} />}
        <time dateTime={c.receivedAt} title={new Date(c.receivedAt).toLocaleString()}>
          {shortDate(c.receivedAt)}
        </time>
        <button
          className={'row-star ' + (c.starred ? 'starred' : '')}
          aria-label={c.starred ? 'Unstar ' + c.subject : 'Star ' + c.subject}
          aria-pressed={c.starred}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onStar()
          }}
        >
          <Star size={14} />
        </button>
        <div className="row-quick-actions" onClick={(event) => event.stopPropagation()}>
          <IconButton
            label={c.unread ? 'Mark as read' : 'Mark as unread'}
            shortcut={c.unread ? 'Shift I' : 'U'}
            disabled={busy}
            onClick={onToggleRead}
          >
            {c.unread ? <MailOpen size={15} /> : <Mail size={15} />}
          </IconButton>
          {onArchive && (
            <HintIconButton
              label="Archive"
              shortcut="E"
              disabled={busy}
              hint={moveLimit}
              onClick={onArchive}
            >
              <Archive size={15} />
            </HintIconButton>
          )}
          {onTrash && (
            <HintIconButton
              label="Move to trash"
              shortcut="#"
              disabled={busy}
              hint={moveLimit}
              onClick={onTrash}
            >
              <Trash2 size={15} />
            </HintIconButton>
          )}
        </div>
      </div>
    </div>
  )
}
