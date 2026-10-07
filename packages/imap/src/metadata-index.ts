import type { Address } from '@inlark/core'

/**
 * Persistent IMAP metadata, injected into the provider. The desktop app implements this with
 * SQLite in a worker thread; tests may run the same implementation in-process.
 *
 * Every method is scoped by `accountId`. Rows from different accounts never interact: threads,
 * Message-ID lookups and aliases are all per account.
 *
 * IDs are opaque, stable application IDs. A message ID identifies one message at one location
 * (mailbox + UIDVALIDITY + UID); `relocate` moves an ID after a confirmed server move. A
 * Message-ID header is never used to locate a message for a mutation.
 */
export interface MetadataIndex {
  close(): Promise<void>

  /**
   * Reconciles the server's folder list. Existing paths keep their IDs; new paths get new IDs;
   * paths no longer listed are removed together with their messages. Returns all mailboxes.
   */
  syncMailboxes(accountId: string, folders: FolderListing[]): Promise<IndexedMailbox[]>
  listMailboxes(accountId: string): Promise<IndexedMailbox[]>
  /** Keeps the mailbox ID (and its messages) when this app renames a folder. */
  renameMailbox(accountId: string, mailboxId: string, path: string, name: string): Promise<void>
  updateMailbox(accountId: string, mailboxId: string, patch: MailboxStatePatch): Promise<void>
  /**
   * Called when UIDVALIDITY changed: every stored location in the mailbox is stale, so its
   * messages are removed and indexing restarts. Threads and aliases stay.
   */
  resetMailbox(accountId: string, mailboxId: string, uidValidity: string): Promise<void>

  /**
   * Inserts or updates messages by location. A new location gets a new ID and a thread; an
   * existing location keeps its ID and has flags, modseq, preview and server identity refreshed.
   * Server identity may join threads, but never replaces a location used for mutations.
   * Returns the ID for each input, in order.
   */
  upsertMessages(accountId: string, messages: NewMessage[]): Promise<string[]>
  updateFlags(
    accountId: string,
    mailboxId: string,
    updates: { uid: number; flags: string[]; modseq?: string }[],
  ): Promise<void>
  /** Removes messages that no longer exist at these UIDs (expunged or vanished). */
  removeUids(accountId: string, mailboxId: string, uids: number[]): Promise<void>
  /** Removes messages by ID, e.g. after a confirmed deletion. */
  removeMessages(accountId: string, ids: string[]): Promise<void>
  /** All stored UIDs for a mailbox, ascending. Used to detect expunges during reconciliation. */
  knownUids(accountId: string, mailboxId: string): Promise<number[]>
  /** Moves an existing ID to a new location after the server confirmed the move. */
  relocate(accountId: string, id: string, location: MessageLocation): Promise<void>
  setPreview(accountId: string, id: string, preview: string): Promise<void>

  /** Messages by ID, in no particular order. Unknown IDs are skipped. */
  messages(accountId: string, ids: string[]): Promise<IndexedMessage[]>
  /** Messages at these UIDs of one mailbox. */
  messagesAt(accountId: string, mailboxId: string, uids: number[]): Promise<IndexedMessage[]>
  /** Every message of these conversations, following aliases of merged threads. */
  threadMessages(accountId: string, threadIds: string[]): Promise<IndexedMessage[]>
  /** The current ID for a thread ID that may have been merged into another. */
  resolveThread(accountId: string, threadId: string): Promise<string>
  /** Messages whose Message-ID header matches, optionally within one mailbox. */
  findByMessageId(
    accountId: string,
    messageId: string,
    mailboxId?: string,
  ): Promise<IndexedMessage[]>

  /**
   * Conversations with at least one message matching `filter`, newest first by the latest
   * matching message. `after` continues from the last item of a previous page (keyset
   * pagination), so rows indexed meanwhile cannot shift or duplicate what was already shown.
   */
  conversations(
    accountId: string,
    filter: ConversationFilter,
    page: { limit: number; offset?: number; after?: ConversationCursor },
  ): Promise<{ items: ConversationRow[]; total: number }>
  /** Total and unread message counts stored for the account, for progress reporting. */
  counts(accountId: string): Promise<{ messages: number }>

  getMeta(accountId: string, key: string): Promise<string | undefined>
  setMeta(accountId: string, key: string, value: string | undefined): Promise<void>
}

export interface FolderListing {
  path: string
  name: string
  delimiter: string
  parentPath: string | null
  /** The server-declared special-use flag, e.g. `\\Sent`. Never guessed from a name. */
  specialUse: string | null
  /** A flag the client library guessed from the name; kept separate so it can be reviewed. */
  guessedSpecialUse: string | null
  /** The folder cannot hold messages (`\\Noselect` / `\\NonExistent`). */
  noSelect: boolean
}

export interface IndexedMailbox extends FolderListing {
  id: string
  uidValidity: string | null
  uidNext: number | null
  highestModseq: string | null
  total: number
  unread: number
  /**
   * Every UID at or above this, up to `uidNext` at the last sync, is indexed. `null` means
   * nothing is indexed yet. Historical indexing walks this down towards 1.
   */
  indexedFrom: number | null
  /** Historical indexing reached UID 1. */
  complete: boolean
}

export type MailboxStatePatch = Partial<
  Pick<
    IndexedMailbox,
    'uidValidity' | 'uidNext' | 'highestModseq' | 'total' | 'unread' | 'indexedFrom' | 'complete'
  >
>

export interface MessageLocation {
  mailboxId: string
  uidValidity: string
  uid: number
}

export interface NewMessage extends MessageLocation {
  modseq?: string
  /** Account-wide server identity; unlike Message-ID, safe for display deduplication. */
  emailId?: string
  /** Without angle brackets. `null` when the header is missing or unusable. */
  messageId: string | null
  inReplyTo: string[]
  /** Oldest first, as in the header; the index may keep only the most recent entries. */
  references: string[]
  subject: string
  from: Address[]
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  /** ISO 8601 INTERNALDATE. */
  receivedAt: string
  sentAt?: string
  size: number
  flags: string[]
  hasAttachment: boolean
  preview: string
  /** The server's BODYSTRUCTURE, kept to find body parts and attachments later. */
  bodyStructure?: BodyPart
  unsubscribe?: { url: string; oneClick: boolean }
}

export interface IndexedMessage extends NewMessage {
  id: string
  threadId: string
}

/** A trimmed BODYSTRUCTURE node. `part` is the IMAP section number, e.g. `1.2`. */
export interface BodyPart {
  part?: string
  type: string
  parameters?: Record<string, string>
  id?: string
  encoding?: string
  size?: number
  disposition?: string
  dispositionParameters?: Record<string, string>
  childNodes?: BodyPart[]
}

export interface ConversationFilter {
  /** Only messages in these mailboxes. */
  mailboxIds?: string[]
  /** Never messages in these mailboxes (e.g. Junk and Trash for “All mail”). */
  excludeMailboxIds?: string[]
  /** Only these message IDs, e.g. server search results. */
  ids?: string[]
  flagged?: boolean
  unseen?: boolean
  hasAttachment?: boolean
  /** ISO dates, inclusive lower and exclusive upper bound on `receivedAt`. */
  after?: string
  before?: string
}

export interface ConversationCursor {
  receivedAt: string
  threadId: string
}

export interface ConversationRow {
  threadId: string
  /** The newest message matching the filter, which represents the conversation in lists. */
  latest: IndexedMessage
  /** Emails in the whole conversation, matching or not, counting each server identity once. */
  count: number
}
