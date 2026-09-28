import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ConversationCursor,
  ConversationFilter,
  ConversationRow,
  FolderListing,
  IndexedMailbox,
  IndexedMessage,
  MailboxStatePatch,
  MessageLocation,
  MetadataIndex,
  NewMessage,
} from '@inlark/imap'

/** The synchronous shape of `MetadataIndex`, as run inside the worker. */
export type SyncMetadataIndex = {
  [K in keyof MetadataIndex]: MetadataIndex[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => R
    : never
}

// A record forces this list to stay complete when the interface grows.
const methodTable: Record<keyof MetadataIndex, true> = {
  close: true,
  syncMailboxes: true,
  listMailboxes: true,
  renameMailbox: true,
  updateMailbox: true,
  resetMailbox: true,
  upsertMessages: true,
  updateFlags: true,
  removeUids: true,
  removeMessages: true,
  knownUids: true,
  relocate: true,
  setPreview: true,
  messages: true,
  messagesAt: true,
  threadMessages: true,
  resolveThread: true,
  findByMessageId: true,
  conversations: true,
  counts: true,
  getMeta: true,
  setMeta: true,
}
export const indexMethods = Object.keys(methodTable) as (keyof MetadataIndex)[]

export const SCHEMA_VERSION = 1
const MAX_REFERENCES = 50

const migrations = [
  `CREATE TABLE mailboxes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    delimiter TEXT NOT NULL,
    parent_path TEXT,
    special_use TEXT,
    guessed_special_use TEXT,
    no_select INTEGER NOT NULL,
    position INTEGER NOT NULL,
    uid_validity TEXT,
    uid_next INTEGER,
    highest_modseq TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0,
    indexed_from INTEGER,
    complete INTEGER NOT NULL DEFAULT 0,
    UNIQUE (account_id, path),
    UNIQUE (account_id, id)
  );
  CREATE TABLE messages (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    mailbox_id TEXT NOT NULL,
    uid_validity TEXT NOT NULL,
    uid INTEGER NOT NULL,
    modseq TEXT,
    message_id TEXT,
    in_reply_to TEXT NOT NULL,
    refs TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    cc_addr TEXT NOT NULL,
    bcc_addr TEXT NOT NULL,
    reply_to TEXT NOT NULL,
    received_at TEXT NOT NULL,
    received_ms INTEGER NOT NULL,
    sent_at TEXT,
    size INTEGER NOT NULL,
    flags TEXT NOT NULL,
    seen INTEGER NOT NULL,
    flagged INTEGER NOT NULL,
    has_attachment INTEGER NOT NULL,
    preview TEXT NOT NULL,
    body_structure TEXT,
    unsubscribe TEXT,
    UNIQUE (account_id, mailbox_id, uid, uid_validity),
    FOREIGN KEY (account_id, mailbox_id) REFERENCES mailboxes (account_id, id) ON DELETE CASCADE
  );
  CREATE INDEX messages_mailbox_thread ON messages (account_id, mailbox_id, thread_id, received_ms);
  CREATE INDEX messages_thread ON messages (account_id, thread_id, received_ms, mailbox_id);
  CREATE INDEX messages_message_id ON messages (account_id, message_id) WHERE message_id IS NOT NULL;
  CREATE INDEX messages_unseen ON messages (account_id, thread_id, received_ms) WHERE seen = 0;
  CREATE INDEX messages_flagged ON messages (account_id, thread_id, received_ms) WHERE flagged = 1;
  CREATE TABLE threads (
    seq INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL,
    id TEXT NOT NULL,
    UNIQUE (account_id, id)
  );
  CREATE TABLE thread_refs (
    account_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    PRIMARY KEY (account_id, message_id)
  ) WITHOUT ROWID;
  CREATE INDEX thread_refs_thread ON thread_refs (account_id, thread_id);
  CREATE TABLE thread_aliases (
    account_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    PRIMARY KEY (account_id, alias)
  ) WITHOUT ROWID;
  CREATE INDEX thread_aliases_thread ON thread_aliases (account_id, thread_id);
  CREATE TABLE meta (
    account_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (account_id, key)
  ) WITHOUT ROWID;`,
]

interface MailboxRow {
  id: string
  path: string
  name: string
  delimiter: string
  parent_path: string | null
  special_use: string | null
  guessed_special_use: string | null
  no_select: number
  uid_validity: string | null
  uid_next: number | null
  highest_modseq: string | null
  total: number
  unread: number
  indexed_from: number | null
  complete: number
}

interface MessageRow {
  seq: number
  id: string
  mailbox_id: string
  uid_validity: string
  uid: number
  modseq: string | null
  message_id: string | null
  in_reply_to: string
  refs: string
  thread_id: string
  subject: string
  from_addr: string
  to_addr: string
  cc_addr: string
  bcc_addr: string
  reply_to: string
  received_at: string
  sent_at: string | null
  size: number
  flags: string
  has_attachment: number
  preview: string
  body_structure: string | null
  unsubscribe: string | null
}

/** Message-IDs without brackets or whitespace; a header value may hold several. */
function messageIds(values: (string | null | undefined)[]) {
  const ids: string[] = []
  for (const value of values)
    if (value) for (const id of value.split(/[\s<>]+/)) if (id && !ids.includes(id)) ids.push(id)
  return ids
}

function hasFlag(flags: string[], flag: string) {
  return flags.some((value) => value.toLowerCase() === flag) ? 1 : 0
}

function time(value: string) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

const json = (value: unknown) => JSON.stringify(value)
const list = (values: readonly unknown[]) => JSON.stringify(values)

function toMailbox(row: MailboxRow): IndexedMailbox {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    delimiter: row.delimiter,
    parentPath: row.parent_path,
    specialUse: row.special_use,
    guessedSpecialUse: row.guessed_special_use,
    noSelect: row.no_select === 1,
    uidValidity: row.uid_validity,
    uidNext: row.uid_next,
    highestModseq: row.highest_modseq,
    total: row.total,
    unread: row.unread,
    indexedFrom: row.indexed_from,
    complete: row.complete === 1,
  }
}

function toMessage(row: MessageRow): IndexedMessage {
  const message: IndexedMessage = {
    id: row.id,
    threadId: row.thread_id,
    mailboxId: row.mailbox_id,
    uidValidity: row.uid_validity,
    uid: row.uid,
    messageId: row.message_id,
    inReplyTo: JSON.parse(row.in_reply_to),
    references: JSON.parse(row.refs),
    subject: row.subject,
    from: JSON.parse(row.from_addr),
    to: JSON.parse(row.to_addr),
    cc: JSON.parse(row.cc_addr),
    bcc: JSON.parse(row.bcc_addr),
    replyTo: JSON.parse(row.reply_to),
    receivedAt: row.received_at,
    size: row.size,
    flags: JSON.parse(row.flags),
    hasAttachment: row.has_attachment === 1,
    preview: row.preview,
  }
  if (row.modseq !== null) message.modseq = row.modseq
  if (row.sent_at !== null) message.sentAt = row.sent_at
  if (row.body_structure !== null) message.bodyStructure = JSON.parse(row.body_structure)
  if (row.unsubscribe !== null) message.unsubscribe = JSON.parse(row.unsubscribe)
  return message
}

const MESSAGE_COLUMNS = `seq, id, mailbox_id, uid_validity, uid, modseq, message_id, in_reply_to, refs,
  thread_id, subject, from_addr, to_addr, cc_addr, bcc_addr, reply_to, received_at, sent_at, size,
  flags, has_attachment, preview, body_structure, unsubscribe`

function prepareFile(path: string) {
  if (path === ':memory:') return
  // A new directory and file are private; an existing directory is left as the caller made it.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  closeSync(openSync(path, 'a', 0o600))
  chmodSync(path, 0o600)
}

/**
 * The SQLite IMAP metadata index. All methods are synchronous; the desktop app runs this in a
 * worker thread so large transactions never block the main process.
 */
export class SqliteMetadataIndex implements SyncMetadataIndex {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private closed = false

  constructor(path: string) {
    prepareFile(path)
    const db = new DatabaseSync(path, { timeout: 5000 })
    try {
      // Checked before any pragma that writes, so a newer file is never modified.
      const version = Number(
        (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      )
      if (version > SCHEMA_VERSION)
        throw new Error(
          'The mail index was created by a newer version of Inlark (schema ' +
            version +
            '). It has been left unchanged.',
        )
      db.exec(
        `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
          PRAGMA cache_size = -32768; PRAGMA temp_store = MEMORY`,
      )
      for (let from = version; from < SCHEMA_VERSION; from++) {
        db.exec('BEGIN IMMEDIATE')
        try {
          db.exec(migrations[from]!)
          db.exec('PRAGMA user_version = ' + (from + 1))
          db.exec('COMMIT')
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK')
          throw error
        }
      }
    } catch (error) {
      db.close()
      throw error
    }
    this.db = db
  }

  private stmt(sql: string) {
    let statement = this.statements.get(sql)
    if (!statement) {
      if (this.closed) throw new Error('The mail index is closed.')
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }
  private run(sql: string, ...params: SQLInputValue[]) {
    return this.stmt(sql).run(...params)
  }
  private get<T>(sql: string, ...params: SQLInputValue[]) {
    return this.stmt(sql).get(...params) as T | undefined
  }
  private all<T>(sql: string, ...params: SQLInputValue[]) {
    return this.stmt(sql).all(...params) as T[]
  }
  private tx<T>(fn: () => T): T {
    if (this.closed) throw new Error('The mail index is closed.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.db.close()
  }

  syncMailboxes(accountId: string, folders: FolderListing[]) {
    this.tx(() => {
      const known = new Map(
        this.all<{ id: string; path: string }>(
          'SELECT id, path FROM mailboxes WHERE account_id = ?',
          accountId,
        ).map((row) => [row.path, row.id]),
      )
      const listed = new Set<string>()
      folders.forEach((folder, position) => {
        if (listed.has(folder.path)) return
        listed.add(folder.path)
        const fields = [
          folder.name,
          folder.delimiter,
          folder.parentPath,
          folder.specialUse,
          folder.guessedSpecialUse,
          folder.noSelect ? 1 : 0,
          position,
        ]
        const id = known.get(folder.path)
        if (id)
          this.run(
            `UPDATE mailboxes SET name = ?, delimiter = ?, parent_path = ?, special_use = ?,
              guessed_special_use = ?, no_select = ?, position = ? WHERE account_id = ? AND id = ?`,
            ...fields,
            accountId,
            id,
          )
        else
          this.run(
            `INSERT INTO mailboxes (id, account_id, path, name, delimiter, parent_path, special_use,
              guessed_special_use, no_select, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            randomUUID(),
            accountId,
            folder.path,
            ...fields,
          )
      })
      for (const [path, id] of known)
        if (!listed.has(path))
          this.run('DELETE FROM mailboxes WHERE account_id = ? AND id = ?', accountId, id)
    })
    return this.listMailboxes(accountId)
  }

  listMailboxes(accountId: string) {
    return this.all<MailboxRow>(
      'SELECT * FROM mailboxes WHERE account_id = ? ORDER BY position, path',
      accountId,
    ).map(toMailbox)
  }

  private mailbox(accountId: string, mailboxId: string) {
    const row = this.get<MailboxRow>(
      'SELECT * FROM mailboxes WHERE account_id = ? AND id = ?',
      accountId,
      mailboxId,
    )
    if (!row) throw new Error('Unknown mailbox in the mail index.')
    return row
  }

  renameMailbox(accountId: string, mailboxId: string, path: string, name: string) {
    this.tx(() => {
      const mailbox = this.mailbox(accountId, mailboxId)
      if (mailbox.path === path) {
        this.run('UPDATE mailboxes SET name = ? WHERE id = ?', name, mailboxId)
        return
      }
      if (this.get('SELECT 1 FROM mailboxes WHERE account_id = ? AND path = ?', accountId, path))
        throw new Error('Another mailbox already uses this path.')
      const separator = mailbox.delimiter ? path.lastIndexOf(mailbox.delimiter) : -1
      this.run(
        'UPDATE mailboxes SET path = ?, name = ?, parent_path = ? WHERE id = ?',
        path,
        name,
        separator > 0 ? path.slice(0, separator) : null,
        mailboxId,
      )
      // IMAP renames descendants with their parent; keeping their IDs keeps their messages.
      if (!mailbox.delimiter) return
      const prefix = mailbox.path + mailbox.delimiter
      for (const child of this.all<{ id: string; path: string; parent_path: string | null }>(
        'SELECT id, path, parent_path FROM mailboxes WHERE account_id = ? AND substr(path, 1, ?) = ?',
        accountId,
        prefix.length,
        prefix,
      )) {
        const rewrite = (value: string) => path + value.slice(mailbox.path.length)
        this.run(
          'UPDATE mailboxes SET path = ?, parent_path = ? WHERE id = ?',
          rewrite(child.path),
          child.parent_path === mailbox.path || child.parent_path?.startsWith(prefix)
            ? rewrite(child.parent_path)
            : child.parent_path,
          child.id,
        )
      }
    })
  }

  updateMailbox(accountId: string, mailboxId: string, patch: MailboxStatePatch) {
    this.tx(() => {
      this.mailbox(accountId, mailboxId)
      if (
        patch.uidValidity != null &&
        this.get(
          'SELECT 1 FROM messages WHERE account_id = ? AND mailbox_id = ? AND uid_validity <> ? LIMIT 1',
          accountId,
          mailboxId,
          patch.uidValidity,
        )
      )
        throw new Error('The mailbox UIDVALIDITY changed; reset the mailbox before indexing it.')
      const columns: Record<keyof MailboxStatePatch, string> = {
        uidValidity: 'uid_validity',
        uidNext: 'uid_next',
        highestModseq: 'highest_modseq',
        total: 'total',
        unread: 'unread',
        indexedFrom: 'indexed_from',
        complete: 'complete',
      }
      const sets: string[] = []
      const params: SQLInputValue[] = []
      for (const key of Object.keys(columns) as (keyof MailboxStatePatch)[]) {
        const value = patch[key]
        if (value === undefined) continue
        sets.push(columns[key] + ' = ?')
        params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
      }
      if (sets.length)
        this.run('UPDATE mailboxes SET ' + sets.join(', ') + ' WHERE id = ?', ...params, mailboxId)
    })
  }

  resetMailbox(accountId: string, mailboxId: string, uidValidity: string) {
    this.tx(() => {
      this.mailbox(accountId, mailboxId)
      this.run('DELETE FROM messages WHERE account_id = ? AND mailbox_id = ?', accountId, mailboxId)
      this.run(
        `UPDATE mailboxes SET uid_validity = ?, uid_next = NULL, highest_modseq = NULL,
          indexed_from = NULL, complete = 0 WHERE id = ?`,
        uidValidity,
        mailboxId,
      )
    })
  }

  /**
   * Every stored location in a mailbox carries the mailbox's current UIDVALIDITY, so a stale
   * location can never be written. `validities` caches the answer for one transaction.
   */
  private checkLocation(
    accountId: string,
    location: MessageLocation,
    validities: Map<string, string>,
  ) {
    let current = validities.get(location.mailboxId)
    if (current === undefined) {
      current =
        this.mailbox(accountId, location.mailboxId).uid_validity ??
        this.get<{ v: string }>(
          'SELECT uid_validity AS v FROM messages WHERE account_id = ? AND mailbox_id = ? LIMIT 1',
          accountId,
          location.mailboxId,
        )?.v ??
        location.uidValidity
      validities.set(location.mailboxId, current)
    }
    if (current !== location.uidValidity)
      throw new Error('The message location has a stale UIDVALIDITY for its mailbox.')
  }

  private newThread(accountId: string) {
    const id = randomUUID()
    this.run('INSERT INTO threads (account_id, id) VALUES (?, ?)', accountId, id)
    return id
  }

  /**
   * Finds every thread already known for the message's own ID or its parents. Several threads
   * mean the message links them, so they merge into the oldest; the others become aliases.
   */
  private assignThread(accountId: string, keys: string[]) {
    if (!keys.length) return this.newThread(accountId)
    const found = this.all<{ id: string; seq: number | null }>(
      `SELECT DISTINCT r.thread_id AS id, t.seq AS seq FROM json_each(?) j
        CROSS JOIN thread_refs r ON r.account_id = ? AND r.message_id = j.value
        LEFT JOIN threads t ON t.account_id = r.account_id AND t.id = r.thread_id`,
      list(keys),
      accountId,
    )
    found.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || (a.id < b.id ? -1 : 1))
    const thread = found[0]?.id ?? this.newThread(accountId)
    for (const { id: loser } of found.slice(1)) {
      this.run(
        'UPDATE messages SET thread_id = ? WHERE account_id = ? AND thread_id = ?',
        thread,
        accountId,
        loser,
      )
      this.run(
        'UPDATE thread_refs SET thread_id = ? WHERE account_id = ? AND thread_id = ?',
        thread,
        accountId,
        loser,
      )
      this.run(
        'UPDATE thread_aliases SET thread_id = ? WHERE account_id = ? AND thread_id = ?',
        thread,
        accountId,
        loser,
      )
      this.run(
        `INSERT INTO thread_aliases (account_id, alias, thread_id) VALUES (?, ?, ?)
          ON CONFLICT DO UPDATE SET thread_id = excluded.thread_id`,
        accountId,
        loser,
        thread,
      )
      this.run('DELETE FROM threads WHERE account_id = ? AND id = ?', accountId, loser)
    }
    this.run(
      `INSERT INTO thread_refs (account_id, message_id, thread_id)
        SELECT ?, value, ? FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`,
      accountId,
      thread,
      list(keys),
    )
    return thread
  }

  upsertMessages(accountId: string, messages: NewMessage[]) {
    return this.tx(() => {
      const validities = new Map<string, string>()
      return messages.map((message) => {
        this.checkLocation(accountId, message, validities)
        const seen = hasFlag(message.flags, '\\seen')
        const flagged = hasFlag(message.flags, '\\flagged')
        const existing = this.get<{ id: string }>(
          `SELECT id FROM messages
            WHERE account_id = ? AND mailbox_id = ? AND uid = ? AND uid_validity = ?`,
          accountId,
          message.mailboxId,
          message.uid,
          message.uidValidity,
        )
        if (existing) {
          this.run(
            `UPDATE messages SET flags = ?, seen = ?, flagged = ?, modseq = coalesce(?, modseq),
              preview = CASE WHEN ? <> '' THEN ? ELSE preview END WHERE id = ?`,
            list(message.flags),
            seen,
            flagged,
            message.modseq ?? null,
            message.preview,
            message.preview,
            existing.id,
          )
          return existing.id
        }
        const [messageId = null] = messageIds([message.messageId])
        const references = message.references.slice(-MAX_REFERENCES)
        const parents = messageIds([...message.inReplyTo, ...references]).filter(
          (id) => id !== messageId,
        )
        const threadId = this.assignThread(accountId, messageId ? [messageId, ...parents] : parents)
        const id = randomUUID()
        this.run(
          `INSERT INTO messages (id, account_id, mailbox_id, uid_validity, uid, modseq, message_id,
            in_reply_to, refs, thread_id, subject, from_addr, to_addr, cc_addr, bcc_addr, reply_to,
            received_at, received_ms, sent_at, size, flags, seen, flagged, has_attachment, preview,
            body_structure, unsubscribe)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          accountId,
          message.mailboxId,
          message.uidValidity,
          message.uid,
          message.modseq ?? null,
          messageId,
          list(message.inReplyTo),
          list(references),
          threadId,
          message.subject,
          list(message.from),
          list(message.to),
          list(message.cc),
          list(message.bcc),
          list(message.replyTo),
          message.receivedAt,
          time(message.receivedAt),
          message.sentAt ?? null,
          message.size,
          list(message.flags),
          seen,
          flagged,
          message.hasAttachment ? 1 : 0,
          message.preview,
          message.bodyStructure ? json(message.bodyStructure) : null,
          message.unsubscribe ? json(message.unsubscribe) : null,
        )
        return id
      })
    })
  }

  updateFlags(
    accountId: string,
    mailboxId: string,
    updates: { uid: number; flags: string[]; modseq?: string }[],
  ) {
    this.tx(() => {
      for (const update of updates)
        this.run(
          `UPDATE messages SET flags = ?, seen = ?, flagged = ?, modseq = coalesce(?, modseq)
            WHERE account_id = ? AND mailbox_id = ? AND uid = ?`,
          list(update.flags),
          hasFlag(update.flags, '\\seen'),
          hasFlag(update.flags, '\\flagged'),
          update.modseq ?? null,
          accountId,
          mailboxId,
          update.uid,
        )
    })
  }

  removeUids(accountId: string, mailboxId: string, uids: number[]) {
    if (!uids.length) return
    this.tx(() => {
      this.run(
        `DELETE FROM messages WHERE account_id = ? AND mailbox_id = ?
          AND uid IN (SELECT value FROM json_each(?))`,
        accountId,
        mailboxId,
        list(uids),
      )
    })
  }

  removeMessages(accountId: string, ids: string[]) {
    if (!ids.length) return
    this.tx(() => {
      this.run(
        'DELETE FROM messages WHERE +account_id = ? AND id IN (SELECT value FROM json_each(?))',
        accountId,
        list(ids),
      )
    })
  }

  knownUids(accountId: string, mailboxId: string) {
    return this.all<{ uid: number }>(
      'SELECT uid FROM messages WHERE account_id = ? AND mailbox_id = ? ORDER BY uid',
      accountId,
      mailboxId,
    ).map((row) => row.uid)
  }

  relocate(accountId: string, id: string, location: MessageLocation) {
    this.tx(() => {
      this.checkLocation(accountId, location, new Map())
      if (!this.get('SELECT 1 FROM messages WHERE account_id = ? AND id = ?', accountId, id))
        throw new Error('Unknown message in the mail index.')
      // The confirmed move identifies this message; a copy indexed there meanwhile is the same one.
      this.run(
        `DELETE FROM messages WHERE account_id = ? AND mailbox_id = ? AND uid = ?
          AND uid_validity = ? AND id <> ?`,
        accountId,
        location.mailboxId,
        location.uid,
        location.uidValidity,
        id,
      )
      this.run(
        `UPDATE messages SET mailbox_id = ?, uid_validity = ?, uid = ?, modseq = NULL
          WHERE account_id = ? AND id = ?`,
        location.mailboxId,
        location.uidValidity,
        location.uid,
        accountId,
        id,
      )
    })
  }

  setPreview(accountId: string, id: string, preview: string) {
    this.run(
      'UPDATE messages SET preview = ? WHERE account_id = ? AND id = ?',
      preview,
      accountId,
      id,
    )
  }

  messages(accountId: string, ids: string[]) {
    if (!ids.length) return []
    // The unary plus keeps the planner on the ID index instead of scanning the account.
    return this.all<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
        WHERE +account_id = ? AND id IN (SELECT value FROM json_each(?))`,
      accountId,
      list(ids),
    ).map(toMessage)
  }

  messagesAt(accountId: string, mailboxId: string, uids: number[]) {
    if (!uids.length) return []
    return this.all<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = ? AND mailbox_id = ?
        AND uid IN (SELECT value FROM json_each(?)) ORDER BY uid`,
      accountId,
      mailboxId,
      list(uids),
    ).map(toMessage)
  }

  threadMessages(accountId: string, threadIds: string[]) {
    if (!threadIds.length) return []
    return this.all<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = ? AND thread_id IN (
          SELECT coalesce(a.thread_id, t.value) FROM json_each(?) t
          LEFT JOIN thread_aliases a ON a.account_id = ? AND a.alias = t.value)
        ORDER BY received_ms, seq`,
      accountId,
      list(threadIds),
      accountId,
    ).map(toMessage)
  }

  resolveThread(accountId: string, threadId: string) {
    return (
      this.get<{ thread_id: string }>(
        'SELECT thread_id FROM thread_aliases WHERE account_id = ? AND alias = ?',
        accountId,
        threadId,
      )?.thread_id ?? threadId
    )
  }

  findByMessageId(accountId: string, messageId: string, mailboxId?: string) {
    const [id] = messageIds([messageId])
    if (!id) return []
    return (
      mailboxId === undefined
        ? this.all<MessageRow>(
            `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = ? AND message_id = ?
              ORDER BY received_ms, seq`,
            accountId,
            id,
          )
        : this.all<MessageRow>(
            `SELECT ${MESSAGE_COLUMNS} FROM messages
              WHERE account_id = ? AND message_id = ? AND mailbox_id = ? ORDER BY received_ms, seq`,
            accountId,
            id,
            mailboxId,
          )
    ).map(toMessage)
  }

  /** The grouped, filtered conversation set, or `null` when the filter cannot match. */
  private conversationSource(accountId: string, filter: ConversationFilter) {
    const mailboxIds = filter.mailboxIds && [...new Set(filter.mailboxIds)]
    if (mailboxIds?.length === 0 || filter.ids?.length === 0) return null
    const where: string[] = []
    const params: SQLInputValue[] = []
    let from: string
    // SQLite cannot estimate json_each sizes; CROSS JOIN makes the given list drive the lookup.
    if (filter.ids) {
      from = 'json_each(?) j CROSS JOIN messages m ON m.id = j.value'
      params.push(list(filter.ids))
      where.push('m.account_id = ?')
      params.push(accountId)
    } else if (mailboxIds && mailboxIds.length > 1) {
      from = 'json_each(?) j CROSS JOIN messages m ON m.account_id = ? AND m.mailbox_id = j.value'
      params.push(list(mailboxIds), accountId)
    } else {
      from = 'messages m'
      where.push('m.account_id = ?')
      params.push(accountId)
    }
    if (mailboxIds && !filter.ids && mailboxIds.length === 1) {
      where.push('m.mailbox_id = ?')
      params.push(mailboxIds[0]!)
    } else if (mailboxIds && filter.ids) {
      where.push('m.mailbox_id IN (SELECT value FROM json_each(?))')
      params.push(list(mailboxIds))
    }
    if (filter.excludeMailboxIds?.length) {
      where.push('m.mailbox_id NOT IN (SELECT value FROM json_each(?))')
      params.push(list(filter.excludeMailboxIds))
    }
    // Literals, not parameters, so the partial indexes on these columns apply.
    if (filter.flagged !== undefined) where.push('m.flagged = ' + (filter.flagged ? 1 : 0))
    if (filter.unseen !== undefined) where.push('m.seen = ' + (filter.unseen ? 0 : 1))
    if (filter.hasAttachment !== undefined)
      where.push('m.has_attachment = ' + (filter.hasAttachment ? 1 : 0))
    if (filter.after !== undefined) {
      where.push('m.received_ms >= ?')
      params.push(time(filter.after))
    }
    if (filter.before !== undefined) {
      where.push('m.received_ms < ?')
      params.push(time(filter.before))
    }
    // With a single max() aggregate, SQLite takes the bare `seq` from the row holding the max.
    return {
      sql: `SELECT m.thread_id AS t, max(m.received_ms) AS r, m.seq AS s FROM ${from}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY m.thread_id`,
      params,
    }
  }

  conversations(
    accountId: string,
    filter: ConversationFilter,
    page: { limit: number; offset?: number; after?: ConversationCursor },
  ) {
    const source = this.conversationSource(accountId, filter)
    if (!source) return { items: [], total: 0 }
    const params = [...source.params]
    let keyset = ''
    if (page.after) {
      const r = time(page.after.receivedAt)
      keyset = 'WHERE r < ? OR (r = ? AND t > ?)'
      params.push(r, r, page.after.threadId)
    }
    params.push(Math.max(0, Math.floor(page.limit)))
    params.push(page.after ? 0 : Math.max(0, Math.floor(page.offset ?? 0)))
    const row = this.get<{ total: number; page: string }>(
      `WITH g AS MATERIALIZED (${source.sql})
        SELECT (SELECT count(*) FROM g) AS total,
          (SELECT json_group_array(json_array(t, s) ORDER BY r DESC, t) FROM (
            SELECT t, r, s FROM g ${keyset} ORDER BY r DESC, t LIMIT ? OFFSET ?)) AS page`,
      ...params,
    )!
    const picked = JSON.parse(row.page) as [string, number][]
    if (!picked.length) return { items: [], total: row.total }
    const latest = new Map(
      this.all<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE seq IN (SELECT value FROM json_each(?))`,
        list(picked.map(([, seq]) => seq)),
      ).map((message) => [message.seq, toMessage(message)]),
    )
    const counts = new Map(
      this.all<{ thread_id: string; n: number }>(
        `SELECT thread_id, count(*) AS n FROM messages WHERE account_id = ?
          AND thread_id IN (SELECT value FROM json_each(?)) GROUP BY thread_id`,
        accountId,
        list(picked.map(([thread]) => thread)),
      ).map((count) => [count.thread_id, count.n]),
    )
    const items: ConversationRow[] = picked.map(([threadId, seq]) => ({
      threadId,
      latest: latest.get(seq)!,
      count: counts.get(threadId) ?? 1,
    }))
    return { items, total: row.total }
  }

  /** `EXPLAIN QUERY PLAN` details for a conversation filter; used to keep queries indexed. */
  explainConversations(accountId: string, filter: ConversationFilter) {
    const source = this.conversationSource(accountId, filter)
    if (!source) return []
    return this.all<{ detail: string }>('EXPLAIN QUERY PLAN ' + source.sql, ...source.params).map(
      (row) => row.detail,
    )
  }

  counts(accountId: string) {
    const row = this.get<{ n: number }>(
      'SELECT count(*) AS n FROM messages WHERE account_id = ?',
      accountId,
    )
    return { messages: row?.n ?? 0 }
  }

  getMeta(accountId: string, key: string) {
    return this.get<{ value: string }>(
      'SELECT value FROM meta WHERE account_id = ? AND key = ?',
      accountId,
      key,
    )?.value
  }

  setMeta(accountId: string, key: string, value: string | undefined) {
    if (value === undefined)
      this.run('DELETE FROM meta WHERE account_id = ? AND key = ?', accountId, key)
    else
      this.run(
        `INSERT INTO meta (account_id, key, value) VALUES (?, ?, ?)
          ON CONFLICT DO UPDATE SET value = excluded.value`,
        accountId,
        key,
        value,
      )
  }
}

/** Wraps a synchronous index in the async interface, for tests and in-process use. */
export function asyncIndex(index: SyncMetadataIndex): MetadataIndex {
  const wrapped: Partial<Record<keyof MetadataIndex, unknown>> = {}
  for (const method of indexMethods)
    wrapped[method] = (...args: unknown[]) => {
      try {
        return Promise.resolve((index[method] as (...values: unknown[]) => unknown)(...args))
      } catch (error) {
        return Promise.reject(error)
      }
    }
  return wrapped as MetadataIndex
}

export function openInProcessIndex(path: string): MetadataIndex {
  return asyncIndex(new SqliteMetadataIndex(path))
}
