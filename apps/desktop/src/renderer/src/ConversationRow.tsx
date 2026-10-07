import { cn } from '@inlark/ui'
import { Archive, Lock, Mail, MailOpen, Paperclip, Star, Trash2 } from '@inlark/ui/icons'
import { Checkbox, IconButton } from '@inlark/ui'
import { isDraft, type Account, type Conversation } from '@inlark/core'
import { shortDate } from './mail-date'
import { SenderAvatar } from './SenderAvatar'
import { AccountMark } from './AccountMark'
import { HintIconButton } from './HintIconButton'
import { actionLimit } from './account-limits'
import { useShortcutText } from './shortcuts'

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
  const keys = useShortcutText()
  const moveLimit = actionLimit(a, 'move')
  const subject = c.subject || '(No subject)'
  // An unsent reply is flagged rather than counted, so it never reads as sent.
  const drafts = c.messages.filter(isDraft).length
  const count = c.count - drafts
  return (
    <div
      className={cn(
        'mail-row flex items-center h-[var(--row-height)] py-0 pr-5 pl-7 gap-4 cursor-pointer border-b border-solid',
        'border-b-border text-[13px] relative hover:bg-hover',
        '[&:hover_.row-selector_.checkbox]:opacity-100 [&.selected_.row-selector_.checkbox]:opacity-100',
        '[&:hover_.unread-dot]:opacity-0 [&.selected_.unread-dot]:opacity-0 [&:hover_.row-star]:opacity-100',
        '[&:focus-within_.row-star]:opacity-100 [&:hover_.row-quick-actions]:opacity-100',
        '[&:hover_.row-quick-actions]:pointer-events-auto [&:focus-within_.row-quick-actions]:opacity-100',
        '[&:focus-within_.row-quick-actions]:pointer-events-auto @max-[900px]/mail:gap-3 @max-[900px]/mail:pl-5.5',
        '@max-[900px]/mail:pr-3.5 @max-[680px]/mail:py-0 @max-[680px]/mail:pr-4 @max-[680px]/mail:pl-5',
        '@max-[680px]/mail:gap-3 @max-[680px]/mail:[.density-comfortable_&]:grid',
        '@max-[680px]/mail:[.density-comfortable_&]:grid-cols-[16px_minmax(0,_1fr)_auto]',
        '@max-[680px]/mail:[.density-comfortable_&]:grid-rows-[22px_20px]',
        '@max-[680px]/mail:[.density-comfortable_&]:gap-[2px_12px]',
        '@max-[680px]/mail:[.density-comfortable_&]:content-center',
        c.unread && 'unread bg-[color-mix(in_srgb,_var(--surface)_32%,_var(--bg))]',
        (selected || focused) && 'bg-selected hover:bg-selected',
        selected && 'selected',
        focused && 'focused shadow-[inset_2px_0_var(--accent)]',
      )}
      role="row"
      id={'mail-' + encodeURIComponent(c.key)}
      aria-selected={selected}
      onClick={onOpen}
      onMouseDown={onFocus}
    >
      <div
        className={cn(
          'row-selector relative w-4 shrink-0 h-6 flex items-center justify-center [&_.checkbox]:absolute',
          '[&_.checkbox]:opacity-0 [&:focus-within_.checkbox]:opacity-100 [&:focus-within_.unread-dot]:opacity-0',
          '@max-[680px]/mail:[.density-comfortable_&]:col-start-1 @max-[680px]/mail:[.density-comfortable_&]:row-start-1',
          '@max-[680px]/mail:[.density-comfortable_&]:row-end-3',
        )}
        role="gridcell"
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          aria-label={'Select ' + subject}
          checked={selected}
          disabled={busy}
          onCheckedChange={(_, event) => onSelect(!!(event as MouseEvent).shiftKey)}
        />
        <span
          className={cn(
            'unread-dot w-1.25 h-1.25 rounded-full bg-primary opacity-0 pointer-events-none [&.visible]:opacity-100',
            c.unread && 'visible',
          )}
        />
      </div>
      <div
        className={cn(
          'row-sender flex items-center gap-2.5 w-[min(var(--sender-width,_180px),_38%)] shrink-0 text-secondary',
          '[&>span:not(.avatar)]:overflow-hidden [&>span:not(.avatar)]:text-ellipsis',
          '[&>span:not(.avatar)]:whitespace-nowrap [&_small]:text-muted [&_small]:text-[10px] [&_small]:py-0',
          '[&_small]:px-1 [&_small]:bg-surface [&_small]:rounded-xs [&_.avatar]:rounded-[7px]',
          '[&_.avatar]:[font-size:10px]!',
          '[&_.avatar]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,_var(--avatar-color)_9%,_transparent)]',
          '[.unread_&]:text-strong [.unread_&]:font-[550] [.density-compact_&_.avatar]:[width:24px]!',
          '[.density-compact_&_.avatar]:[height:24px]! @max-[900px]/mail:[&_.avatar]:hidden',
          '@max-[680px]/mail:[.density-comfortable_&]:col-start-2 @max-[680px]/mail:[.density-comfortable_&]:row-start-1',
          '@max-[680px]/mail:[.density-comfortable_&]:w-auto @max-[680px]/mail:[.density-comfortable_&]:min-w-0',
          '@max-[440px]/mail:[.density-compact_&]:text-[11px]',
        )}
        role="gridcell"
      >
        <SenderAvatar
          name={c.from[0]?.name || c.from[0]?.email || '?'}
          email={c.from[0]?.email}
          color={a?.color}
          size={28}
          remoteImages={remoteImages}
        />
        <span title={c.from.map((sender) => sender.email).join(', ')}>{senderLabel(c)}</span>
        {count > 1 && <small>{count}</small>}
        {drafts > 0 && (
          <span className="row-draft shrink-0 text-draft text-[11px] font-semibold">Draft</span>
        )}
      </div>
      <div
        className={cn(
          'row-content flex-1 min-w-0 flex flex-col gap-[3px] overflow-hidden whitespace-nowrap',
          '[.density-compact_&]:flex-row [.density-compact_&]:gap-3 [.density-compact_&]:items-baseline',
          '@max-[680px]/mail:[.density-comfortable_&]:col-start-2 @max-[680px]/mail:[.density-comfortable_&]:col-end-4',
          '@max-[680px]/mail:[.density-comfortable_&]:row-start-2 @max-[680px]/mail:[.density-comfortable_&]:flex-row',
          '@max-[680px]/mail:[.density-comfortable_&]:gap-2.5 @max-[680px]/mail:[.density-comfortable_&]:items-baseline',
        )}
        role="gridcell"
      >
        <span
          className={cn(
            'row-subject overflow-hidden text-ellipsis text-secondary leading-[20px] [.unread_&]:text-strong',
            '[.unread_&]:font-[550] [.density-compact_&]:max-w-[75%] [.density-compact_&]:shrink-0',
            '@max-[900px]/mail:[.density-compact_&]:max-w-full @max-[680px]/mail:[.density-comfortable_&]:shrink-0',
            '@max-[680px]/mail:[.density-comfortable_&]:max-w-[75%] @max-[680px]/mail:[.density-comfortable_&]:text-[12px]',
            '@max-[440px]/mail:[.density-comfortable_&]:max-w-full @max-[440px]/mail:[.density-compact_&]:text-[12px]',
          )}
        >
          {subject}
        </span>
        <span className="row-preview overflow-hidden text-ellipsis text-muted text-[12px] leading-[18px] @max-[900px]/mail:[.density-compact_&]:hidden @max-[440px]/mail:[.density-comfortable_&]:hidden">
          {c.preview ||
            // Encrypted mail has no readable preview; say why the line is empty.
            (c.messages.some((m) => m.security?.encrypted) && (
              <span className="row-encrypted inline-flex items-center gap-1 text-faint">
                <Lock size={11} />
                Encrypted message
              </span>
            ))}
        </span>
      </div>
      <div
        className={cn(
          'row-meta flex items-center gap-2.25 text-muted shrink-0 relative [&_time]:w-14.5 [&_time]:text-right',
          '[&_time]:text-[11px] [&_time]:tabular-nums @max-[680px]/mail:[.density-comfortable_&]:col-start-3',
          '@max-[680px]/mail:[.density-comfortable_&]:row-start-1 @max-[680px]/mail:[.density-comfortable_&]:gap-1.75',
          '@max-[680px]/mail:[&_time]:text-[10px] @max-[680px]/mail:[&_time]:w-13.5 @max-[680px]/mail:gap-1.5',
          '@max-[440px]/mail:[.density-compact_&_time]:hidden',
        )}
        role="gridcell"
      >
        <span className="row-attachment w-3.25">
          {c.hasAttachment && <Paperclip size={13} aria-label="Has attachments" />}
        </span>
        {a && <AccountMark account={a} size={22} title={a.name} />}
        <time dateTime={c.receivedAt} title={new Date(c.receivedAt).toLocaleString()}>
          {shortDate(c.receivedAt)}
        </time>
        <button
          className={cn(
            'row-star grid place-items-center bg-none bg-transparent border-0 rounded-sm p-1.25 text-faint opacity-0',
            'transition-[opacity,color,background-color] duration-120 ease-[ease]',
            '[&_svg]:[transition:fill_120ms_ease,_transform_160ms_cubic-bezier(0.3,_1.5,_0.6,_1)] [&.starred]:opacity-100',
            '[&:hover:not(:disabled)]:text-secondary [&:hover:not(:disabled)]:bg-strong/8',
            '[&:active:not(:disabled)_svg]:transform-[scale(0.85)] [&.starred]:text-star',
            '[&.starred:hover:not(:disabled)]:text-star [&.starred_svg]:fill-current @max-[680px]/mail:p-[3px]',
            c.starred && 'starred [&:is(svg)]:fill-current text-star',
          )}
          aria-label={(c.starred ? 'Unstar ' : 'Star ') + subject}
          aria-pressed={c.starred}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onStar()
          }}
        >
          <Star size={14} />
        </button>
        <div
          className="row-quick-actions absolute right-7.5 flex gap-[2px] p-[2px] border border-solid border-border-strong rounded-md bg-raised shadow-[0_2px_6px_#0002] opacity-0 pointer-events-none"
          onClick={(event) => event.stopPropagation()}
        >
          <IconButton
            label={c.unread ? 'Mark as read' : 'Mark as unread'}
            shortcut={keys(c.unread ? 'read' : 'unread')}
            disabled={busy}
            onClick={onToggleRead}
          >
            {c.unread ? <MailOpen size={15} /> : <Mail size={15} />}
          </IconButton>
          {onArchive && (
            <HintIconButton
              label="Archive"
              shortcut={keys('archive')}
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
              shortcut={keys('trash')}
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
