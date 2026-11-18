import type { Account, Draft } from '@inlark/core'

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1).replace(/\.0$/, '')
const bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * Roughly what a draft weighs as a finished message. Mail carries attachments as base64 text,
 * a third larger than the files, and encryption wraps the whole message that way once more.
 */
export function estimatedMessageBytes(
  draft: Pick<Draft, 'html' | 'text' | 'attachments' | 'encryption'>,
): number {
  const attachments = draft.attachments.reduce((sum, a) => sum + a.size, 0)
  const plain = Math.ceil(attachments * 1.37) + bytes(draft.html) + bytes(draft.text) + 2000
  return draft.encryption === 'encrypt' ? Math.ceil(plain * 1.37) : plain
}

/**
 * Why this draft is likely too large for its account, when the account's provider only lets it
 * send small messages. The provider itself decides when the message is sent; this warns early.
 */
export function sendLimitWarning(
  account: Pick<Account, 'limits'> | undefined,
  draft: Pick<Draft, 'html' | 'text' | 'attachments' | 'encryption'>,
): string | undefined {
  const limit = account?.limits?.send
  if (!limit) return undefined
  const size = estimatedMessageBytes(draft)
  return size > limit.maxBytes
    ? `This message is about ${megabytes(size)} MB, more than the ${megabytes(limit.maxBytes)} MB this account can send. ${limit.reason}`
    : undefined
}
