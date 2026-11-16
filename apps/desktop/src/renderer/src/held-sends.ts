import { useEffect, useRef, useState } from 'react'
import {
  defaultSettings,
  friendlyError,
  type AppEvent,
  type Draft,
  type HeldSend,
  type SendResult,
  type Settings,
} from '@inlark/core'
import { api } from './api'
import { localDeleteDraft, localSaveDraft, queryClient } from './cache'
import { toasts } from './Toasts'

/** Seconds a sent message waits so it can be undone. 0 sends at once. */
export const undoSendDelay = (settings: Settings) =>
  settings.undoSendSeconds ?? defaultSettings.undoSendSeconds ?? 0

/** Plain wording for a finished send; the Drafts view offers recovery for anything left over. */
export function sentMessage(result: SendResult): string {
  const copy = result.sentCopy === 'pending' ? ' Its copy in Sent isn’t saved yet.' : ''
  if (result.status === 'partial') {
    const refused = result.rejected || []
    return (
      (refused.length
        ? 'Sent, but refused by ' +
          (refused.length === 1 ? refused[0].email : refused.length + ' recipients') +
          '.'
        : 'Sent, but some recipients refused it.') +
      copy +
      ' Drafts has the details.'
    )
  }
  return copy ? 'Message sent.' + copy + ' Drafts shows its status.' : result.message
}

const quoted = (subject: string) => '“' + (subject || 'No subject') + '”'

type Finished = Extract<AppEvent, { type: 'sendFinished' }>

/**
 * Messages waiting out their undo window. Each gets a toast that counts down and offers Undo
 * and Send now, and later reports how the send ended. The main process holds and sends the
 * messages; this only shows them and passes on the user's choices.
 */
export function useHeldSends({ onReopen }: { onReopen: (draft: Draft) => void }) {
  const [held, setHeld] = useState<HeldSend[]>([])
  // The toast for each message, by draft, from the moment it is held until its outcome is shown.
  const shown = useRef(new Map<string, { toast: number; subject: string }>())
  const cancelling = useRef(new Set<string>())
  const reopen = useRef(onReopen)
  reopen.current = onReopen

  const refreshDrafts = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['drafts'] }),
      queryClient.invalidateQueries({ queryKey: ['submissions'] }),
    ])

  const openDraft = async (draftId: string, toast?: number) => {
    try {
      const draft = (await api.drafts()).find((d) => d.id === draftId)
      if (!draft) throw new Error('This draft is no longer available.')
      await localSaveDraft(draft)
      if (toast !== undefined) toasts.dismiss(toast)
      reopen.current(draft)
    } catch (error) {
      toasts.show({ text: friendlyError(error), tone: 'error' })
    }
  }

  const undo = (send: HeldSend) => {
    const toast = shown.current.get(send.draftId)?.toast
    cancelling.current.add(send.draftId)
    toasts.show({ text: 'Undoing…', tone: 'progress' }, toast)
    api.cancelSend(send.draftId).then(
      async (draft) => {
        shown.current.delete(send.draftId)
        cancelling.current.delete(send.draftId)
        toasts.show({ text: 'Sending undone' }, toast)
        await localSaveDraft(draft).catch(() => {})
        void refreshDrafts()
        reopen.current(draft)
      },
      () => {
        cancelling.current.delete(send.draftId)
        // Too late: it already left. Its outcome replaces this toast when it arrives.
        if (shown.current.has(send.draftId))
          toasts.show(
            { text: 'Too late to undo · sending ' + quoted(send.subject) + '…', tone: 'progress' },
            toast,
          )
      },
    )
  }

  const sendNow = (send: HeldSend) => {
    const toast = shown.current.get(send.draftId)?.toast
    toasts.show({ text: 'Sending ' + quoted(send.subject) + '…', tone: 'progress' }, toast)
    api
      .sendNow(send.draftId)
      .catch((error) => toasts.show({ text: friendlyError(error), tone: 'error' }, toast))
  }

  const finished = (event: Finished) => {
    const toast = shown.current.get(event.draftId)?.toast
    shown.current.delete(event.draftId)
    cancelling.current.delete(event.draftId)
    const { result } = event
    if (result && result.status !== 'uncertain') {
      void localDeleteDraft(event.draftId).catch(() => {})
      toasts.show(
        {
          text:
            result.status === 'sent' && result.sentCopy !== 'pending'
              ? 'Sent ' + quoted(event.subject)
              : sentMessage(result),
        },
        toast,
      )
    } else {
      // Problems stay until dismissed: the user has moved on and may not be looking.
      const id: number = toasts.show(
        {
          text: result
            ? quoted(event.subject) + ': ' + result.message
            : 'Couldn’t send ' + quoted(event.subject) + '. ' + (event.error || ''),
          tone: 'error',
          sticky: true,
          action: result
            ? undefined
            : { label: 'Open draft', run: () => void openDraft(event.draftId, id) },
        },
        toast,
      )
    }
    void refreshDrafts()
  }

  useEffect(() => {
    let pushed = false
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'held') {
        pushed = true
        setHeld(event.held)
      }
      if (event.type === 'sendFinished') finished(event)
    })
    // After a reload, pick up messages that were already waiting.
    api
      .heldSends()
      .then((list) => !pushed && setHeld(list))
      .catch(() => {})
    return unsubscribe
  }, [])

  useEffect(() => {
    for (const send of held) {
      if (shown.current.has(send.draftId)) continue
      const toast = toasts.show({
        text: 'Sending ' + quoted(send.subject),
        tone: 'progress',
        countdownTo: send.sendAt,
        action: { label: 'Send now', run: () => sendNow(send) },
        onUndo: () => undo(send),
      })
      shown.current.set(send.draftId, { toast, subject: send.subject })
    }
    // A message whose window ended is on its way; its outcome replaces this when it arrives.
    const waiting = new Set(held.map((h) => h.draftId))
    for (const [draftId, { toast, subject }] of shown.current)
      if (
        !waiting.has(draftId) &&
        !cancelling.current.has(draftId) &&
        toasts.get(toast)?.countdownTo
      )
        toasts.show({ text: 'Sending ' + quoted(subject) + '…', tone: 'progress' }, toast)
  }, [held])

  return { held, undo, sendNow }
}
