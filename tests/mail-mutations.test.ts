import { describe, expect, it } from 'vitest'
import type { Mailbox, Message } from '../packages/core/src'
import {
  planMutation,
  safeUndoUpdates,
  undoForUpdated,
} from '../apps/desktop/src/main/mail-mutations'

const rights: Mailbox['rights'] = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  mayCreateChild: true,
  mayRename: true,
  mayDelete: true,
}
const boxes: Mailbox[] = ['inbox', 'archive', 'trash', 'custom/a~b'].map((id) => ({
  id,
  accountId: 'account',
  name: id,
  role: id.startsWith('custom') ? null : id,
  parentId: null,
  totalEmails: 0,
  unreadEmails: 0,
  rights: { ...rights },
}))
const message: Message = {
  id: 'message',
  accountId: 'account',
  threadId: 'thread',
  subject: 'Test',
  from: [],
  to: [],
  cc: [],
  bcc: [],
  replyTo: [],
  receivedAt: '2026-09-24T00:00:00Z',
  preview: '',
  keywords: {},
  mailboxIds: { inbox: true, 'custom/a~b': true },
  size: 0,
  hasAttachment: false,
}

describe('mail mutation planning', () => {
  it('archives only Inbox membership and preserves other folders', () => {
    const plan = planMutation([message, message], boxes, 'archive')
    expect(plan.changes).toEqual({
      message: { mailboxes: { inbox: false, archive: true } },
    })
    expect(plan.inverse).toEqual({
      message: { mailboxes: { inbox: true, archive: false } },
    })
    expect(plan.destroy).toEqual([])
  })

  it('only includes confirmed updates in undo and refuses to undo over later changes', () => {
    const second = { ...message, id: 'second' }
    const plan = planMutation([message, second], boxes, 'move', 'archive')
    expect(plan.changes.message.mailboxes).toMatchObject({ 'custom/a~b': false })
    const undo = undoForUpdated('account', plan, ['message'])
    expect(Object.keys(undo.changes)).toEqual(['message'])
    expect(safeUndoUpdates(undo, [{ ...message, mailboxIds: { archive: true } }])).toEqual({
      message: plan.inverse.message,
    })
    expect(
      safeUndoUpdates(undo, [{ ...message, mailboxIds: { archive: true, 'custom/a~b': true } }]),
    ).toEqual({})
  })

  it('never copies a message into a second folder on single-folder servers', () => {
    const sent: Message = { ...message, id: 'reply', mailboxIds: { sent: true } }
    const withSent = [...boxes, { ...boxes[0], id: 'sent', role: 'sent' }]
    // JMAP keeps every message in the conversation and adds Archive to the reply in Sent.
    expect(planMutation([message, sent], withSent, 'archive').changes.reply).toEqual({
      mailboxes: { archive: true },
    })
    // IMAP would copy it instead, so only the Inbox message moves.
    const exclusive = planMutation([message, sent], withSent, 'archive', undefined, {
      exclusiveMailboxes: true,
    })
    expect(exclusive.changes.reply).toBeUndefined()
    expect(exclusive.changes.message).toEqual({ mailboxes: { inbox: false, archive: true } })
    const trash = planMutation([message, sent], withSent, 'trash', undefined, {
      exclusiveMailboxes: true,
    })
    expect(trash.changes.reply).toEqual({ mailboxes: { sent: false, trash: true } })
  })
  it('keeps keyword changes for messages whose folder does not change', () => {
    const sent: Message = { ...message, id: 'reply', mailboxIds: { sent: true } }
    const plan = planMutation([sent], boxes, 'star', undefined, { exclusiveMailboxes: true })
    expect(plan.changes.reply).toEqual({ keywords: { $flagged: true } })
    expect(plan.inverse.reply).toEqual({ keywords: { $flagged: false } })
  })
  it('rejects moves without rights and deletion outside Trash', () => {
    const readOnly = boxes.map((box) =>
      box.id === 'inbox' ? { ...box, rights: { ...box.rights, mayRemoveItems: false } } : box,
    )
    expect(() => planMutation([message], readOnly, 'archive')).toThrow('cannot be moved')
    expect(() => planMutation([message], boxes, 'destroy')).toThrow(
      'Only messages already in Trash',
    )
  })
})
