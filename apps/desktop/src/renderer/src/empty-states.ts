import { Folder, Search, type IconComponent } from '@inlark/ui/icons'
import type { View } from '@inlark/core'
import { views } from './Sidebar'
import type { ShortcutId } from './shortcuts'

/** The label of a shortcut's first binding, or nothing when the user removed it. */
type KeyText = (id: ShortcutId) => string | undefined

const copy: Record<
  Exclude<View, 'drafts'>,
  { title: string; description: string | ((keys: KeyText) => string) }
> = {
  inbox: { title: 'You’re all caught up', description: 'New mail will show up here.' },
  starred: {
    title: 'No starred conversations',
    description: (keys) =>
      keys('star')
        ? 'Press ' + keys('star') + ' to star the selected conversation.'
        : 'Conversations you star will show up here.',
  },
  sent: { title: 'Nothing sent yet', description: 'Messages you send will appear here.' },
  archive: {
    title: 'Your archive is empty',
    description: 'Archived conversations stay here and in search.',
  },
  junk: { title: 'No spam', description: 'Messages marked as spam will land here.' },
  trash: { title: 'Trash is empty', description: 'Deleted conversations will show up here.' },
  all: {
    title: 'This folder is empty',
    description: (keys) =>
      keys('move')
        ? 'Press ' + keys('move') + ' to move conversations here.'
        : 'Move conversations here to keep them together.',
  },
}

/** What an empty conversation list says, depending on where the user is and why it's empty. */
export function emptyListState(
  view: View,
  {
    searching,
    unreadOnly,
    keys = () => undefined,
  }: { searching: boolean; unreadOnly: boolean; keys?: KeyText },
): { icon: IconComponent; title: string; description: string } {
  if (searching)
    return {
      icon: Search,
      title: 'No conversations found',
      description: 'Try a different search or adjust your filters.',
    }
  const icon = views.find((v) => v.id === view)?.icon || Folder
  if (unreadOnly)
    return { icon, title: 'No unread conversations', description: 'You’ve read everything here.' }
  const { title, description } = copy[view === 'drafts' ? 'all' : view]
  return {
    icon,
    title,
    description: typeof description === 'function' ? description(keys) : description,
  }
}
