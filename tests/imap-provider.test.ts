import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderError, type Account, type ImapConnectionConfig } from '../packages/core/src'
import { ImapProvider, limitsFor, imapFlowOptions, ImapFlowPort } from '../packages/imap/src'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import { FakeImapServer } from './support/fake-imap'

const config: ImapConnectionConfig = {
  protocol: 'imap',
  email: 'me@example.com',
  incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: 'me' },
  outgoing: { host: 'smtp.example.com', port: 465, security: 'tls', username: 'me' },
  outgoingSameCredentials: true,
}
const me = { name: 'Me', email: 'me@example.com' }
const alex = { name: 'Alex', email: 'alex@example.org' }
let directory: string
let server: FakeImapServer
let providers: ImapProvider[] = []
let account: Account

function provider(options: Partial<ConstructorParameters<typeof ImapProvider>[0]> = {}) {
  const p = new ImapProvider({
    connectionId: 'c1',
    name: 'Work',
    config,
    password: 'disposable',
    index: openInProcessIndex(join(directory, 'index-' + providers.length + '.sqlite')),
    readAttachment: async () => new TextEncoder().encode('attached'),
    background: false,
    ports: server.port,
    timing: { sentCopyGraceMs: 0, initialBatch: 5, historicalBatch: 5, previews: 0 },
    ...options,
  })
  providers.push(p)
  return p
}
async function connected(options: Parameters<typeof provider>[0] = {}) {
  const p = provider(options)
  ;[account] = await p.connect()
  return p
}
/** Runs the provider's background synchronization once, as the loop would. */
const sync = (p: ImapProvider) => (p as any).syncPass('all') as Promise<void>
const historical = async (p: ImapProvider) => {
  while (await (p as any).historicalBatch());
}
const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString()

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-imap-'))
  server = new FakeImapServer()
  providers = []
})
afterEach(async () => {
  for (const p of providers) await p.close()
  await rm(directory, { recursive: true, force: true })
})

describe('IMAP connection and folders', () => {
  it('uses server-declared special folders and marks name guesses for review', async () => {
    server.boxes.delete('Archive')
    server.addMailbox('Archives', null, '\\Archive')
    const p = await connected()
    const review = await p.folderMappings()
    expect(review.mappings.sent).toEqual({ path: 'Sent', source: 'server' })
    expect(review.mappings.archive).toEqual({ path: 'Archives', source: 'name' })
    const boxes = await p.mailboxes(account)
    expect(boxes.find((b) => b.name === 'Inbox')?.role).toBe('inbox')
    expect(boxes.find((b) => b.name === 'Sent')?.role).toBe('sent')
  })
  it('lets the user choose or create a missing folder, and that choice wins', async () => {
    server.boxes.delete('Archive')
    const p = await connected()
    expect((await p.folderMappings()).mappings.archive).toBeUndefined()
    const review = await p.setFolderMappings(account, {
      archive: { path: 'Old mail', create: true },
      junk: null,
    })
    expect(server.boxes.has('Old mail')).toBe(true)
    expect(review.mappings.archive).toEqual({ path: 'Old mail', source: 'user' })
    expect(review.mappings.junk).toBeNull()
    expect((await p.mailboxes(account)).find((b) => b.name === 'Junk')?.role).toBeNull()
  })
  it('creates a missing folder where the server keeps its folders', async () => {
    for (const path of ['Sent', 'Drafts', 'Trash', 'Archive', 'Junk']) server.boxes.delete(path)
    server.addMailbox('INBOX/Sent', '\\Sent')
    const p = await connected()
    const review = await p.setFolderMappings(account, {
      archive: { path: 'Archive', create: true },
    })
    expect(review.mappings.archive).toEqual({ path: 'INBOX/Archive', source: 'user' })
    expect(server.boxes.has('INBOX/Archive')).toBe(true)
    expect(server.boxes.has('Archive')).toBe(false)
  })
  it('reports incoming authentication failures without trying anything else', async () => {
    const p = provider({ password: 'wrong' })
    await expect(p.connect()).rejects.toMatchObject({ code: 'authentication' })
    expect(server.commands).toEqual([])
  })
  it('explains and disables unsafe actions when capabilities are missing', () => {
    expect(limitsFor(new Set(['MOVE', 'UIDPLUS']))).toEqual({})
    expect(limitsFor(new Set(['MOVE'])).destroy).toContain('UIDPLUS')
    expect(limitsFor(new Set(['MOVE'])).move).toBeUndefined()
    expect(limitsFor(new Set([])).move).toContain('MOVE nor UIDPLUS')
  })
})

describe('IMAP TLS policy', () => {
  it('verifies certificates and never falls back to plaintext', () => {
    const tls = imapFlowOptions({ ...config.incoming, password: 'x' }, 'command')
    expect(tls).toMatchObject({
      secure: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    })
    const starttls = imapFlowOptions(
      { ...config.incoming, port: 143, security: 'starttls', password: 'x' },
      'idle',
    )
    expect(starttls).toMatchObject({
      secure: false,
      doSTARTTLS: true,
      tls: { rejectUnauthorized: true },
    })
    expect(starttls.servername).toBe('imap.example.com')
    expect(
      imapFlowOptions({ ...config.incoming, host: '127.0.0.1', password: 'x' }, 'command')
        .servername,
    ).toBeUndefined()
  })
  it('refuses a mailbox-wide EXPUNGE and a MOVE emulation in the adapter itself', async () => {
    const port = new ImapFlowPort({ ...config.incoming, password: 'x' }, 'command')
    ;(port as any).client.capabilities = new Map([['IMAP4rev1', true]])
    const expunge = vi.spyOn((port as any).client, 'messageDelete')
    const move = vi.spyOn((port as any).client, 'messageMove')
    expect(() => port.expunge([1])).toThrow(ProviderError)
    expect(() => port.move([1], 'Archive')).toThrow(ProviderError)
    expect(expunge).not.toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()
  })
})

describe('IMAP indexing and reading', () => {
  it('indexes recent Inbox mail first and reports incomplete results until history is indexed', async () => {
    for (let i = 0; i < 12; i++)
      server.deliver('INBOX', {
        messageId: 'm' + i + '@x',
        subject: 'Message ' + i,
        from: [alex],
        date: at(i),
      })
    const p = await connected()
    const events: any[] = []
    p.subscribe((e) => events.push(e))
    await sync(p)
    let page = await p.query(account, { view: 'inbox' })
    expect(page.items.map((c) => c.subject)).toEqual([
      'Message 11',
      'Message 10',
      'Message 9',
      'Message 8',
      'Message 7',
    ])
    expect(page.incomplete).toBe(true)
    expect(events.find((e) => e.type === 'indexing').indexing).toMatchObject({
      indexed: 5,
      total: 12,
      complete: false,
    })
    await historical(p)
    // Historical indexing never looks like new mail.
    expect(events.filter((e) => e.type === 'changed' && !e.historical)).toHaveLength(1)
    expect(events.filter((e) => e.type === 'changed' && e.historical).length).toBeGreaterThan(0)
    page = await p.query(account, { view: 'inbox' })
    expect(page.total).toBe(12)
    expect(page.incomplete).toBeUndefined()
    expect(events.at(-1).indexing).toMatchObject({ indexed: 12, total: 12, complete: true })
  })
  it('paginates without duplicates while older mail is still being indexed', async () => {
    for (let i = 0; i < 12; i++)
      server.deliver('INBOX', { messageId: 'm' + i + '@x', subject: 'M' + i, date: at(i) })
    const p = await connected()
    await sync(p)
    const first = await p.query(account, { view: 'inbox' }, 0, 3)
    await historical(p)
    const second = await p.query(account, { view: 'inbox' }, first.next!, 3)
    const seen = [...first.items, ...second.items].map((c) => c.subject)
    expect(new Set(seen).size).toBe(6)
    expect(seen).toEqual(['M11', 'M10', 'M9', 'M8', 'M7', 'M6'])
  })
  it('groups a conversation across folders by Message-ID and References, never by subject alone', async () => {
    server.deliver('INBOX', {
      messageId: 'root@x',
      subject: 'Plans',
      from: [alex],
      date: at(1),
      text: 'Shall we?',
    })
    server.deliver('Sent', {
      messageId: 'reply@x',
      inReplyTo: 'root@x',
      references: ['root@x'],
      subject: 'Re: Plans',
      from: [me],
      date: at(2),
      text: 'Yes.',
    })
    server.deliver('INBOX', { messageId: 'other@x', subject: 'Plans', from: [alex], date: at(3) })
    const p = await connected()
    await sync(p)
    const page = await p.query(account, { view: 'all' })
    const plans = page.items.find((c) => c.count === 2)!
    expect(plans.messages.map((m) => m.subject).sort()).toEqual(['Plans', 'Re: Plans'])
    expect(page.items).toHaveLength(2)
    const messages = await p.conversation(account, plans.id)
    expect(messages.map((m) => m.text?.trim())).toEqual(['Shall we?', 'Yes.'])
  })
  it('joins a reply indexed before its ancestor and keeps the old conversation ID working', async () => {
    const p = await connected()
    server.deliver('INBOX', {
      messageId: 'b@x',
      references: ['a@x'],
      inReplyTo: 'a@x',
      subject: 'Re: A',
      date: at(2),
    })
    server.deliver('INBOX', {
      messageId: 'c@x',
      references: ['z@x'],
      subject: 'Re: A',
      date: at(3),
    })
    await sync(p)
    const before = (await p.query(account, { view: 'inbox' })).items
    expect(before).toHaveLength(2)
    // The shared ancestor arrives (e.g. from a folder indexed later) and references both lines.
    server.deliver('Archive', { messageId: 'a@x', references: ['z@x'], subject: 'A', date: at(1) })
    await sync(p)
    const after = (await p.query(account, { view: 'all' })).items
    expect(after).toHaveLength(1)
    for (const old of before) expect((await p.conversation(account, old.id)).length).toBe(3)
  })
  it('discards stale locations after a UIDVALIDITY change and reindexes', async () => {
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    await sync(p)
    const [before] = (await p.query(account, { view: 'inbox' })).items
    server.resetUidValidity('INBOX')
    server.deliver('INBOX', { messageId: 'b@x', subject: 'B', date: at(2) })
    await sync(p)
    const after = await p.query(account, { view: 'inbox' })
    expect(after.items.map((c) => c.subject)).toEqual(['B', 'A'])
    expect(after.items.find((c) => c.subject === 'A')!.messages[0].id).not.toBe(
      before.messages[0].id,
    )
    expect(await p.messages(account, [before.messages[0].id])).toEqual([])
  })
  it('notices messages expunged by another client', async () => {
    const uid = server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    server.deliver('INBOX', { messageId: 'b@x', subject: 'B', date: at(2) })
    const p = await connected()
    await sync(p)
    server.remove('INBOX', uid)
    await sync(p)
    expect((await p.query(account, { view: 'inbox' })).items.map((c) => c.subject)).toEqual(['B'])
  })
  it('falls back to comparing flags when the server lacks CONDSTORE', async () => {
    server.capabilities.delete('CONDSTORE')
    const uid = server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    await sync(p)
    expect((await p.query(account, { view: 'inbox' })).items[0].unread).toBe(true)
    server.setFlags('INBOX', uid, ['\\Seen'])
    await sync(p)
    expect((await p.query(account, { view: 'inbox' })).items[0].unread).toBe(false)
  })
  it('searches on the server across folders and indexes matches it had not seen yet', async () => {
    for (let i = 0; i < 8; i++)
      server.deliver('Archive', { messageId: 'a' + i + '@x', subject: 'Old ' + i, date: at(i) })
    server.deliver('Archive', {
      messageId: 'needle@x',
      subject: 'Invoice',
      date: at(0),
      text: 'Needle inside',
      attachments: [{ name: 'invoice.pdf', type: 'application/pdf', content: 'pdf' }],
    })
    server.deliver('Junk', { messageId: 'spam@x', subject: 'Needle spam', date: at(9) })
    const p = await connected()
    await sync(p)
    const found = await p.query(account, { view: 'all', text: 'needle' })
    expect(found.items.map((c) => c.subject)).toEqual(['Invoice'])
    expect(found.items[0].hasAttachment).toBe(true)
    expect(
      (await p.query(account, { view: 'all', text: 'needle', hasAttachment: true })).items,
    ).toHaveLength(1)
    const [message] = await p.conversation(account, found.items[0].id)
    expect(message.attachments).toMatchObject([{ name: 'invoice.pdf', type: 'application/pdf' }])
    const bytes = await p.download(account, message.attachments![0])
    expect(new TextDecoder().decode(bytes)).toBe('pdf')
  })
  it('picks up new Inbox mail announced on the IDLE connection', async () => {
    const p = await connected({
      background: true,
      timing: { reconcileMs: 60_000, sentCopyGraceMs: 0, previews: 0 },
    })
    const changed = vi.fn()
    p.subscribe((e) => e.type === 'changed' && !e.historical && changed())
    await vi.waitFor(() => expect(server.ports.some((port) => port.purpose === 'idle')).toBe(true))
    await vi.waitFor(() => expect(server.commands).toContain('SEARCH'))
    server.deliver('INBOX', { messageId: 'new@x', subject: 'Fresh', date: at(5) })
    await vi.waitFor(async () =>
      expect((await p.query(account, { view: 'inbox' })).items.map((c) => c.subject)).toEqual([
        'Fresh',
      ]),
    )
    expect(changed).toHaveBeenCalled()
  })
  it('reconnects the command connection after it drops', async () => {
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    await sync(p)
    server.commandPorts[0].drop()
    expect(
      (
        await p.conversationMetadata(account, [
          (await p.query(account, { view: 'inbox' })).items[0].id,
        ])
      ).length,
    ).toBe(1)
    expect(server.commandPorts).toHaveLength(2)
  })
})

describe('IMAP organization', () => {
  async function inboxMessage(p: ImapProvider) {
    await sync(p)
    const [conversation] = (await p.query(account, { view: 'inbox' })).items
    return conversation.messages[0]
  }
  it('moves with MOVE and keeps the message ID through the confirmed move', async () => {
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    const message = await inboxMessage(p)
    const boxes = await p.mailboxes(account)
    const inbox = boxes.find((b) => b.role === 'inbox')!.id
    const archive = boxes.find((b) => b.role === 'archive')!.id
    const result = await p.update(account, {
      [message.id]: { mailboxes: { [inbox]: false, [archive]: true } },
    })
    expect(result).toEqual({ updated: [message.id], failures: [] })
    expect(server.box('Archive').messages).toHaveLength(1)
    const [moved] = await p.messages(account, [message.id])
    expect(moved.mailboxIds).toEqual({ [archive]: true })
  })
  it('finds a moved message by Message-ID when the server does not report new UIDs', async () => {
    server.capabilities.delete('UIDPLUS')
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    const message = await inboxMessage(p)
    const boxes = await p.mailboxes(account)
    const [inbox, archive] = ['inbox', 'archive'].map((r) => boxes.find((b) => b.role === r)!.id)
    await p.update(account, { [message.id]: { mailboxes: { [inbox]: false, [archive]: true } } })
    expect((await p.messages(account, [message.id]))[0].mailboxIds).toEqual({ [archive]: true })
  })
  it('emulates MOVE only with UID EXPUNGE, leaving other clients’ pending deletions alone', async () => {
    server.capabilities.delete('MOVE')
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    server.deliver('INBOX', {
      messageId: 'pending@x',
      subject: 'Pending',
      date: at(0),
      flags: ['\\Deleted'],
    })
    const p = await connected()
    await sync(p)
    const message = (await p.query(account, { view: 'inbox' })).items.find(
      (c) => c.subject === 'A',
    )!.messages[0]
    const boxes = await p.mailboxes(account)
    const [inbox, archive] = ['inbox', 'archive'].map((r) => boxes.find((b) => b.role === r)!.id)
    await p.update(account, { [message.id]: { mailboxes: { [inbox]: false, [archive]: true } } })
    expect(server.commands).toContain('COPY')
    expect(server.commands).toContain('UID EXPUNGE')
    expect(server.box('INBOX').messages.map((m) => m.input.subject)).toEqual(['Pending'])
  })
  it('refuses to move or permanently delete when that cannot be done safely', async () => {
    server.capabilities.delete('MOVE')
    server.capabilities.delete('UIDPLUS')
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    expect(account.limits?.move).toBeTruthy()
    const message = await inboxMessage(p)
    const boxes = await p.mailboxes(account)
    expect(boxes.every((b) => !b.rights.mayRemoveItems)).toBe(true)
    const [inbox, archive] = ['inbox', 'archive'].map((r) => boxes.find((b) => b.role === r)!.id)
    await expect(
      p.update(account, { [message.id]: { mailboxes: { [inbox]: false, [archive]: true } } }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(p.update(account, {}, [message.id])).rejects.toMatchObject({ code: 'unsupported' })
    expect(server.box('INBOX').messages).toHaveLength(1)
    expect(server.commands).not.toContain('COPY')
  })
  it('permanently deletes exactly the chosen messages', async () => {
    server.deliver('Trash', { messageId: 'a@x', subject: 'A', date: at(1) })
    server.deliver('Trash', { messageId: 'b@x', subject: 'B', date: at(2), flags: ['\\Deleted'] })
    const p = await connected()
    await sync(p)
    const a = (await p.query(account, { view: 'trash' })).items.find((c) => c.subject === 'A')!
      .messages[0]
    expect(await p.update(account, {}, [a.id])).toEqual({ updated: [a.id], failures: [] })
    expect(server.box('Trash').messages.map((m) => m.input.subject)).toEqual(['B'])
  })
  it('reads current flags before acting and reports a concurrent change as a failure', async () => {
    const uid = server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    const p = await connected()
    const message = await inboxMessage(p)
    // Another client flags the message between our read and our write.
    server.hooks.set('STORE:before', () => server.setFlags('INBOX', uid, ['\\Flagged']))
    const result = await p.update(account, { [message.id]: { keywords: { $seen: true } } })
    expect(result.failures).toEqual([message.id + ': changed on the server'])
    expect([...server.box('INBOX').messages[0].flags]).toEqual(['\\Flagged'])
    const [current] = await p.messages(account, [message.id])
    expect(current.keywords).toEqual({ $flagged: true })
  })
  it('refuses to delete a folder that still has messages', async () => {
    server.addMailbox('Projects')
    server.deliver('Projects', { messageId: 'p@x', subject: 'P', date: at(1) })
    const p = await connected()
    const id = (await p.mailboxes(account)).find((b) => b.name === 'Projects')!.id
    await expect(p.folder(account, 'delete', id)).rejects.toThrow('still contains messages')
    await p.folder(account, 'rename', id, 'Clients')
    expect(server.boxes.has('Clients')).toBe(true)
    expect((await p.mailboxes(account)).find((b) => b.name === 'Clients')?.id).toBe(id)
  })
})

describe('IMAP drafts and sending', () => {
  const draft = {
    id: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17',
    accountId: '',
    identityId: 'default',
    to: [alex],
    cc: [],
    bcc: [{ name: 'Secret', email: 'secret@example.net' }],
    subject: 'Grüße',
    html: '<p>Hallo</p>',
    text: 'Hallo',
    attachments: [],
    updatedAt: '2026-09-23T10:00:00.000Z',
    status: 'local' as const,
  }
  it('appends drafts with the Draft flag and confirms them before returning an ID', async () => {
    const p = await connected()
    const id = await p.createDraft(account, {
      ...draft,
      accountId: account.id,
      inReplyTo: ['root@x'],
      references: ['root@x'],
    })
    const stored = server.box('Drafts').messages[0]
    expect([...stored.flags].sort()).toEqual(['\\Draft', '\\Seen'])
    const [message] = await p.messages(account, [id], true)
    expect(message.keywords.$draft).toBe(true)
    expect(message.subject).toBe('Grüße')
    const raw = new TextDecoder().decode(stored.raw)
    expect(raw).toMatch(/^In-Reply-To: <root@x>/m)
    // Drafts keep Bcc so another client resuming the draft still sees it.
    expect(raw).toMatch(/^Bcc:/m)
  })
  it('keeps Bcc recipients in the envelope only', async () => {
    const p = await connected()
    const outgoing = await p.prepareSubmission(
      account,
      { ...draft, accountId: account.id },
      'attempt@example.com',
    )
    expect(outgoing.envelope).toEqual({
      from: 'me@example.com',
      to: ['alex@example.org', 'secret@example.net'],
    })
    const raw = new TextDecoder().decode(outgoing.mime)
    expect(raw).not.toMatch(/^Bcc:/im)
    expect(raw).not.toContain('secret@example.net')
    expect(raw).toMatch(/^Message-ID: <attempt@example.com>/m)
    expect(server.commands).not.toContain('APPEND')
  })
  it('does not duplicate a Sent copy the server already filed', async () => {
    const p = await connected()
    const outgoing = await p.prepareSubmission(
      account,
      { ...draft, accountId: account.id },
      'attempt@example.com',
    )
    server.deliver('Sent', { messageId: 'attempt@example.com', subject: 'Grüße' })
    expect(await p.fileSentCopy(account, outgoing)).toBe('server')
    expect(server.box('Sent').messages).toHaveLength(1)
  })
  it('reports an ambiguous append and reconciles it before appending again', async () => {
    const p = await connected()
    const outgoing = await p.prepareSubmission(
      account,
      { ...draft, accountId: account.id },
      'attempt@example.com',
    )
    // The server stores the copy but the response is lost.
    server.hooks.set('APPEND:after', () => {
      server.commandPorts.at(-1)!.drop()
      throw new ProviderError('network', 'Connection lost.')
    })
    await expect(p.fileSentCopy(account, outgoing)).rejects.toMatchObject({
      code: 'filingUncertain',
    })
    expect(await p.fileSentCopy(account, outgoing)).toBe('server')
    expect(server.box('Sent').messages).toHaveLength(1)
  })
  it('finds its own Sent copy even when the server search index lags behind', async () => {
    server.laggingSearch = true
    const p = await connected()
    const outgoing = await p.prepareSubmission(
      account,
      { ...draft, accountId: account.id },
      'attempt@example.com',
    )
    expect(await p.fileSentCopy(account, outgoing)).toBe('filed')
    expect(await p.fileSentCopy(account, outgoing)).toBe('server')
    expect(server.box('Sent').messages).toHaveLength(1)
  })
  it('asks for a Sent folder instead of guessing when none is mapped', async () => {
    server.boxes.delete('Sent')
    const p = await connected()
    const outgoing = await p.prepareSubmission(
      account,
      { ...draft, accountId: account.id },
      'attempt@example.com',
    )
    await expect(p.fileSentCopy(account, outgoing)).rejects.toMatchObject({ code: 'filing' })
  })
  it('submits through SMTP with the incoming login by default and never claims later proof', async () => {
    const submit = vi.fn().mockResolvedValue({ accepted: ['alex@example.org'], rejected: [] })
    const verify = vi.fn().mockResolvedValue(undefined)
    const p = await connected({ smtp: { submit, verify } })
    await p.verifyOutgoing()
    const outgoing = await p.prepareSubmission(
      account,
      { ...draft, accountId: account.id },
      'attempt@example.com',
    )
    await p.submit(account, outgoing)
    expect(submit.mock.calls[0][0]).toMatchObject({
      host: 'smtp.example.com',
      username: 'me',
      password: 'disposable',
    })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(await p.submissionExists()).toBe(false)
  })
  it('uses separate outgoing credentials when configured', async () => {
    const submit = vi.fn().mockResolvedValue({ accepted: [], rejected: [] })
    const p = await connected({
      config: {
        ...config,
        outgoingSameCredentials: false,
        outgoing: { ...config.outgoing, username: 'smtp-user' },
      },
      outgoingPassword: 'smtp-secret',
      smtp: { submit, verify: vi.fn() },
    })
    await p.submit(
      account,
      await p.prepareSubmission(account, { ...draft, accountId: account.id }, 'x@example.com'),
    )
    expect(submit.mock.calls[0][0]).toMatchObject({
      username: 'smtp-user',
      password: 'smtp-secret',
    })
  })
})
