import type { Account, Draft, Mailbox, View } from '@inlark/core'

/** Where the list is looking: a view, optionally narrowed to one account or one of its folders. */
export interface MailLocation {
  view: View
  account?: string
  folder?: string
}

/**
 * The next wider place to search from here. A search starts where the user is, so a miss in one
 * folder offers all mail next, and all of one account's mail offers every account after that.
 */
export function widerLocation(
  location: MailLocation,
  accountCount: number,
): { label: string; location: MailLocation } | undefined {
  if (location.folder || location.view !== 'all')
    return { label: 'Search all mail', location: { view: 'all', account: location.account } }
  if (location.account && accountCount > 1)
    return { label: 'Search all accounts', location: { view: 'all' } }
  return undefined
}

export interface LocationOption {
  value: string
  label: string
  /** Shown above a run of options, such as the account a folder belongs to. */
  group?: string
  /** The view this option shows, so the picker can reuse the sidebar's icons. */
  view: View
  location: MailLocation
}

const locationValue = (location: MailLocation) =>
  location.folder
    ? 'folder:' + JSON.stringify([location.account || '', location.folder])
    : 'view:' + location.view

/**
 * The places a search can be narrowed to, for the filter dialog's folder picker. Views keep the
 * current account; a folder belongs to one account, so picking it also picks that account. Drafts
 * are left out because that list has its own search and no filters.
 */
export function locationOptions({
  location,
  views,
  accounts,
  boxesByAccount,
  currentLabel,
}: {
  location: MailLocation
  views: readonly { id: View; title: string }[]
  accounts: readonly Pick<Account, 'id' | 'name'>[]
  boxesByAccount: Record<string, readonly Mailbox[]>
  /** Names the current location if it isn't among the options yet, e.g. folders still loading. */
  currentLabel: string
}): { value: string; options: LocationOption[] } {
  const account = accounts.some((a) => a.id === location.account) ? location.account : undefined
  const option = (label: string, next: MailLocation, group?: string): LocationOption => ({
    value: locationValue(next),
    label,
    group,
    view: next.view,
    location: next,
  })
  const owners = account ? accounts.filter((a) => a.id === account) : accounts
  const options = [
    option('All mail', { view: 'all', account }),
    ...views.filter((v) => v.id !== 'drafts').map((v) => option(v.title, { view: v.id, account })),
    ...owners.flatMap((owner) =>
      (boxesByAccount[owner.id] || [])
        .filter((box) => !box.role)
        .map((box) =>
          option(
            box.name,
            { view: 'all', account: owner.id, folder: box.id },
            owners.length > 1 ? owner.name : 'Folders',
          ),
        ),
    ),
  ]
  const value = locationValue({ ...location, account })
  if (!options.some((o) => o.value === value))
    options.push(option(currentLabel, { ...location, account }))
  return { value, options }
}

/** Whether every word of a search appears somewhere in these fields, ignoring case. */
export function matchesWords(fields: readonly (string | undefined)[], text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = fields.filter(Boolean).join('\n').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/**
 * Drafts kept only on this device never reach the server's search, so Drafts matches them here
 * against what the server would compare: the subject, recipients and text.
 */
export function draftMatches(draft: Draft, text: string): boolean {
  return matchesWords(
    [
      draft.subject,
      ...[...draft.to, ...draft.cc, ...draft.bcc].flatMap((a) => [a.name, a.email]),
      draft.text,
    ],
    text,
  )
}
