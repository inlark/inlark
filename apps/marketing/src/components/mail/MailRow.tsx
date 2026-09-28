import type { CSSProperties } from 'react'
import { Paperclip, Star } from '@inlark/ui/icons'
import { accountById, initials, type Account, type Conversation } from '../../data/mail'

export function AccountMark({ account, size = 16 }: { account: Account; size?: number }) {
  return (
    <span
      className="account-mark"
      title={account.name}
      style={
        { '--size': size + 'px', '--a': account.mark[0], '--b': account.mark[1] } as CSSProperties
      }
    />
  )
}

export function SenderTile({ name, tint }: { name: string; tint: string }) {
  return (
    <span className="sender-tile" style={{ '--tint': tint } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

/** One conversation in the list, laid out like the app's comfortable single-line row. */
export function MailRow({
  conversation: c,
  focused,
  compact,
}: {
  conversation: Conversation
  focused?: boolean
  compact?: boolean
}) {
  return (
    <div className={'mail-row' + (c.unread ? ' unread' : '') + (focused ? ' focused' : '')}>
      <span className="dot" />
      <span className="sender" style={compact ? { width: 128 } : undefined}>
        <SenderTile name={c.sender} tint={c.tint} />
        <span className="truncate">
          {c.sender}
          {c.count && <span className="thread-count">{c.count}</span>}
        </span>
      </span>
      <span className="content">
        <span className="subject">{c.subject}</span>
        {!compact && <span className="preview">{c.preview}</span>}
      </span>
      <span className="meta">
        {c.attachment && <Paperclip size={13} />}
        <AccountMark account={accountById[c.account]} size={14} />
        <time>{c.time}</time>
        <span className="star">
          {c.starred && <Star size={14} fill="currentColor" strokeWidth={1.6} />}
        </span>
      </span>
    </div>
  )
}
