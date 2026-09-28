import {
  folderRoles,
  type FolderMappingReview,
  type FolderMappings,
  type FolderRole,
} from '@inlark/core'
import type { FolderListing } from './metadata-index'

const specialUse: Record<FolderRole, string> = {
  sent: '\\Sent',
  drafts: '\\Drafts',
  archive: '\\Archive',
  junk: '\\Junk',
  trash: '\\Trash',
}
export const isInbox = (path: string) => path.toUpperCase() === 'INBOX'

/**
 * Chooses the folder for each role: an explicit choice by the user wins, then the server's
 * special-use flag, then a guess from the folder's name. Guesses are marked so they can be
 * reviewed; a role explicitly set to `null` stays empty.
 */
export function reviewFolders(
  folders: FolderListing[],
  chosen: FolderMappings = {},
): FolderMappingReview {
  const selectable = folders.filter((f) => !f.noSelect)
  const byPath = new Map(selectable.map((f) => [f.path, f]))
  const mappings: FolderMappingReview['mappings'] = {}
  for (const role of folderRoles) {
    const choice = chosen[role]
    if (choice === null) {
      mappings[role] = null
      continue
    }
    if (choice && byPath.has(choice.path)) {
      mappings[role] = { path: choice.path, source: 'user' }
      continue
    }
    const declared = selectable.find((f) => f.specialUse === specialUse[role])
    const guessed = selectable.find((f) => f.guessedSpecialUse === specialUse[role])
    const found = declared || guessed
    if (found) mappings[role] = { path: found.path, source: declared ? 'server' : 'name' }
  }
  return {
    folders: selectable.map((f) => ({ path: f.path, name: f.name })),
    mappings,
  }
}

/** Role by folder path, as used for views and actions. */
export function rolesByPath(review: FolderMappingReview): Map<string, string> {
  const roles = new Map<string, string>()
  for (const role of folderRoles) {
    const mapping = review.mappings[role]
    if (mapping && !roles.has(mapping.path) && !isInbox(mapping.path)) roles.set(mapping.path, role)
  }
  return roles
}
