export type View = 'inbox' | 'starred' | 'archive' | 'sent' | 'drafts' | 'junk' | 'trash' | 'all'
export type ConnectionState = 'connecting' | 'connected' | 'offline' | 'authentication' | 'error'
/** How an account's avatar looks: a generated marble pattern, or a picture the user chose. */
export interface AccountAppearance {
  /** Varies the generated pattern; the account's address stands in until the user shuffles. */
  seed?: string
  /** A small square picture kept on this device, as a data URL. */
  image?: string
}
/** Colours for the generated account avatars, tuned to sit calmly on dark and light surfaces. */
export const avatarColors = ['#4b3fb5', '#a69aef', '#e7ae7c', '#d491ac', '#7caee4']
/** Tuned to read well as text and as a soft tint in both themes. */
export const accountColors = [
  '#a3a3ad',
  '#a69aef',
  '#7caee4',
  '#6fc0cc',
  '#83bba8',
  '#d9bd6a',
  '#e7ae7c',
  '#d491ac',
  '#e58f8f',
] as const
/** The first palette colour no other account uses, so new accounts stay distinguishable. */
export function nextAccountColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  const free = accountColors.slice(1).find((c) => !taken.has(c))
  return free || accountColors[1 + (used.length % (accountColors.length - 1))]
}
export interface Account {
  id: string
  connectionId: string
  remoteId: string
  /** A private label shown only in this app, never sent to anyone. */
  name: string
  email: string
  /** The name recipients see in the From header; falls back to the server identity's name. */
  senderName?: string
  /**
   * Other addresses this account may send from, such as aliases set up with the provider. Only
   * IMAP accounts keep them here; JMAP servers list their own identities.
   */
  aliases?: Alias[]
  color: string
  seed?: string
  image?: string
  status: ConnectionState
  /** Why incoming mail is unavailable, when it is. */
  error?: string
  /** Set when the outgoing server rejected its login; incoming mail can still work. */
  outgoingError?: string
  sessionOnly?: boolean
  /** Absent on records saved before IMAP support, which were always JMAP. */
  protocol?: Protocol
  /** Actions this server cannot perform safely, each with an explanation to show instead. */
  limits?: AccountLimits
  /** Present while the local index is still catching up with the server. */
  indexing?: IndexingProgress
}
/** An address the provider delivers to this account and lets it send from. */
export interface Alias {
  /** Identifies the alias as a sending identity, so drafts and signatures follow it. */
  id: string
  email: string
  /** The name recipients see; falls back to the account's sender name. */
  name?: string
}
/** An alias to save; one without an ID is new. */
export type AliasInput = Omit<Alias, 'id'> & { id?: string }
export interface AccountLimits {
  move?: string
  destroy?: string
}
export interface IndexingProgress {
  indexed: number
  /** Messages the server reports; can grow while indexing. */
  total: number
  complete: boolean
}
export interface Mailbox {
  id: string
  accountId: string
  name: string
  role: string | null
  parentId: string | null
  totalEmails: number
  unreadEmails: number
  rights: {
    mayReadItems: boolean
    mayAddItems: boolean
    mayRemoveItems: boolean
    maySetSeen: boolean
    maySetKeywords: boolean
    mayCreateChild: boolean
    mayRename: boolean
    mayDelete: boolean
  }
}
export interface Address {
  name: string
  email: string
}
export interface Attachment {
  blobId: string
  name: string
  type: string
  size: number
  cid?: string
  disposition?: string
}
export interface Message {
  id: string
  accountId: string
  threadId: string
  subject: string
  from: Address[]
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  receivedAt: string
  sentAt?: string
  preview: string
  keywords: Record<string, boolean>
  mailboxIds: Record<string, boolean>
  size: number
  hasAttachment: boolean
  html?: string
  text?: string
  attachments?: Attachment[]
  messageId?: string[]
  inReplyTo?: string[]
  references?: string[]
  unsubscribe?: { url: string; oneClick: boolean }
}
export interface Conversation {
  id: string
  accountId: string
  key: string
  subject: string
  from: Address[]
  preview: string
  receivedAt: string
  unread: boolean
  starred: boolean
  hasAttachment: boolean
  count: number
  messages: Message[]
}
export interface Identity {
  id: string
  accountId: string
  name: string
  email: string
  mayDelete?: boolean
  textSignature?: string
  htmlSignature?: string
}
export interface MailQuery {
  view: View
  accountId?: string
  mailboxId?: string
  text?: string
  from?: string
  to?: string
  subject?: string
  after?: string
  before?: string
  hasAttachment?: boolean
  unread?: boolean
}
export interface QueryPage {
  items: Conversation[]
  next?: Record<string, number>
  total: number
  failedAccounts: string[]
  /** Accounts whose local index is still catching up; their results may be partial. */
  incompleteAccounts?: string[]
}
export interface StagedAttachment {
  id: string
  name: string
  type: string
  size: number
  blobId?: string
  cid?: string
}
export interface Draft {
  id: string
  accountId: string
  identityId: string
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  html: string
  text: string
  attachments: StagedAttachment[]
  updatedAt: string
  inReplyTo?: string[]
  references?: string[]
  replyThreadId?: string
  serverId?: string
  serverFingerprint?: string
  status: 'local' | 'saving' | 'synced' | 'error' | 'sending' | 'uncertain' | 'sent'
  error?: string
  /** What kind of problem `error` describes, so the composer can offer the right recovery. */
  errorKind?: DraftErrorKind
}
export type DraftErrorKind =
  'conflict' | 'connection' | 'outgoingAuthentication' | 'certificate' | 'rejected'
export interface Settings {
  theme: 'dark' | 'light' | 'system'
  remoteImages: boolean
  notifications: boolean
  closeToTray: boolean
  /** Use the system window frame instead of Inlark's title bar, after restarting. */
  systemTitleBar?: boolean
  defaultAccountId?: string
  signatures: Record<string, string>
  /** Identities whose signature is HTML code rather than plain text, keyed like `signatures`. */
  htmlSignatures?: Record<string, boolean>
  /** Where the reader goes after a conversation leaves the current view. */
  afterArchive?: 'next' | 'previous' | 'list'
  /**
   * Keyboard shortcuts changed from their defaults, by action. Each binding is a list of chords
   * pressed in turn, such as `['Mod+K']` or `['G', 'I']`; an empty list turns a shortcut off.
   */
  shortcuts?: Record<string, string[][]>
}
export const defaultSettings: Settings = {
  theme: 'dark',
  remoteImages: true,
  notifications: true,
  closeToTray: true,
  systemTitleBar: false,
  signatures: {},
}
export type MailAction =
  | 'archive'
  | 'trash'
  | 'restore'
  | 'spam'
  | 'notSpam'
  | 'read'
  | 'unread'
  | 'star'
  | 'unstar'
  | 'move'
  | 'destroy'
export interface MutationTarget {
  accountId: string
  threadId: string
}
export interface MutationInput {
  targets: MutationTarget[]
  action: MailAction
  mailboxId?: string
}
export interface MutationResult {
  changed: number
  failures: string[]
  undoId?: string
}
export interface AccountDetails {
  name: string
  senderName: string
}
export type Protocol = 'jmap' | 'imap'
/** Implicit TLS from the first byte, or a plain connection that must upgrade with STARTTLS. */
export type TransportSecurity = 'tls' | 'starttls'
export interface ServerSettings {
  host: string
  port: number
  security: TransportSecurity
  username: string
  /** A certificate the user chose to trust for this server, in addition to public authorities. */
  certificate?: TrustedCertificate
}
/** Exactly one certificate, identified by its SHA-256 fingerprint. */
export interface TrustedCertificate {
  /** Upper-case hex pairs separated by colons, as shown to the user. */
  sha256: string
  pem: string
}
/**
 * Why a server's certificate isn't accepted. `changed` means it differs from the trusted one.
 * `expired` and `notYetValid` can't be trusted at all.
 */
export type CertificateProblem =
  'selfSigned' | 'unknownIssuer' | 'otherName' | 'changed' | 'expired' | 'notYetValid'
/** A certificate a server presented, read without signing in, for the user to review. */
export interface CertificateDetails extends TrustedCertificate {
  problem: CertificateProblem
  /** The common name, or else the organization, of the subject and issuer. */
  subject: string
  issuer: string
  /** The host names and addresses the certificate is valid for. */
  names: string[]
  validFrom: string
  validTo: string
}
export interface JmapConnectionConfig {
  protocol: 'jmap'
  serverUrl: string
  username: string
}
export interface ImapConnectionConfig {
  protocol: 'imap'
  /** The account's own address. Aliases are kept on the account. */
  email: string
  incoming: ServerSettings
  outgoing: ServerSettings
  /** When true the outgoing server uses the incoming password. */
  outgoingSameCredentials: boolean
}
export type ConnectionConfig = JmapConnectionConfig | ImapConnectionConfig
export type FolderRole = 'sent' | 'drafts' | 'archive' | 'junk' | 'trash'
export const folderRoles: FolderRole[] = ['sent', 'drafts', 'archive', 'junk', 'trash']
/** An existing folder for a role, or one Inlark should create. `null` means none. */
export type FolderMappings = Partial<Record<FolderRole, { path: string; create?: boolean } | null>>
export interface FolderMappingReview {
  folders: { path: string; name: string }[]
  /**
   * `server` came from the server's special-use flags, `user` from an earlier choice. `name`
   * is only a guess from the folder's name and should be confirmed.
   */
  mappings: Partial<Record<FolderRole, { path: string; source: 'server' | 'user' | 'name' } | null>>
}
export interface ConnectInput {
  config: ConnectionConfig
  password: string
  /** Only used when the outgoing server has its own credentials. */
  outgoingPassword?: string
  name: string
  senderName?: string
  remember: boolean
  connectionId?: string
  folders?: FolderMappings
}
/** A saved connection as the renderer may see it: never includes passwords. */
export interface ConnectionSettings {
  connectionId: string
  name: string
  config: ConnectionConfig
  remember: boolean
  folders?: FolderMappings
}
export type DiscoverySource =
  'jmap-srv' | 'jmap-well-known' | 'autoconfig' | 'imap-srv' | 'directory'
export type DiscoveryCandidate =
  | { protocol: 'jmap'; source: DiscoverySource; serverUrl: string; username: string }
  | {
      protocol: 'imap'
      source: DiscoverySource
      incoming: ServerSettings
      outgoing: ServerSettings
      /** The provider name from a configuration file, shown for recognition only. */
      provider?: string
    }
export interface DiscoveryResult {
  email: string
  domain: string
  /** In order of preference; JMAP always precedes IMAP. */
  candidates: DiscoveryCandidate[]
}
export interface ConnectionCheck {
  ok: boolean
  error?: string
  /** The certificate that stopped the connection, when the user may be able to trust it. */
  certificate?: CertificateDetails
}
export interface ConnectionTest {
  incoming: ConnectionCheck
  /** Absent for JMAP, which submits through the same connection. */
  outgoing?: ConnectionCheck
  folders?: FolderMappingReview
}
export interface ProviderCapabilities {
  mail: boolean
  submission: boolean
  push: boolean
  maxObjectsInGet: number
  maxObjectsInSet: number
  maxUploadSize: number
  /** Attachments must be uploaded before a draft can reference them (JMAP blobs). */
  blobUpload?: boolean
  /** A message lives in exactly one folder, so adding a folder without removing one copies it. */
  exclusiveMailboxes?: boolean
  /** `client` means the app must file its own Sent copy after submission. */
  sentCopy?: 'server' | 'client'
}
export interface ProviderPage {
  items: Conversation[]
  total: number
  next?: number
  /** The local index has not caught up yet, so this page may miss older mail. */
  incomplete?: boolean
}
/**
 * A provider-neutral change to one message. `true` adds a folder or keyword, `false` removes it.
 * Each provider translates this into its own protocol operations.
 */
export interface MessageChange {
  mailboxes?: Record<string, boolean>
  keywords?: Record<string, boolean>
}
export type MessageChanges = Record<string, MessageChange>
/** A message ready for submission, persisted before any network send. */
export interface OutgoingMessage {
  /** The RFC 5322 Message-ID, without angle brackets. Unique per send attempt. */
  messageId: string
  /** The server-side email, for providers that submit stored messages (JMAP). */
  emailId?: string
  /** Complete MIME without Bcc headers, for providers that transmit it themselves (SMTP). */
  mime?: Uint8Array
  envelope: { from: string; to: string[] }
}
export interface SubmissionOutcome {
  accepted: string[]
  rejected: { email: string; reason: string }[]
}
export interface ProviderEvent {
  type: 'changed' | 'status' | 'indexing'
  accountId?: string
  state?: ConnectionState
  message?: string
  indexing?: IndexingProgress
  /** Set for changes found by historical indexing, which must never notify. */
  historical?: boolean
}
export interface MailProvider {
  readonly capabilities: ProviderCapabilities
  connect(): Promise<Account[]>
  /** Signs in to the outgoing server without sending anything (SMTP providers only). */
  verifyOutgoing?(): Promise<void>
  /**
   * Reads the certificate a server presents without signing in. Undefined when the certificate
   * would be accepted or can't be read.
   */
  inspectCertificate?(server: 'incoming' | 'outgoing'): Promise<CertificateDetails | undefined>
  /** Releases resources asynchronously, e.g. closing a local index before its files are removed. */
  close?(): Promise<void>
  mailboxes(account: Account): Promise<Mailbox[]>
  identities(account: Account): Promise<Identity[]>
  query(
    account: Account,
    query: MailQuery,
    position?: number,
    limit?: number,
  ): Promise<ProviderPage>
  conversation(account: Account, threadId: string): Promise<Message[]>
  getStateToken(account: Account): string | undefined
  update(
    account: Account,
    changes: MessageChanges,
    destroy?: string[],
    expectedState?: string,
  ): Promise<{ updated: string[]; failures: string[] }>
  conversationMetadata(account: Account, threadIds: string[]): Promise<Message[]>
  messages(account: Account, ids: string[], bodies?: boolean): Promise<Message[]>
  folder(
    account: Account,
    operation: 'create' | 'rename' | 'delete',
    id?: string,
    name?: string,
    parentId?: string,
  ): Promise<void>
  upload(account: Account, data: Uint8Array, type: string): Promise<string>
  download(account: Account, attachment: Attachment): Promise<Uint8Array>
  createDraft(account: Account, draft: Draft, messageId?: string): Promise<string>
  /** Builds or stores the message to send. Must not transmit anything to recipients. */
  prepareSubmission(account: Account, draft: Draft, messageId: string): Promise<OutgoingMessage>
  /**
   * Sends a prepared message once. Throws `submissionRejected` when nothing was accepted,
   * `submissionUncertain` when the outcome is unknown, and other codes when sending never began.
   */
  submit(account: Account, message: OutgoingMessage, identityId: string): Promise<SubmissionOutcome>
  /** Whether the server proves this message was submitted. A Sent copy alone is not proof. */
  submissionExists(account: Account, message: OutgoingMessage): Promise<boolean>
  /**
   * Files a Sent copy for providers that do not do so themselves. Returns `server` when a copy
   * with the same Message-ID already exists. Throws `filingUncertain` when an append may have
   * completed without confirmation.
   */
  fileSentCopy?(account: Account, message: OutgoingMessage): Promise<'filed' | 'server'>
  folderMappings?(account: Account): Promise<FolderMappingReview>
  setFolderMappings?(account: Account, mappings: FolderMappings): Promise<FolderMappingReview>
  subscribe(listener: (event: ProviderEvent) => void): () => void
  dispose(): void
}
export type AppEvent =
  | { type: 'unread'; count: number }
  | { type: 'changed'; accountId?: string }
  | { type: 'accounts'; accounts: Account[] }
  | { type: 'mailto'; url: string }
  | { type: 'open'; accountId: string; threadId: string }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'submissions'; submissions: SubmissionSummary[] }
  | { type: 'update'; status: UpdateStatus }
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'manual'; version: string }
export interface SendResult {
  status: 'sent' | 'partial' | 'uncertain'
  message: string
  /** `pending` means the message was sent but its Sent copy is not filed yet. */
  sentCopy?: 'filed' | 'pending'
  /** Recipients the server refused while accepting others. */
  rejected?: Address[]
}
/** The state of a send that still needs the user's attention. Contains no message body. */
export interface SubmissionSummary {
  draftId: string
  accountId: string
  subject: string
  at: string
  state: 'sent' | 'partial' | 'uncertain'
  sentCopy?: 'pending' | 'uncertain' | 'failed'
  rejected?: Address[]
  error?: string
}
export interface Bootstrap {
  accounts: Account[]
  settings: Settings
  secureStorage: boolean
  demo: boolean
  version: string
}
export interface DesktopMailAPI {
  bootstrap(): Promise<Bootstrap>
  updateStatus(): Promise<UpdateStatus>
  ready(): Promise<void>
  discover(email: string): Promise<DiscoveryResult>
  /** Checks a login without saving it. Nothing is sent to any recipient. */
  testConnection(input: ConnectInput): Promise<ConnectionTest>
  connect(input: ConnectInput): Promise<Account[]>
  connectionSettings(connectionId: string): Promise<ConnectionSettings>
  folderMappings(accountId: string): Promise<FolderMappingReview>
  setFolderMappings(accountId: string, mappings: FolderMappings): Promise<FolderMappingReview>
  disconnect(connectionId: string): Promise<void>
  reconnect(connectionId: string): Promise<void>
  updateAccount(accountId: string, appearance: AccountAppearance): Promise<Account[]>
  updateAccountDetails(accountId: string, details: AccountDetails): Promise<Account[]>
  /** Replaces an IMAP account's aliases. The provider must already deliver and accept them. */
  setAliases(accountId: string, aliases: AliasInput[]): Promise<Account[]>
  mailboxes(accountId: string): Promise<Mailbox[]>
  identities(accountId: string): Promise<Identity[]>
  query(query: MailQuery, cursor?: Record<string, number>): Promise<QueryPage>
  conversation(accountId: string, threadId: string): Promise<Message[]>
  mutate(input: MutationInput): Promise<MutationResult>
  mutateAll(query: MailQuery, action: MailAction): Promise<MutationResult>
  undo(id: string): Promise<MutationResult>
  folder(input: {
    accountId: string
    operation: 'create' | 'rename' | 'delete'
    id?: string
    name?: string
    parentId?: string
  }): Promise<void>
  drafts(): Promise<Draft[]>
  resumeDraft(accountId: string, messageId: string): Promise<Draft>
  stageRemoteAttachments(accountId: string, attachments: Attachment[]): Promise<StagedAttachment[]>
  saveDraft(draft: Draft): Promise<Draft>
  syncDraft(draft: Draft): Promise<Draft>
  deleteDraft(id: string): Promise<void>
  /** Deletes a draft that exists only on the server, such as one started in another client. */
  deleteServerDraft(accountId: string, messageId: string): Promise<void>
  send(draft: Draft): Promise<SendResult>
  reconcile(draftId: string): Promise<SendResult>
  submissions(): Promise<SubmissionSummary[]>
  /** Retries only the Sent copy of a message that was already sent. */
  retrySentCopy(draftId: string): Promise<SendResult>
  /** Starts a new draft addressed only to the recipients a partial send refused. */
  recoverRejected(draftId: string): Promise<Draft>
  /** Starts a new draft from an unconfirmed send; the unconfirmed record is kept. */
  replaceUncertain(draftId: string): Promise<Draft>
  dismissSubmission(draftId: string): Promise<void>
  stageAttachments(): Promise<StagedAttachment[]>
  attachment(accountId: string, attachment: Attachment, open: boolean): Promise<void>
  inlineImage(accountId: string, attachment: Attachment): Promise<string>
  remoteImage(url: string): Promise<string | null>
  senderAvatar(email: string): Promise<string | null>
  unsubscribe(
    accountId: string,
    messageId: string,
  ): Promise<{ kind: 'done' | 'mailto' | 'browser'; url?: string }>
  openExternal(url: string): Promise<void>
  settings(settings: Settings): Promise<Settings>
  restart(): Promise<void>
  diagnostics(): Promise<string>
  onEvent(listener: (event: AppEvent) => void): () => void
}
