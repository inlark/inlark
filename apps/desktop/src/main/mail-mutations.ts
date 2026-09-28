import type { MailAction, Mailbox, Message, MessageChange, MessageChanges } from '@inlark/core'

export interface UndoEntry {
  accountId: string
  changes: MessageChanges
  /** The state each changed field had right after the action; undo only reverses matching fields. */
  expected: MessageChanges
}

export interface MutationPlan {
  changes: MessageChanges
  inverse: MessageChanges
  destroy: string[]
}

export interface PlanOptions {
  /**
   * A message lives in exactly one folder (IMAP). Adding a folder without leaving one would
   * copy the message, so such changes are skipped: archiving a conversation moves its Inbox
   * messages and leaves replies in Sent where they are.
   */
  exclusiveMailboxes?: boolean
}

function diff(before: Record<string, boolean>, after: Record<string, boolean>) {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !!before[key] !== !!after[key])
      .map((key) => [key, !!after[key]]),
  )
}

function change(mailboxes: Record<string, boolean>, keywords: Record<string, boolean>) {
  const result: MessageChange = {}
  if (Object.keys(mailboxes).length) result.mailboxes = mailboxes
  if (Object.keys(keywords).length) result.keywords = keywords
  return result
}

const destinationRole: Partial<Record<MailAction, string>> = {
  archive: 'archive',
  trash: 'trash',
  restore: 'inbox',
  spam: 'junk',
  notSpam: 'inbox',
}

export function planMutation(
  messages: Message[],
  boxes: Mailbox[],
  action: MailAction,
  mailboxId?: string,
  options: PlanOptions = {},
): MutationPlan {
  const unique = [...new Map(messages.map((message) => [message.id, message])).values()]
  if (
    action === 'destroy' &&
    unique.some(
      (message) => !boxes.some((box) => box.role === 'trash' && message.mailboxIds[box.id]),
    )
  )
    throw new Error('Only messages already in Trash can be permanently deleted.')

  const role = destinationRole[action]
  const destination =
    action === 'move'
      ? boxes.find((box) => box.id === mailboxId)
      : role
        ? boxes.find((box) => box.role === role)
        : undefined
  if (role && !destination)
    throw new Error(
      'Your account needs a ' +
        role +
        ' folder. Choose one in Settings → Accounts → Folders, or configure its role on the server.',
    )
  if ((role || action === 'move') && !destination?.rights.mayAddItems)
    throw new Error('The destination folder is not writable.')

  const changes: MessageChanges = {}
  const inverse: MessageChanges = {}
  for (const message of unique) {
    const memberships = { ...message.mailboxIds }
    const keywords = { ...message.keywords }
    const sourceBoxes = boxes.filter((box) => memberships[box.id])
    if (['read', 'unread'].includes(action) && sourceBoxes.some((box) => !box.rights.maySetSeen))
      throw new Error('Some messages are read-only.')
    if (
      ['star', 'unstar'].includes(action) &&
      sourceBoxes.some((box) => !box.rights.maySetKeywords)
    )
      throw new Error('Some messages cannot be starred.')

    if (action === 'read') keywords.$seen = true
    if (action === 'unread') delete keywords.$seen
    if (action === 'star') keywords.$flagged = true
    if (action === 'unstar') delete keywords.$flagged
    if (destination) {
      if (action === 'archive') {
        for (const box of boxes) if (box.role === 'inbox') delete memberships[box.id]
      } else if (action === 'restore' || action === 'notSpam') {
        for (const box of boxes)
          if (box.role === 'trash' || box.role === 'junk') delete memberships[box.id]
      } else {
        for (const key of Object.keys(memberships)) delete memberships[key]
      }
      memberships[destination.id] = true
    }
    let mailboxChange = diff(message.mailboxIds, memberships)
    if (options.exclusiveMailboxes && !Object.values(mailboxChange).includes(false))
      mailboxChange = {}
    if (
      Object.values(mailboxChange).includes(false) &&
      sourceBoxes.some((box) => mailboxChange[box.id] === false && !box.rights.mayRemoveItems)
    )
      throw new Error('Some messages cannot be moved.')
    const keywordChange = diff(message.keywords, keywords)
    const forward = change(mailboxChange, keywordChange)
    if (!forward.mailboxes && !forward.keywords) continue
    changes[message.id] = forward
    inverse[message.id] = change(
      Object.fromEntries(Object.keys(mailboxChange).map((k) => [k, !!message.mailboxIds[k]])),
      Object.fromEntries(Object.keys(keywordChange).map((k) => [k, !!message.keywords[k]])),
    )
  }
  return {
    changes,
    inverse,
    destroy: action === 'destroy' ? unique.map((message) => message.id) : [],
  }
}

export function undoForUpdated(
  accountId: string,
  plan: MutationPlan,
  updated: string[],
): UndoEntry {
  return {
    accountId,
    changes: Object.fromEntries(
      updated.filter((id) => plan.inverse[id]).map((id) => [id, plan.inverse[id]]),
    ),
    expected: Object.fromEntries(
      updated.filter((id) => plan.changes[id]).map((id) => [id, plan.changes[id]]),
    ),
  }
}

/** Keeps only reversals whose fields still hold the value the action left behind. */
export function safeUndoUpdates(entry: UndoEntry, current: Message[]): MessageChanges {
  const matches = (actual: Record<string, boolean>, expected: Record<string, boolean> = {}) =>
    Object.entries(expected).every(([key, value]) => !!actual[key] === value)
  return Object.fromEntries(
    current
      .filter(
        (message) =>
          entry.changes[message.id] &&
          matches(message.mailboxIds, entry.expected[message.id]?.mailboxes) &&
          matches(message.keywords, entry.expected[message.id]?.keywords),
      )
      .map((message) => [message.id, entry.changes[message.id]]),
  )
}
