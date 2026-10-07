import type { Address, ServerSettings } from '@inlark/core'
import type { BodyPart, FolderListing } from './metadata-index'

/**
 * The small part of IMAP the provider needs, on one connection. The production adapter wraps
 * ImapFlow; tests use an in-memory server. UIDs are always used, never sequence numbers.
 *
 * Safety rules every implementation must keep:
 * - `move` only runs with the MOVE extension and never falls back to COPY + EXPUNGE itself.
 * - `expunge` only runs `UID EXPUNGE` (UIDPLUS). A plain `EXPUNGE` would also remove messages
 *   another client flagged for deletion, so it is never issued.
 */
export interface ImapPort {
  /** Upper-case capability names, available after `connect`. */
  readonly capabilities: ReadonlySet<string>
  /** CONDSTORE is enabled, so modseqs and conditional stores work. */
  readonly condstore: boolean
  connect(): Promise<void>
  close(): Promise<void>
  /** `close` fires once when the connection ends for any reason. */
  on(event: 'close', listener: () => void): void
  /** Unsolicited changes in the selected mailbox (used by the IDLE connection). */
  on(event: 'exists' | 'expunge' | 'flags', listener: (path: string) => void): void
  list(): Promise<FolderListing[]>
  status(path: string): Promise<MailboxStatus>
  select(path: string): Promise<SelectedMailbox>
  /** UID SEARCH in the selected mailbox. */
  search(criteria: SearchCriteria): Promise<number[]>
  /** UID FETCH in the selected mailbox. `range` is a UID set such as `1:*` or `4,8,15`. */
  fetch(range: string, query: FetchQuery, changedSince?: string): Promise<FetchedMessage[]>
  /** The complete message, or undefined if it no longer exists or exceeds `maxBytes`. */
  source(uid: number, maxBytes: number): Promise<Uint8Array | undefined>
  /**
   * One body part, with transfer encoding decoded and text converted to UTF-8. Larger parts
   * fail unless `truncate` is set, which returns the first `maxBytes` (for previews).
   */
  download(uid: number, part: string, maxBytes: number, truncate?: boolean): Promise<Uint8Array>
  /** UID STORE ±FLAGS, conditional on UNCHANGEDSINCE when given and CONDSTORE is enabled. */
  store(
    uids: number[],
    operation: 'add' | 'remove',
    flags: string[],
    unchangedSince?: string,
  ): Promise<boolean>
  move(uids: number[], destination: string): Promise<CopyResult | false>
  copy(uids: number[], destination: string): Promise<CopyResult | false>
  /** Flags the UIDs \Deleted and removes exactly them with UID EXPUNGE. */
  expunge(uids: number[]): Promise<boolean>
  append(path: string, content: Uint8Array, flags: string[], date?: Date): Promise<AppendResult>
  createMailbox(path: string): Promise<void>
  renameMailbox(path: string, newPath: string): Promise<void>
  deleteMailbox(path: string): Promise<void>
}

export interface ImapServerOptions extends ServerSettings {
  password: string
  timeoutMs?: number
  /** Tests only: trust an extra certificate authority. */
  tls?: { ca?: string | Uint8Array }
}

export interface MailboxStatus {
  messages: number
  unseen: number
  uidNext?: number
  uidValidity?: string
  highestModseq?: string
}

export interface SelectedMailbox {
  path: string
  uidValidity: string
  uidNext: number
  exists: number
  highestModseq?: string
}

export interface SearchCriteria {
  all?: boolean
  uid?: string
  text?: string
  from?: string
  to?: string
  subject?: string
  since?: Date
  before?: Date
  seen?: boolean
  flagged?: boolean
  deleted?: boolean
  header?: Record<string, string>
}

export interface FetchQuery {
  flags?: boolean
  envelope?: boolean
  bodyStructure?: boolean
  internalDate?: boolean
  size?: boolean
  /** Raw header lines for these header names. */
  headers?: string[]
}

export interface Envelope {
  date?: string
  subject?: string
  messageId?: string
  inReplyTo?: string
  from?: Address[]
  sender?: Address[]
  replyTo?: Address[]
  to?: Address[]
  cc?: Address[]
  bcc?: Address[]
}

export interface FetchedMessage {
  uid: number
  /** Account-wide server identity (OBJECTID EMAILID or Gmail X-GM-MSGID). */
  emailId?: string
  modseq?: string
  flags?: string[]
  envelope?: Envelope
  bodyStructure?: BodyPart
  internalDate?: string
  size?: number
  /** The requested header lines, unparsed. */
  headers?: string
}

export interface CopyResult {
  uidValidity?: string
  /** Source UID → destination UID, when the server reports COPYUID (UIDPLUS). */
  uidMap?: Map<number, number>
}

/** `uid` is known when the server reports APPENDUID (UIDPLUS). */
export type AppendResult = { uid?: number; uidValidity?: string }

export type PortFactory = (options: ImapServerOptions, purpose: 'command' | 'idle') => ImapPort
