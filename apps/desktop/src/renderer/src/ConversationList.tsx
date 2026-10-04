import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  memo,
} from 'react'
import type { Ref, RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Account, Conversation, MailAction, View } from '@inlark/core'
import { Spinner } from '@inlark/ui'
import { ConversationRow, senderLabel } from './ConversationRow'
import { day } from './mail-date'
import { offersAction } from './view-actions'

export type ConversationListHandle = {
  scrollToConversation: (key: string) => void
}

type Row = { group: string } | { conversation: Conversation }

const ListConversationRow = memo(function ListConversationRow({
  conversation,
  account,
  selected,
  focused,
  busy,
  remoteImages,
  view,
  onOpen,
  onFocus,
  onSelect,
  onAction,
}: {
  conversation: Conversation
  account?: Account
  selected: boolean
  focused: boolean
  busy: boolean
  remoteImages: boolean
  view: View
  onOpen: (conversation: Conversation) => void
  onFocus: (key: string) => void
  onSelect: (key: string, range: boolean) => void
  onAction: (action: MailAction, conversation: Conversation) => void
}) {
  return (
    <ConversationRow
      conversation={conversation}
      account={account}
      selected={selected}
      focused={focused}
      onOpen={() => onOpen(conversation)}
      onFocus={() => onFocus(conversation.key)}
      onSelect={(range) => onSelect(conversation.key, range)}
      busy={busy}
      remoteImages={remoteImages}
      onArchive={
        offersAction(view, 'archive') ? () => onAction('archive', conversation) : undefined
      }
      onTrash={offersAction(view, 'trash') ? () => onAction('trash', conversation) : undefined}
      onToggleRead={() => onAction(conversation.unread ? 'read' : 'unread', conversation)}
      onStar={() => onAction(conversation.starred ? 'unstar' : 'star', conversation)}
    />
  )
})

export function ConversationList({
  conversations,
  accounts,
  queryId,
  total,
  density,
  selected,
  allMatching,
  focused,
  busy,
  remoteImages,
  view,
  hasNextPage,
  isFetchingNextPage,
  listRef,
  handleRef,
  offsets,
  onFetchNextPage,
  onOpen,
  onFocus,
  onSelect,
  onAction,
}: {
  conversations: Conversation[]
  accounts: Account[]
  queryId: string
  total: number
  density: 'compact' | 'comfortable'
  selected: Set<string>
  allMatching: boolean
  focused: string
  busy: boolean
  remoteImages: boolean
  view: View
  hasNextPage: boolean
  isFetchingNextPage: boolean
  listRef: RefObject<HTMLDivElement | null>
  handleRef: Ref<ConversationListHandle>
  offsets: RefObject<Map<string, number>>
  onFetchNextPage: () => void
  onOpen: (conversation: Conversation) => void
  onFocus: (key: string) => void
  onSelect: (key: string, range: boolean) => void
  onAction: (action: MailAction, conversation: Conversation) => void
}) {
  const rowHeight = density === 'compact' ? 44 : 64
  const groupHeight = 36
  const scrollAnchor = useRef<{ query: string; key: string; delta: number } | undefined>(undefined)
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  )
  const rows = useMemo(() => {
    const result: Row[] = []
    let previous = ''
    for (const conversation of conversations) {
      const group = day(conversation.receivedAt)
      if (group !== previous) {
        result.push({ group })
        previous = group
      }
      result.push({ conversation })
    }
    return result
  }, [conversations])
  const senderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const conversation of conversations) {
      const label = senderLabel(conversation)
      counts.set(label, Math.max(counts.get(label) || 0, conversation.count))
    }
    return counts
  }, [conversations])
  const estimateSize = useCallback(
    (index: number) => ('group' in rows[index] ? groupHeight : rowHeight),
    [rows, rowHeight],
  )
  const getItemKey = useCallback(
    (index: number) =>
      'group' in rows[index] ? 'group-' + rows[index].group : rows[index].conversation.key,
    [rows],
  )
  const virtual = useVirtualizer({
    initialOffset: () => offsets.current.get(queryId) || 0,
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize,
    getItemKey,
    overscan: 6,
  })
  const items = virtual.getVirtualItems()
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !conversations.length || !items.length) return

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    const measure = () => {
      const sender = list.querySelector<HTMLElement>('.row-sender')
      if (!sender) return
      const style = getComputedStyle(sender)
      context.font = `550 ${style.fontSize} ${style.fontFamily}`
      const gap = parseFloat(style.columnGap) || 0
      const avatar = sender.querySelector<HTMLElement>('.avatar')
      const avatarWidth =
        avatar && getComputedStyle(avatar).display !== 'none' ? avatar.offsetWidth : 0
      let widest = 0
      for (const [label, count] of senderCounts) {
        const nameWidth = context.measureText(label).width
        const countWidth = count > 1 ? gap + 8 + String(count).length * 6 : 0
        widest = Math.max(widest, avatarWidth + (avatarWidth ? gap : 0) + nameWidth + countWidth)
        if (widest >= 224) break
      }
      list.style.setProperty('--sender-width', `${Math.min(224, Math.ceil(widest + 2))}px`)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    let active = true
    void document.fonts.ready.then(() => {
      if (active) measure()
    })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [senderCounts, density, items.length, listRef])
  useImperativeHandle(handleRef, () => ({
    scrollToConversation: (key) => {
      const index = rows.findIndex((row) => 'conversation' in row && row.conversation.key === key)
      if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' })
    },
  }))
  useLayoutEffect(() => {
    virtual.measure()
  }, [density])
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current
    if (anchor?.query !== queryId || !listRef.current) return
    let offset = 0
    for (const row of rows) {
      if ('conversation' in row && row.conversation.key === anchor.key) {
        listRef.current.scrollTop = offset + Math.min(anchor.delta, rowHeight - 1)
        break
      }
      offset += 'group' in row ? groupHeight : rowHeight
    }
  }, [rows, rowHeight, queryId])
  useLayoutEffect(() => {
    virtual.scrollToOffset(offsets.current.get(queryId) || 0, { align: 'start' })
    if (focused) {
      const index = rows.findIndex(
        (row) => 'conversation' in row && row.conversation.key === focused,
      )
      if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' })
    }
    listRef.current?.focus({ preventScroll: true })
  }, [queryId])
  const lastVisibleIndex = items.at(-1)?.index
  useEffect(() => {
    if (
      lastVisibleIndex !== undefined &&
      lastVisibleIndex > rows.length - 12 &&
      hasNextPage &&
      !isFetchingNextPage
    )
      onFetchNextPage()
  }, [lastVisibleIndex, rows.length, hasNextPage, isFetchingNextPage, onFetchNextPage])

  return (
    <div
      className="mail-list"
      ref={listRef}
      tabIndex={0}
      role="grid"
      aria-label="Conversations"
      aria-activedescendant={focused ? 'mail-' + encodeURIComponent(focused) : undefined}
      aria-rowcount={total}
      aria-multiselectable="true"
      onScroll={() => {
        const top = listRef.current?.scrollTop || 0
        offsets.current.set(queryId, top)
        const visible = items.find(
          (item) => item.start + item.size > top && 'conversation' in rows[item.index],
        )
        if (visible) {
          const row = rows[visible.index]
          if ('conversation' in row)
            scrollAnchor.current = {
              query: queryId,
              key: row.conversation.key,
              delta: top - visible.start,
            }
        }
      }}
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((item) => {
          const row = rows[item.index]
          return (
            <div
              key={item.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: item.size,
                transform: 'translateY(' + item.start + 'px)',
              }}
            >
              {'group' in row ? (
                <div className="date-group">{row.group}</div>
              ) : (
                <ListConversationRow
                  conversation={row.conversation}
                  account={accountById.get(row.conversation.accountId)}
                  selected={allMatching || selected.has(row.conversation.key)}
                  focused={focused === row.conversation.key}
                  busy={busy}
                  remoteImages={remoteImages}
                  view={view}
                  onOpen={onOpen}
                  onFocus={onFocus}
                  onSelect={onSelect}
                  onAction={onAction}
                />
              )}
            </div>
          )
        })}
      </div>
      {isFetchingNextPage && (
        <div className="load-more">
          <Spinner size={14} />
          Loading more conversations…
        </div>
      )}
    </div>
  )
}
