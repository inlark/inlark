import type { MailAction, View } from '@inlark/core'

/**
 * Whether an action belongs in the menus for conversations listed in this view. Archiving what's
 * already archived or restoring the inbox to itself only adds noise. All mail and folders can hold
 * anything, so they offer everything. A search stays within its view and offers what that view
 * offers. Keyboard shortcuts stay available everywhere.
 */
export function offersAction(view: View, action: MailAction): boolean {
  switch (action) {
    case 'archive':
      return view !== 'archive'
    case 'trash':
      return view !== 'trash'
    case 'spam':
      return view !== 'junk'
    case 'notSpam':
      return view === 'junk' || view === 'all'
    case 'restore':
      return view !== 'inbox' && view !== 'junk'
    case 'destroy':
      return view === 'trash'
    default:
      return true
  }
}
