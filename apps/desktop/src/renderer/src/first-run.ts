/**
 * Whether to expect accounts before inlark has loaded them, which decides what the window shows
 * for that moment: the mailbox's frame, or the blank that precedes the welcome screen.
 *
 * `remembered` is what the last run saved: `'true'` or `'false'`. Versions before the welcome
 * screen saved nothing, so for them mail kept from an earlier session is the evidence that an
 * account was connected. Without either, this is taken to be a first launch.
 */
export function expectsAccounts(remembered: string | null, cachedMail: boolean): boolean {
  return remembered === null ? cachedMail : remembered === 'true'
}
