import {
  scopeKey,
  type Conversation,
  type MailAction,
  type Message,
  type MutationTarget,
  type QueryPage,
} from '@inlark/core'

/** Whether an action takes conversations out of the list they're listed in. */
export const leavesList = (action: MailAction) =>
  action === 'archive' ||
  action === 'trash' ||
  action === 'spam' ||
  action === 'move' ||
  action === 'destroy'

/**
 * An action the window already shows as done while the server carries it out. Lists requested
 * before the server answered still show it, so a reload that set out too early, or a list kept
 * from before, can't bring back for a moment a conversation the user just removed.
 */
export interface PendingChange {
  id: number
  action: MailAction
  /** The conversations it applies to, as `Conversation.key`s. */
  keys: ReadonlySet<string>
  /**
   * The list it was made in. Only there does it take conversations out: elsewhere, such as in
   * Trash or All mail, they may well belong.
   */
  list: string
  /** When the server answered, on the clock of `requestTime`. */
  answeredAt?: number
  /** Set once the window has reloaded after the answer, open conversation included. */
  settled?: boolean
}

/** A page of the conversation list, with when it was asked for. */
export type ListPage = QueryPage & { requestedAt?: number }

/** The time, in milliseconds that compare across sessions, finer than `Date.now()`. */
export const requestTime = () => performance.timeOrigin + performance.now()

/** The `Conversation.key` of the conversation a target names. */
export const targetKey = (target: MutationTarget) => scopeKey(target.accountId, target.threadId)

/** Whether data asked for at `requestedAt` may not show the change yet. Unknown means old. */
const predates = (change: PendingChange, requestedAt = -Infinity) =>
  change.answeredAt === undefined || requestedAt < change.answeredAt

/** A conversation as an action leaves it, or nothing once the action takes it out of the list. */
export function applyAction(
  conversation: Conversation,
  action: MailAction,
): Conversation | undefined {
  if (leavesList(action)) return undefined
  if (action === 'read' || action === 'unread')
    return { ...conversation, unread: action === 'unread' }
  if (action === 'star' || action === 'unstar')
    return { ...conversation, starred: action === 'star' }
  return conversation
}

/**
 * The conversations of `list`'s pages, each once, as the user left them: every pending change the
 * page it came from may not show yet is applied, in the order they were made.
 */
export function listConversations(
  pages: readonly ListPage[],
  pending: readonly PendingChange[],
  list: string,
): Conversation[] {
  // A conversation on two pages, as when the list shifted between them, is as new as the newer.
  const listed = new Map<string, { conversation: Conversation; requestedAt?: number }>()
  for (const page of pages)
    for (const conversation of page.items) {
      const earlier = listed.get(conversation.key)?.requestedAt ?? -Infinity
      listed.set(conversation.key, {
        conversation,
        requestedAt: Math.max(earlier, page.requestedAt ?? -Infinity),
      })
    }
  return [...listed.values()].flatMap(({ conversation, requestedAt }) => {
    let shown: Conversation | undefined = conversation
    for (const change of pending) {
      if (!shown) break
      if (
        change.keys.has(conversation.key) &&
        predates(change, requestedAt) &&
        (change.list === list || !leavesList(change.action))
      )
        shown = applyAction(shown, change.action)
    }
    return shown ? [shown] : []
  })
}

/**
 * An open conversation's messages with the read and star changes the window hasn't reloaded since,
 * so a second press of a toggle undoes the first instead of repeating it.
 */
export function withPendingFlags(
  messages: Message[],
  pending: readonly PendingChange[],
  key: string,
): Message[] {
  const changes = pending.filter(
    (change) => !change.settled && change.keys.has(key) && !leavesList(change.action),
  )
  if (!changes.length) return messages
  return messages.map((message) => {
    const keywords = { ...message.keywords }
    for (const { action } of changes) {
      if (action === 'read') keywords.$seen = true
      if (action === 'unread') delete keywords.$seen
      if (action === 'star') keywords.$flagged = true
      if (action === 'unstar') delete keywords.$flagged
    }
    return { ...message, keywords }
  })
}

/** Whether the server is still taking this conversation out of a list. */
export const isLeaving = (pending: readonly PendingChange[], target: MutationTarget) =>
  pending.some(
    (change) =>
      change.answeredAt === undefined &&
      leavesList(change.action) &&
      change.keys.has(targetKey(target)),
  )

/**
 * Whether a change can be forgotten: the window reloaded after the answer, and the list it was made
 * in is either gone or was asked for since. Other lists kept from before may still show it, which
 * is all they knew at the time.
 */
export const forgettable = (change: PendingChange, list: readonly ListPage[] | undefined) =>
  !!change.settled && !list?.some((page) => predates(change, page.requestedAt))
