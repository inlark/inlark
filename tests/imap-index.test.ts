import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import {
  SqliteMetadataIndex,
  asyncIndex,
  openInProcessIndex,
} from '../apps/desktop/src/main/imap-index/sqlite-index'
import { WorkerMetadataIndex, type IndexPort } from '../apps/desktop/src/main/imap-index/client'
import type { FolderListing, IndexedMessage, MetadataIndex, NewMessage } from '@inlark/imap'

let directory: string
let path: string
let index: MetadataIndex

const folder = (path: string, extra: Partial<FolderListing> = {}): FolderListing => ({
  path,
  name: path.split('/').at(-1)!,
  delimiter: '/',
  parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null,
  specialUse: null,
  guessedSpecialUse: null,
  noSelect: false,
  ...extra,
})

const day = (n: number) => new Date(Date.UTC(2024, 0, 1) + n * 3600_000).toISOString()

function message(mailboxId: string, uid: number, extra: Partial<NewMessage> = {}): NewMessage {
  return {
    mailboxId,
    uidValidity: '1',
    uid,
    messageId: 'm' + uid + '@example.com',
    inReplyTo: [],
    references: [],
    subject: 'Subject ' + uid,
    from: [{ name: 'Ada', email: 'ada@example.com' }],
    to: [{ name: '', email: 'me@example.com' }],
    cc: [],
    bcc: [],
    replyTo: [],
    receivedAt: day(uid),
    size: 1000 + uid,
    flags: [],
    hasAttachment: false,
    preview: 'Preview ' + uid,
    ...extra,
  }
}

async function mailboxes(accountId = 'a', paths = ['INBOX', 'Archive', 'Sent', 'Junk']) {
  const list = await index.syncMailboxes(
    accountId,
    paths.map((path) => folder(path)),
  )
  return Object.fromEntries(list.map((mailbox) => [mailbox.path, mailbox.id]))
}

async function one(accountId: string, id: string) {
  const [found] = await index.messages(accountId, [id])
  return found!
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-index-'))
  path = join(directory, 'index', 'imap.sqlite')
  index = openInProcessIndex(path)
})
afterEach(async () => {
  await index.close()
  await rm(directory, { recursive: true, force: true })
})

describe('SQLite metadata index', () => {
  it('creates a private database and round-trips every stored field', async () => {
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory, 'index'))).mode & 0o777).toBe(0o700)
    const { INBOX } = await mailboxes()
    const input = message(INBOX!, 5, {
      modseq: '18446744073709551615',
      inReplyTo: ['parent@example.com'],
      references: ['root@example.com', 'parent@example.com'],
      cc: [{ name: 'Grace "G" Hopper', email: 'grace@example.com' }],
      replyTo: [{ name: 'List', email: 'list@example.com' }],
      sentAt: '2024-01-01T03:00:00.000Z',
      flags: ['\\Seen', '$Forwarded'],
      hasAttachment: true,
      bodyStructure: {
        type: 'multipart/mixed',
        childNodes: [
          { part: '1', type: 'text/plain', parameters: { charset: 'utf-8' }, size: 12 },
          {
            part: '2',
            type: 'application/pdf',
            disposition: 'attachment',
            dispositionParameters: { filename: 'ü.pdf' },
            encoding: 'base64',
            id: '<cid@x>',
          },
        ],
      },
      unsubscribe: { url: 'https://example.com/u', oneClick: true },
    })
    const [id] = await index.upsertMessages('a', [input])
    const stored = await one('a', id!)
    expect(stored).toEqual({ ...input, id, threadId: stored.threadId })
    // WAL and shared-memory files inherit the database's owner-only mode.
    for (const suffix of ['-wal', '-shm'])
      expect((await stat(path + suffix)).mode & 0o777).toBe(0o600)
  })

  it('keeps IDs and threads on re-upsert and refreshes only flags, modseq and preview', async () => {
    const { INBOX } = await mailboxes()
    const [id] = await index.upsertMessages('a', [message(INBOX!, 1, { modseq: '5' })])
    const before = await one('a', id!)
    const again = await index.upsertMessages('a', [
      message(INBOX!, 1, {
        modseq: '9',
        flags: ['\\Flagged'],
        preview: '',
        subject: 'Changed',
        messageId: 'other@example.com',
      }),
    ])
    expect(again).toEqual([id])
    const after = await one('a', id!)
    expect(after).toMatchObject({
      threadId: before.threadId,
      modseq: '9',
      flags: ['\\Flagged'],
      preview: 'Preview 1',
      subject: 'Subject 1',
    })
    await index.upsertMessages('a', [message(INBOX!, 1, { preview: 'Fresh' })])
    expect((await one('a', id!)).preview).toBe('Fresh')
    await index.setPreview('a', id!, 'Set')
    expect((await one('a', id!)).preview).toBe('Set')
    expect(await index.counts('a')).toEqual({ messages: 1 })
  })

  it('relocates an ID after a confirmed move and keeps its thread', async () => {
    const { INBOX, Archive } = await mailboxes()
    const [root, reply] = await index.upsertMessages('a', [
      message(INBOX!, 1),
      message(INBOX!, 2, { inReplyTo: ['m1@example.com'] }),
    ])
    const thread = (await one('a', root!)).threadId
    await index.updateMailbox('a', Archive!, { uidValidity: '7' })
    await index.relocate('a', reply!, { mailboxId: Archive!, uidValidity: '7', uid: 40 })
    expect(await one('a', reply!)).toMatchObject({ mailboxId: Archive, uid: 40, threadId: thread })
    expect(await index.knownUids('a', INBOX!)).toEqual([1])
    expect((await index.messagesAt('a', Archive!, [40])).map((m) => m.id)).toEqual([reply])
    await expect(
      index.relocate('a', reply!, { mailboxId: Archive!, uidValidity: '8', uid: 41 }),
    ).rejects.toThrow(/stale UIDVALIDITY/)
    await expect(
      index.relocate('a', 'missing', { mailboxId: Archive!, uidValidity: '7', uid: 41 }),
    ).rejects.toThrow(/Unknown message/)
  })

  it('invalidates stale locations after a UIDVALIDITY change', async () => {
    const { INBOX, Archive } = await mailboxes()
    await index.updateMailbox('a', INBOX!, {
      uidValidity: '1',
      uidNext: 4,
      highestModseq: '9',
      indexedFrom: 1,
      complete: true,
      total: 3,
    })
    await index.upsertMessages('a', [
      message(INBOX!, 1),
      message(INBOX!, 2),
      message(Archive!, 3, { inReplyTo: ['m1@example.com'] }),
    ])
    await expect(index.updateMailbox('a', INBOX!, { uidValidity: '2' })).rejects.toThrow(
      /reset the mailbox/,
    )
    await expect(
      index.upsertMessages('a', [message(INBOX!, 9, { uidValidity: '2' })]),
    ).rejects.toThrow(/stale UIDVALIDITY/)
    await index.resetMailbox('a', INBOX!, '2')
    expect(await index.messagesAt('a', INBOX!, [1, 2])).toEqual([])
    expect(await index.knownUids('a', INBOX!)).toEqual([])
    expect(await index.knownUids('a', Archive!)).toEqual([3])
    const inbox = (await index.listMailboxes('a')).find((m) => m.id === INBOX)!
    expect(inbox).toMatchObject({
      uidValidity: '2',
      uidNext: null,
      highestModseq: null,
      indexedFrom: null,
      complete: false,
    })
    await expect(index.upsertMessages('a', [message(INBOX!, 1)])).rejects.toThrow(/stale/)
    const [fresh] = await index.upsertMessages('a', [message(INBOX!, 1, { uidValidity: '2' })])
    // The re-indexed message rejoins the conversation its reply already belongs to.
    const archived = (await index.messagesAt('a', Archive!, [3]))[0]!
    expect((await one('a', fresh!)).threadId).toBe(archived.threadId)
  })

  it('threads by References and In-Reply-To, never by subject or missing IDs', async () => {
    const { INBOX, Sent } = await mailboxes()
    const ids = await index.upsertMessages('a', [
      message(INBOX!, 1, { messageId: '<root@x>' }),
      message(INBOX!, 2, { messageId: 'r1@x', references: ['<root@x>'] }),
      message(INBOX!, 3, { messageId: 'r2@x', references: ['root@x', 'r1@x'] }),
      message(Sent!, 4, { messageId: 'r3@x', inReplyTo: ['r2@x'] }),
      message(INBOX!, 5, { messageId: 'lonely@x', subject: 'Subject 1' }),
      message(INBOX!, 6, { messageId: null, subject: 'Same' }),
      message(INBOX!, 7, { messageId: null, subject: 'Same' }),
      message(INBOX!, 8, { messageId: 'same-a@x', subject: 'Same' }),
      message(INBOX!, 9, { messageId: 'same-b@x', subject: 'Same' }),
    ])
    const threads = await Promise.all(ids.map(async (id) => (await one('a', id)).threadId))
    expect(new Set(threads.slice(0, 4)).size).toBe(1)
    expect(new Set(threads).size).toBe(6)
    expect((await one('a', ids[0]!)).messageId).toBe('root@x')
    // The same Message-ID in two folders (Sent and Inbox) is one conversation.
    const [copy] = await index.upsertMessages('a', [message(Sent!, 10, { messageId: 'r1@x' })])
    expect((await one('a', copy!)).threadId).toBe(threads[0])
    expect((await index.findByMessageId('a', '<r1@x>')).map((m) => m.id).sort()).toEqual(
      [ids[1], copy].sort(),
    )
    expect((await index.findByMessageId('a', 'r1@x', Sent!)).map((m) => m.id)).toEqual([copy])
    expect(
      (await index.threadMessages('a', [threads[0]!])).map((m: IndexedMessage) => m.uid),
    ).toEqual([1, 2, 3, 4, 10])
  })

  it('merges conversations when a newly indexed message links them and keeps old IDs', async () => {
    const { INBOX } = await mailboxes()
    // Only the reply to a missing parent, and a separate thread, are known at first.
    const [c, d] = await index.upsertMessages('a', [
      message(INBOX!, 3, { messageId: 'c@x', inReplyTo: ['b@x'] }),
      message(INBOX!, 4, { messageId: 'd@x' }),
    ])
    const [e] = await index.upsertMessages('a', [message(INBOX!, 5, { messageId: 'e@x' })])
    const threadC = (await one('a', c!)).threadId
    const threadD = (await one('a', d!)).threadId
    const threadE = (await one('a', e!)).threadId
    expect(new Set([threadC, threadD, threadE]).size).toBe(3)
    // `d` turns out to answer `e`: thread E merges into the older D.
    const [e2] = await index.upsertMessages('a', [
      message(INBOX!, 6, { messageId: 'e2@x', references: ['e@x', 'd@x'] }),
    ])
    expect((await one('a', e2!)).threadId).toBe(threadD)
    expect(await index.resolveThread('a', threadE)).toBe(threadD)
    // A late ancestor references both remaining threads; D (and alias E) merge into C.
    const [b] = await index.upsertMessages('a', [
      message(INBOX!, 2, { messageId: 'b@x', references: ['d@x'] }),
    ])
    const all = await index.messages('a', [b!, c!, d!, e!, e2!])
    expect(new Set(all.map((m) => m.threadId))).toEqual(new Set([threadC]))
    for (const old of [threadC, threadD, threadE])
      expect(await index.resolveThread('a', old)).toBe(threadC)
    for (const old of [threadD, threadE])
      expect((await index.threadMessages('a', [old])).map((m) => m.uid)).toEqual([2, 3, 4, 5, 6])
    expect(await index.resolveThread('a', 'unknown')).toBe('unknown')
    const { items } = await index.conversations('a', {}, { limit: 10 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ threadId: threadC, count: 5 })
  })

  it('isolates accounts', async () => {
    const a = await mailboxes('a')
    const b = await mailboxes('b')
    const [ma] = await index.upsertMessages('a', [message(a.INBOX!, 1, { messageId: 'x@x' })])
    const [mb] = await index.upsertMessages('b', [
      message(b.INBOX!, 1, { messageId: 'y@x', references: ['x@x'] }),
    ])
    expect((await one('a', ma!)).threadId).not.toBe((await one('b', mb!)).threadId)
    expect(await index.messages('a', [mb!])).toEqual([])
    expect(await index.findByMessageId('b', 'x@x')).toEqual([])
    expect(await index.threadMessages('a', [(await one('b', mb!)).threadId])).toEqual([])
    expect(
      (await index.conversations('a', {}, { limit: 10 })).items.map((i) => i.latest.id),
    ).toEqual([ma])
    expect((await index.conversations('a', { mailboxIds: [b.INBOX!] }, { limit: 10 })).total).toBe(
      0,
    )
    await expect(index.upsertMessages('a', [message(b.INBOX!, 2)])).rejects.toThrow(
      /Unknown mailbox/,
    )
    await expect(
      index.relocate('a', mb!, { mailboxId: a.Archive!, uidValidity: '1', uid: 9 }),
    ).rejects.toThrow(/Unknown message/)
    await index.removeMessages('a', [mb!])
    await index.removeUids('a', b.INBOX!, [1])
    expect(await index.counts('b')).toEqual({ messages: 1 })
    await index.setMeta('a', 'cursor', '1')
    expect(await index.getMeta('b', 'cursor')).toBeUndefined()
    expect(await index.listMailboxes('c')).toEqual([])
  })

  it('filters conversations and represents each by its newest matching message', async () => {
    const { INBOX, Archive, Junk } = await mailboxes()
    await index.upsertMessages('a', [
      message(INBOX!, 1, { messageId: 't1a', flags: ['\\Seen'] }),
      message(Archive!, 2, {
        messageId: 't1b',
        inReplyTo: ['t1a'],
        flags: ['\\Seen', '\\Flagged'],
      }),
      message(INBOX!, 3, { messageId: 't1c', inReplyTo: ['t1b'], flags: ['\\Seen'] }),
      message(INBOX!, 4, { messageId: 't2a', hasAttachment: true }),
      message(Junk!, 5, { messageId: 't3a', flags: ['\\Seen'] }),
      message(Archive!, 6, { messageId: 't4a', flags: ['\\seen'] }),
    ])
    const uids = async (filter: Parameters<MetadataIndex['conversations']>[1]) => {
      const result = await index.conversations('a', filter, { limit: 50 })
      return { uids: result.items.map((item) => item.latest.uid), total: result.total }
    }
    expect(await uids({})).toEqual({ uids: [6, 5, 4, 3], total: 4 })
    expect(await uids({ mailboxIds: [INBOX!] })).toEqual({ uids: [4, 3], total: 2 })
    expect(await uids({ mailboxIds: [Archive!] })).toEqual({ uids: [6, 2], total: 2 })
    expect(await uids({ mailboxIds: [Archive!, Junk!] })).toEqual({ uids: [6, 5, 2], total: 3 })
    expect(await uids({ mailboxIds: [] })).toEqual({ uids: [], total: 0 })
    expect(await uids({ excludeMailboxIds: [Junk!] })).toEqual({ uids: [6, 4, 3], total: 3 })
    expect(await uids({ excludeMailboxIds: [Junk!, INBOX!] })).toEqual({ uids: [6, 2], total: 2 })
    expect(await uids({ flagged: true })).toEqual({ uids: [2], total: 1 })
    expect(await uids({ unseen: true })).toEqual({ uids: [4], total: 1 })
    expect(await uids({ unseen: false, mailboxIds: [INBOX!] })).toEqual({ uids: [3], total: 1 })
    expect(await uids({ hasAttachment: true })).toEqual({ uids: [4], total: 1 })
    expect(await uids({ after: day(2), before: day(5) })).toEqual({ uids: [4, 3], total: 2 })
    expect(await uids({ before: day(3) })).toEqual({ uids: [2], total: 1 })
    const ids = (await index.messagesAt('a', INBOX!, [1, 4])).map((m) => m.id)
    expect(await uids({ ids })).toEqual({ uids: [4, 1], total: 2 })
    expect(await uids({ ids: [] })).toEqual({ uids: [], total: 0 })
    const first = (await index.conversations('a', { mailboxIds: [INBOX!] }, { limit: 50 })).items
    expect(first.map((item) => item.count)).toEqual([1, 3])
    expect(first[1]!.latest.mailboxId).toBe(INBOX)
    const offset = await index.conversations('a', {}, { limit: 2, offset: 1 })
    expect(offset.items.map((i) => i.latest.uid)).toEqual([5, 4])
    expect(offset.total).toBe(4)
  })

  it('pages with a keyset that ignores rows indexed between pages', async () => {
    const { INBOX } = await mailboxes()
    const batch: NewMessage[] = []
    for (let uid = 1; uid <= 60; uid++)
      // Pairs share a timestamp so the thread ID tie-break is exercised.
      batch.push(
        message(INBOX!, uid, {
          receivedAt: day(1000 + Math.floor(uid / 2)),
          inReplyTo: uid % 3 === 0 ? ['m' + (uid - 1) + '@example.com'] : [],
        }),
      )
    await index.upsertMessages('a', batch)
    const existing = (await index.conversations('a', {}, { limit: 1000 })).items.map(
      (i) => i.threadId,
    )
    const seen: string[] = []
    let after: { receivedAt: string; threadId: string } | undefined
    let uid = 100
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await index.conversations('a', {}, { limit: 7, after })
      if (!page.items.length) break
      seen.push(...page.items.map((i) => i.threadId))
      const last = page.items.at(-1)!
      after = { receivedAt: last.latest.receivedAt, threadId: last.threadId }
      // Newer and older new conversations, and an older reply into an already shown one.
      await index.upsertMessages('a', [
        message(INBOX!, uid++, { receivedAt: day(5000 + uid) }),
        message(INBOX!, uid++, { receivedAt: day(uid) }),
        message(INBOX!, uid++, {
          receivedAt: last.latest.receivedAt,
          inReplyTo: [last.latest.messageId!],
        }),
      ])
    }
    expect(new Set(seen).size).toBe(seen.length)
    for (const thread of existing) expect(seen).toContain(thread)
  })

  it('reconciles mailbox listings and renames', async () => {
    const first = await mailboxes('a', ['INBOX', 'Work', 'Work/2023', 'Old'])
    await index.upsertMessages('a', [message(first.Old!, 1), message(first['Work/2023']!, 2)])
    await index.updateMailbox('a', first.INBOX!, { total: 10, unread: 2, uidNext: 50 })
    const second = await index.syncMailboxes('a', [
      folder('INBOX', { specialUse: null, name: 'Inbox' }),
      folder('Work'),
      folder('Work/2023'),
      folder('Sent', { specialUse: '\\Sent', guessedSpecialUse: '\\Sent', noSelect: false }),
    ])
    const byPath = Object.fromEntries(second.map((m) => [m.path, m]))
    expect(second.map((m) => m.path)).toEqual(['INBOX', 'Work', 'Work/2023', 'Sent'])
    expect(byPath.INBOX).toMatchObject({ id: first.INBOX, name: 'Inbox', total: 10, uidNext: 50 })
    expect(byPath.Sent).toMatchObject({ specialUse: '\\Sent', uidValidity: null, complete: false })
    expect(Object.values(first)).not.toContain(byPath.Sent!.id)
    expect(await index.counts('a')).toEqual({ messages: 1 })
    await index.renameMailbox('a', first.Work!, 'Projects', 'Projects')
    const renamed = Object.fromEntries((await index.listMailboxes('a')).map((m) => [m.id, m]))
    expect(renamed[first.Work!]).toMatchObject({ path: 'Projects', parentPath: null })
    expect(renamed[first['Work/2023']!]).toMatchObject({
      path: 'Projects/2023',
      parentPath: 'Projects',
    })
    expect(await index.knownUids('a', first['Work/2023']!)).toEqual([2])
    await expect(index.renameMailbox('a', first.Work!, 'INBOX', 'INBOX')).rejects.toThrow(
      /already uses/,
    )
  })

  it('removes messages by UID and ID and stores metadata', async () => {
    const { INBOX } = await mailboxes()
    const ids = await index.upsertMessages(
      'a',
      [5, 3, 9, 7].map((uid) => message(INBOX!, uid)),
    )
    expect(await index.knownUids('a', INBOX!)).toEqual([3, 5, 7, 9])
    await index.removeUids('a', INBOX!, [3, 4])
    await index.removeMessages('a', [ids[2]!])
    expect(await index.knownUids('a', INBOX!)).toEqual([5, 7])
    await index.updateFlags('a', INBOX!, [{ uid: 7, flags: ['\\Seen'], modseq: '12' }])
    expect((await index.messagesAt('a', INBOX!, [7]))[0]).toMatchObject({
      flags: ['\\Seen'],
      modseq: '12',
    })
    expect((await index.conversations('a', { unseen: true }, { limit: 5 })).total).toBe(1)
    await index.setMeta('a', 'k', 'one')
    await index.setMeta('a', 'k', 'two')
    expect(await index.getMeta('a', 'k')).toBe('two')
    await index.setMeta('a', 'k', undefined)
    expect(await index.getMeta('a', 'k')).toBeUndefined()
  })

  it('persists across reopening and fails closed on a newer schema', async () => {
    const { INBOX } = await mailboxes()
    const [id] = await index.upsertMessages('a', [message(INBOX!, 1)])
    await index.setMeta('a', 'state', 's1')
    await index.close()
    index = openInProcessIndex(path)
    expect(await index.getMeta('a', 'state')).toBe('s1')
    expect((await one('a', id!)).uid).toBe(1)
    const future = join(directory, 'future.sqlite')
    const db = new DatabaseSync(future)
    db.exec('CREATE TABLE unknown (x); PRAGMA user_version = 99')
    db.close()
    const bytes = await readFile(future)
    expect(() => new SqliteMetadataIndex(future)).toThrow(/newer version/)
    expect(await readFile(future)).toEqual(bytes)
  })

  it('answers conversation pages quickly on a large mailbox', async () => {
    const sync = new SqliteMetadataIndex(join(directory, 'large.sqlite'))
    const [inbox, archive] = sync.syncMailboxes('a', [folder('INBOX'), folder('Archive')])
    const started = performance.now()
    for (let start = 0; start < 50_000; start += 500) {
      const batch: NewMessage[] = []
      for (let uid = start + 1; uid <= start + 500; uid++)
        batch.push(
          message(uid % 10 === 0 ? archive!.id : inbox!.id, uid, {
            references: uid % 5 ? ['m' + (uid - (uid % 5)) + '@example.com'] : [],
            flags: uid % 7 ? ['\\Seen'] : [],
          }),
        )
      sync.upsertMessages('a', batch)
    }
    const built = performance.now()
    const page = sync.conversations('a', { mailboxIds: [inbox!.id] }, { limit: 50 })
    const next = sync.conversations(
      'a',
      { mailboxIds: [inbox!.id] },
      {
        limit: 50,
        after: {
          receivedAt: page.items.at(-1)!.latest.receivedAt,
          threadId: page.items.at(-1)!.threadId,
        },
      },
    )
    const unread = sync.conversations('a', { unseen: true }, { limit: 50 })
    const done = performance.now()
    expect(page.items).toHaveLength(50)
    expect(page.total).toBe(10_000)
    expect(next.items[0]!.latest.receivedAt < page.items.at(-1)!.latest.receivedAt).toBe(true)
    expect(unread.items).toHaveLength(50)
    const ids = sync.messagesAt(
      'a',
      inbox!.id,
      Array.from({ length: 3000 }, (_, i) => i * 3 + 1),
    )
    const searched = sync.conversations('a', { ids: ids.map((m) => m.id) }, { limit: 50 })
    expect(searched.items).toHaveLength(50)
    // Generous bounds keep CI stable; typical runs are several times faster.
    expect(built - started).toBeLessThan(10_000)
    expect(done - built).toBeLessThan(1_500)
    for (const filter of [
      { mailboxIds: [inbox!.id] },
      { mailboxIds: [inbox!.id, archive!.id] },
      { ids: ['x', 'y'] },
      { unseen: true },
      { flagged: true },
      {},
    ])
      for (const detail of sync.explainConversations('a', filter))
        expect(detail).not.toMatch(/^SCAN m\b/)
    sync.close()
  }, 60_000)
})

describe('worker metadata index client', () => {
  function fakePort(target: SqliteMetadataIndex) {
    const listeners: Record<string, ((value: never) => void)[]> = {}
    let terminated = false
    const emit = (event: string, value: unknown) =>
      listeners[event]?.forEach((listener) => listener(value as never))
    const port: IndexPort & { emit: typeof emit; hold: boolean; held: unknown[] } = {
      hold: false,
      held: [],
      emit,
      on(event: string, listener: (value: never) => void) {
        ;(listeners[event] ??= []).push(listener)
        return port
      },
      postMessage(value) {
        if (port.hold) return void port.held.push(value)
        // Structured cloning mirrors what crosses a real worker boundary.
        const { id, method, args } = structuredClone(value) as {
          id: number
          method: keyof SqliteMetadataIndex
          args: unknown[]
        }
        queueMicrotask(() => {
          try {
            const result = (target[method] as (...values: unknown[]) => unknown)(...args)
            emit('message', structuredClone({ id, result }))
          } catch (error) {
            emit('message', { id, error: { message: (error as Error).message } })
          }
        })
      },
      async terminate() {
        terminated = true
        emit('exit', 1)
        return 1
      },
    }
    return { port, terminated: () => terminated }
  }

  it('round-trips results and errors and closes the database', async () => {
    const target = new SqliteMetadataIndex(join(directory, 'rpc.sqlite'))
    const { port, terminated } = fakePort(target)
    const client = new WorkerMetadataIndex(port)
    const [inbox] = await client.syncMailboxes('a', [folder('INBOX')])
    const [id] = await client.upsertMessages('a', [message(inbox!.id, 1)])
    expect((await client.messages('a', [id!]))[0]).toMatchObject({ id, uid: 1 })
    await expect(client.updateMailbox('a', 'nope', {})).rejects.toThrow(/Unknown mailbox/)
    await client.close()
    expect(terminated()).toBe(true)
    await expect(client.counts('a')).rejects.toThrow(/closed/)
    expect(() => target.counts('a')).toThrow()
  })

  it('rejects pending calls when the worker exits or fails', async () => {
    const target = new SqliteMetadataIndex(join(directory, 'rpc.sqlite'))
    const { port } = fakePort(target)
    const client = new WorkerMetadataIndex(port)
    port.hold = true
    const pending = client.counts('a')
    port.emit('exit', 3)
    await expect(pending).rejects.toThrow(/stopped unexpectedly \(exit code 3\)/)
    await expect(client.getMeta('a', 'k')).rejects.toThrow(/stopped unexpectedly/)
    await client.close()
    const second = fakePort(target)
    const other = new WorkerMetadataIndex(second.port)
    second.port.hold = true
    const waiting = other.counts('a')
    second.port.emit('error', new Error('disk I/O error'))
    await expect(waiting).rejects.toThrow('disk I/O error')
    target.close()
  })

  it('runs the real worker entry in a worker thread', async () => {
    // Node strips the TypeScript types itself; the hook adds the extension the bundler would.
    const entry = fileURLToPath(
      new URL('../apps/desktop/src/main/imap-index/worker.ts', import.meta.url),
    )
    const shim = `
      const { registerHooks } = require('node:module')
      registerHooks({ resolve(specifier, context, next) {
        if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) specifier += '.ts'
        return next(specifier, context)
      } })
      import(${JSON.stringify(pathToFileURL(entry).href)})`
    const spawn = (file: string) =>
      new WorkerMetadataIndex(new Worker(shim, { eval: true, workerData: { path: file } }))
    const worker = spawn(join(directory, 'worker', 'real.sqlite'))
    const [inbox] = await worker.syncMailboxes('a', [folder('INBOX')])
    const [id] = await worker.upsertMessages('a', [message(inbox!.id, 1)])
    expect((await worker.conversations('a', {}, { limit: 5 })).items[0]!.latest.id).toBe(id)
    await expect(
      worker.relocate('a', 'nope', { mailboxId: inbox!.id, uidValidity: '1', uid: 2 }),
    ).rejects.toThrow(/Unknown message/)
    await worker.close()
    await expect(worker.counts('a')).rejects.toThrow(/closed/)
    const future = join(directory, 'future.sqlite')
    const db = new DatabaseSync(future)
    db.exec('PRAGMA user_version = 99')
    db.close()
    const failing = spawn(future)
    await expect(failing.counts('a')).rejects.toThrow(/newer version/)
    await failing.close()
    // Reopening in-process sees what the worker wrote.
    const reopened = asyncIndex(new SqliteMetadataIndex(join(directory, 'worker', 'real.sqlite')))
    expect(await reopened.counts('a')).toEqual({ messages: 1 })
    await reopened.close()
  })
})
