import { useState } from 'react'
import { AlertCircle, Check, RefreshCw, Send } from '@inlark/ui/icons'
import { Button, Modal, Spinner } from '@inlark/ui'
import {
  friendlyError,
  type Account,
  type Address,
  type Draft,
  type SubmissionSummary,
} from '@inlark/core'
import { api } from './api'
import { queryClient, localSaveDraft } from './cache'
import { AccountMark } from './AccountMark'
import { shortDate } from './mail-date'

const who = (list: Address[]) =>
  list.map((a) => (a.name ? a.name + ' <' + a.email + '>' : a.email)).join(', ')

const copyState = {
  pending: 'Copy in Sent pending',
  uncertain: 'Copy in Sent not confirmed',
  failed: 'Copy in Sent failed',
} as const

/** What happened to a send, in words, and how much it needs the user. */
function describe(s: SubmissionSummary): { state: string; detail: string; tone: string } {
  if (s.state === 'uncertain')
    return {
      state: 'Delivery unconfirmed',
      detail:
        'The server may have accepted this message. Check again before sending a replacement, or recipients may get it twice.',
      tone: 'attention',
    }
  if (s.state === 'partial')
    return {
      state: 'Partially sent' + (s.sentCopy ? ' · ' + copyState[s.sentCopy] : ''),
      detail: s.rejected?.length
        ? 'Not delivered to ' + who(s.rejected) + '. Everyone else received it.'
        : 'Some recipients refused the message. Everyone else received it.',
      tone: 'attention',
    }
  return {
    state: 'Sent · ' + copyState[s.sentCopy || 'pending'],
    detail:
      s.sentCopy === 'failed'
        ? 'Delivered, but its copy couldn’t be saved in Sent' + (s.error ? ': ' + s.error : '.')
        : s.sentCopy === 'uncertain'
          ? 'Delivered. Saving its copy in Sent may not have finished; retrying checks for it first.'
          : 'Delivered. Its copy in Sent hasn’t been saved yet.',
    tone: 'quiet',
  }
}

/** Sends that still need a decision: filing retries, refused recipients, unconfirmed delivery. */
export function SubmissionList({
  submissions,
  accounts,
  onOpenDraft,
  notify,
}: {
  submissions: SubmissionSummary[]
  accounts: Account[]
  onOpenDraft: (draft: Draft) => void
  notify: (message: string, tone?: 'error') => void
}) {
  const [working, setWorking] = useState<Record<string, string>>({})
  const [replace, setReplace] = useState<SubmissionSummary>()
  const [dismiss, setDismiss] = useState<SubmissionSummary>()
  if (!submissions.length) return null
  const run = async (s: SubmissionSummary, action: string, task: () => Promise<void>) => {
    setWorking((current) => ({ ...current, [s.draftId]: action }))
    try {
      await task()
    } catch (e) {
      notify(friendlyError(e), 'error')
    } finally {
      setWorking(({ [s.draftId]: _done, ...rest }) => rest)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['submissions'] }),
        queryClient.invalidateQueries({ queryKey: ['drafts'] }),
      ])
    }
  }
  const openDraft = async (draft: Draft) => {
    await localSaveDraft(draft)
    onOpenDraft(draft)
  }
  const actions = (s: SubmissionSummary) => {
    const busy = working[s.draftId]
    const label = (action: string, text: string) =>
      busy === action ? (
        <>
          <Spinner size={12} />
          {text}
        </>
      ) : (
        text
      )
    const retryFiling = s.sentCopy && (
      <Button
        size="small"
        disabled={!!busy}
        title="Saves the copy in Sent again. The message is not sent again."
        onClick={() =>
          void run(s, 'filing', async () => {
            const result = await api.retrySentCopy(s.draftId)
            notify(
              result.sentCopy === 'pending'
                ? 'The copy still couldn’t be saved in Sent. The message itself was delivered.'
                : 'Copy saved in Sent.',
              result.sentCopy === 'pending' ? 'error' : undefined,
            )
          })
        }
      >
        {label('filing', 'Retry filing')}
      </Button>
    )
    const dismissButton = (
      <Button
        size="small"
        variant="ghost"
        disabled={!!busy}
        onClick={() =>
          s.state === 'uncertain'
            ? setDismiss(s)
            : void run(s, 'dismiss', () => api.dismissSubmission(s.draftId))
        }
      >
        Dismiss
      </Button>
    )
    if (s.state === 'uncertain')
      return (
        <>
          <Button
            size="small"
            disabled={!!busy}
            onClick={() =>
              void run(s, 'check', async () => {
                const result = await api.reconcile(s.draftId)
                notify(
                  result.status === 'sent' ? 'Delivery confirmed.' : result.message,
                  result.status === 'uncertain' ? 'error' : undefined,
                )
              })
            }
          >
            {label('check', 'Check again')}
          </Button>
          <Button size="small" disabled={!!busy} onClick={() => setReplace(s)}>
            Send a replacement…
          </Button>
          {dismissButton}
        </>
      )
    if (s.state === 'partial')
      return (
        <>
          {!!s.rejected?.length && (
            <Button
              size="small"
              disabled={!!busy}
              onClick={() =>
                void run(s, 'recover', async () => {
                  await openDraft(await api.recoverRejected(s.draftId))
                })
              }
            >
              {label('recover', 'Create draft to refused recipients')}
            </Button>
          )}
          {retryFiling}
          {dismissButton}
        </>
      )
    return (
      <>
        {retryFiling}
        {dismissButton}
      </>
    )
  }
  return (
    <section className="submissions" aria-labelledby="submissions-title">
      <h2 className="draft-section-label" id="submissions-title">
        Needs attention
      </h2>
      {submissions.map((s) => {
        const account = accounts.find((a) => a.id === s.accountId)
        const text = describe(s)
        return (
          <div className={'submission submission-' + text.tone} key={s.draftId}>
            <span className="submission-icon" aria-hidden="true">
              {s.state === 'uncertain' ? (
                <AlertCircle size={16} />
              ) : s.state === 'partial' ? (
                <Send size={16} />
              ) : s.sentCopy === 'failed' ? (
                <RefreshCw size={15} />
              ) : (
                <Check size={16} />
              )}
            </span>
            <div className="submission-text">
              <strong>{s.subject || '(No subject)'}</strong>
              <span className="submission-state">
                {text.state}
                {account && (
                  <span className="submission-account">
                    <AccountMark account={account} size={14} />
                    {account.name}
                  </span>
                )}
              </span>
              <span className="submission-detail">{text.detail}</span>
              <div className="submission-actions">{actions(s)}</div>
            </div>
            <time dateTime={s.at} title={new Date(s.at).toLocaleString()}>
              {shortDate(s.at)}
            </time>
          </div>
        )
      })}
      <Modal
        open={!!replace}
        onOpenChange={(open) => {
          if (!open) setReplace(undefined)
        }}
        title="Send a replacement?"
        description={
          'Inlark couldn’t confirm whether “' +
          (replace?.subject || '(No subject)') +
          '” was delivered. If it was, recipients will receive it twice.'
        }
      >
        <p className="modal-body-text">
          The replacement opens as a new draft for you to review. Nothing is sent until you choose
          Send. The unconfirmed message stays listed here, so you can still check it.
        </p>
        <div className="modal-actions">
          <Button onClick={() => setReplace(undefined)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const s = replace
              setReplace(undefined)
              if (s)
                void run(s, 'replace', async () => {
                  await openDraft(await api.replaceUncertain(s.draftId))
                })
            }}
          >
            Create replacement draft
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!dismiss}
        onOpenChange={(open) => {
          if (!open) setDismiss(undefined)
        }}
        title="Stop tracking this message?"
        description={
          'Inlark will stop checking whether “' +
          (dismiss?.subject || '(No subject)') +
          '” was delivered and remove its unconfirmed draft from this device. Look in Sent first if you’re unsure.'
        }
      >
        <div className="modal-actions">
          <Button onClick={() => setDismiss(undefined)}>Keep tracking</Button>
          <Button
            variant="danger"
            onClick={() => {
              const s = dismiss
              setDismiss(undefined)
              if (s) void run(s, 'dismiss', () => api.dismissSubmission(s.draftId))
            }}
          >
            Dismiss
          </Button>
        </div>
      </Modal>
    </section>
  )
}
