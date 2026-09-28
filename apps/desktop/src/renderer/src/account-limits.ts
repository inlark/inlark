import type { Account, MailAction, MutationTarget } from '@inlark/core'

/** Actions that move messages between folders, which `limits.move` rules out. */
const moving: readonly MailAction[] = ['archive', 'trash', 'spam', 'notSpam', 'restore', 'move']

/** Why this account's server can't perform the action safely, if it can't. */
export function actionLimit(account: Account | undefined, action: MailAction): string | undefined {
  if (!account?.limits) return undefined
  if (action === 'destroy') return account.limits.destroy
  return moving.includes(action) ? account.limits.move : undefined
}

/**
 * The first account among the targets that can't perform the action, with its explanation.
 * One limited account blocks the whole action, so a mixed selection never half-completes.
 */
export function targetLimit(
  accounts: Account[],
  accountIds: Iterable<string>,
  action: MailAction,
): { account: Account; reason: string } | undefined {
  for (const id of new Set(accountIds)) {
    const account = accounts.find((a) => a.id === id)
    const reason = actionLimit(account, action)
    if (account && reason) return { account, reason }
  }
  return undefined
}

export const targetAccounts = (targets: MutationTarget[]) => targets.map((t) => t.accountId)
