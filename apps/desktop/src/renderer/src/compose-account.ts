import type { Account } from '@inlark/core'

/** Remembered locations and defaults can refer to accounts that have since been removed. */
export function newMessageAccount(
  accounts: Account[],
  selectedAccountId?: string,
  defaultAccountId?: string,
): Account | undefined {
  return (
    accounts.find((a) => a.id === selectedAccountId) ||
    accounts.find((a) => a.id === defaultAccountId) ||
    accounts[0]
  )
}
