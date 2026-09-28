import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
  },
  dialog: {},
  shell: {},
  Notification: { isSupported: () => false },
}))
import { MailService, type ProviderFactory } from '../apps/desktop/src/main/service'
import { JsonStore } from '../apps/desktop/src/main/storage'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import { ImapProvider } from '../packages/imap/src'
import { JmapProvider } from '../packages/jmap/src'
import {
  ProviderError,
  type ConnectInput,
  type Draft,
  type SubmissionOutcome,
} from '../packages/core/src'
import { FakeImapServer } from './support/fake-imap'

const input: ConnectInput = {
  config: {
    protocol: 'imap',
    email: 'me@example.com',
    incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: 'me' },
    outgoing: { host: 'smtp.example.com', port: 587, security: 'starttls', username: 'me' },
    outgoingSameCredentials: true,
  },
  password: 'disposable',
  name: 'Work',
  remember: true,
  connectionId: 'imap-connection',
}
const draftId = 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17'
const accountId = JSON.stringify(['imap-connection', 'imap'])
const draft: Draft = {
  id: draftId,
  accountId,
  identityId: 'default',
  to: [{ name: 'Alex', email: 'alex@example.org' }],
  cc: [{ name: 'Sam', email: 'sam@example.org' }],
  bcc: [],
  subject: 'Plans',
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: [],
  updatedAt: '2026-09-23T10:00:00.000Z',
  status: 'local',
}
let directory: string
let server: FakeImapServer
let service: MailService
let store: JsonStore
let submit: ReturnType<typeof vi.fn<(...args: any[]) => Promise<SubmissionOutcome>>>
let verify: ReturnType<typeof vi.fn<(...args: any[]) => Promise<void>>>
const factory: ProviderFactory = (options) =>
  new ImapProvider({
    connectionId: options.connectionId,
    name: options.name,
    config: options.config as typeof input.config & { protocol: 'imap' },
    password: options.secrets.password,
    outgoingPassword: options.secrets.outgoingPassword,
    folders: options.folders,
    index: openInProcessIndex(
      options.temporary ? ':memory:' : join(directory, options.connectionId + '.sqlite'),
    ),
    readAttachment: options.readAttachment,
    background: false,
    ports: server.port,
    smtp: { submit, verify },
    timing: { sentCopyGraceMs: 0, previews: 0 },
  })
async function start() {
  store = new JsonStore(directory)
  service = new MailService(store, () => {}, { providers: factory })
  await service.init()
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-service-imap-'))
  server = new FakeImapServer()
  submit = vi.fn(async () => ({ accepted: ['alex@example.org', 'sam@example.org'], rejected: [] }))
  verify = vi.fn(async () => {})
  await start()
})
afterEach(async () => {
  service.dispose()
  vi.restoreAllMocks()
  await new Promise((r) => setTimeout(r, 20))
  await rm(directory, { recursive: true, force: true })
})
const journal = async () =>
  (await store.read<any[]>('submissions', [])).find((j) => j.draftId === draftId)
const restart = async () => {
  service.dispose()
  await start()
  await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('connected'))
}

describe('IMAP account setup', () => {
  it('checks incoming and outgoing servers separately and saves nothing', async () => {
    verify.mockRejectedValueOnce(
      new ProviderError('outgoingAuthentication', 'The outgoing server rejected this login.'),
    )
    const test = await service.testConnection({ ...input, connectionId: undefined })
    expect(test.incoming).toEqual({ ok: true })
    expect(test.outgoing).toEqual({ ok: false, error: 'The outgoing server rejected this login.' })
    expect(test.folders?.mappings.sent).toEqual({ path: 'Sent', source: 'server' })
    expect(submit).not.toHaveBeenCalled()
    await expect(stat(join(directory, 'connections.json'))).rejects.toThrow()
  })
  it('requires both servers before completing setup', async () => {
    verify.mockRejectedValueOnce(
      new ProviderError('outgoingNetwork', 'The outgoing server could not be reached.'),
    )
    await expect(service.connect(input)).rejects.toThrow('outgoing server')
    expect(service.accounts).toEqual([])
    await service.connect(input)
    expect(service.accounts[0]).toMatchObject({
      protocol: 'imap',
      email: 'me@example.com',
      status: 'connected',
    })
  })
  it('never exposes passwords in connection settings and keeps separate outgoing secrets', async () => {
    await service.connect({
      ...input,
      config: { ...input.config, outgoingSameCredentials: false } as ConnectInput['config'],
      outgoingPassword: 'outgoing-secret',
    })
    const settings = await service.connectionSettings('imap-connection')
    expect(JSON.stringify(settings)).not.toMatch(/disposable|outgoing-secret/)
    expect(settings).toMatchObject({ remember: true, config: { protocol: 'imap' } })
    const saved = JSON.parse(await readFile(join(directory, 'connections.json'), 'utf8')).data[0]
    expect(saved).toMatchObject({
      localSecret: 'disposable',
      outgoingLocalSecret: 'outgoing-secret',
    })
    await restart()
    await service.send(draft)
    expect(submit.mock.calls[0][0]).toMatchObject({ password: 'outgoing-secret' })
  })
  it('creates missing folders chosen during setup and remembers the choice', async () => {
    server.boxes.delete('Archive')
    await service.connect({ ...input, folders: { archive: { path: 'Archive', create: true } } })
    expect(server.boxes.has('Archive')).toBe(true)
    expect((await service.connectionSettings('imap-connection')).folders).toEqual({
      archive: { path: 'Archive' },
    })
    const review = await service.setFolderMappings(accountId, { archive: { path: 'INBOX' } })
    expect(review.mappings.archive).toEqual({ path: 'INBOX', source: 'user' })
  })
})

describe('legacy connection migration', () => {
  it('upgrades version 1 records to JMAP connections atomically and keeps a backup', async () => {
    service.dispose()
    const legacy = [
      {
        id: 'old',
        serverUrl: 'https://mail.example',
        username: 'me',
        name: 'Home',
        localSecret: 'legacy-secret',
        accounts: [
          {
            id: '["old","a"]',
            connectionId: 'old',
            remoteId: 'a',
            name: 'Home',
            email: 'me@example.com',
            color: '#a69aef',
            status: 'connected',
          },
        ],
      },
    ]
    await writeFile(
      join(directory, 'connections.json'),
      JSON.stringify({ version: 1, data: legacy }),
    )
    const connect = vi
      .spyOn(JmapProvider.prototype, 'connect')
      .mockRejectedValue(new ProviderError('network', 'Offline'))
    await start()
    const saved = JSON.parse(await readFile(join(directory, 'connections.json'), 'utf8'))
    expect(saved.version).toBe(2)
    expect(saved.data[0]).toMatchObject({
      id: 'old',
      localSecret: 'legacy-secret',
      config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'me' },
      accounts: [{ id: '["old","a"]', protocol: 'jmap' }],
    })
    expect(
      JSON.parse(await readFile(join(directory, 'connections.v1.backup.json'), 'utf8')).data,
    ).toEqual(legacy)
    expect(service.accounts.map((a) => a.id)).toEqual(['["old","a"]'])
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
  })
  it('refuses a malformed legacy file and leaves it untouched', async () => {
    service.dispose()
    const original = JSON.stringify({ version: 1, data: [{ id: 'broken' }] })
    await writeFile(join(directory, 'connections.json'), original)
    await expect(start()).rejects.toThrow('preserved')
    expect(await readFile(join(directory, 'connections.json'), 'utf8')).toBe(original)
  })
  it('refuses data from a newer version without modifying it', async () => {
    service.dispose()
    const original = JSON.stringify({ version: 3, data: [] })
    await writeFile(join(directory, 'connections.json'), original)
    await expect(start()).rejects.toThrow('unsupported')
    expect(await readFile(join(directory, 'connections.json'), 'utf8')).toBe(original)
  })
})

describe('IMAP sending', () => {
  beforeEach(() => service.connect(input))

  it('persists MIME, envelope and journal before submitting, then files the Sent copy', async () => {
    submit.mockImplementationOnce(async (_settings, envelope) => {
      expect((await journal()).state).toBe('submitting')
      expect((await journal()).envelope).toEqual(envelope)
      expect(await readFile(join(directory, 'outgoing', draftId + '.eml'), 'utf8')).toContain(
        'Subject: Plans',
      )
      return { accepted: envelope.to, rejected: [] }
    })
    const result = await service.send(draft)
    expect(result).toMatchObject({ status: 'sent', sentCopy: 'filed' })
    expect(server.box('Sent').messages).toHaveLength(1)
    expect((await journal()).sentCopy).toBe('filed')
    await expect(stat(join(directory, 'outgoing', draftId + '.eml'))).rejects.toThrow()
    expect(await service.submissions()).toEqual([])
  })
  it('records acceptance before filing, and a filing failure only retries filing', async () => {
    server.hooks.set('APPEND:before', () => {
      throw new ProviderError('command', 'Over quota')
    })
    const result = await service.send(draft)
    expect(result).toMatchObject({ status: 'sent', sentCopy: 'pending' })
    expect(result.message).toContain('Sent copy pending')
    expect((await journal()).state).toBe('sent')
    expect(await service.submissions()).toMatchObject([
      { draftId, state: 'sent', sentCopy: 'failed' },
    ])
    expect((await service.retrySentCopy(draftId)).sentCopy).toBe('filed')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(server.box('Sent').messages).toHaveLength(1)
  })
  it('reconciles an ambiguous Sent append instead of appending twice', async () => {
    server.hooks.set('APPEND:after', () => {
      server.commandPorts.at(-1)!.drop()
      throw new ProviderError('network', 'Connection lost.')
    })
    await service.send(draft)
    expect((await journal()).sentCopy).toBe('uncertain')
    await service.retrySentCopy(draftId)
    expect((await journal()).sentCopy).toBe('server')
    expect(server.box('Sent').messages).toHaveLength(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })
  it('reports partial acceptance and recovers a draft addressed only to refused recipients', async () => {
    submit.mockResolvedValueOnce({
      accepted: ['alex@example.org'],
      rejected: [{ email: 'sam@example.org', reason: '550 No such user' }],
    })
    const result = await service.send(draft)
    expect(result.status).toBe('partial')
    expect(result.rejected).toEqual([{ name: 'Sam', email: 'sam@example.org' }])
    expect(await service.submissions()).toMatchObject([
      { state: 'partial', rejected: [{ email: 'sam@example.org' }] },
    ])
    // A partial send is never resent automatically.
    expect((await service.send(draft)).status).toBe('partial')
    const recovery = await service.recoverRejected(draftId)
    expect(recovery).toMatchObject({
      to: [],
      cc: [{ email: 'sam@example.org' }],
      subject: 'Plans',
      text: 'Hello',
      status: 'local',
    })
    expect(recovery.id).not.toBe(draftId)
    expect(await service.submissions()).toEqual([])
    expect(submit).toHaveBeenCalledTimes(1)
  })
  it('never retries a submission whose final response was lost, even after restart', async () => {
    submit.mockRejectedValueOnce(new ProviderError('submissionUncertain', 'No final reply.'))
    expect((await service.send(draft)).status).toBe('uncertain')
    expect((await service.send(draft)).status).toBe('uncertain')
    expect((await service.reconcile(draftId)).status).toBe('uncertain')
    await restart()
    expect((await service.send(draft)).status).toBe('uncertain')
    expect(submit).toHaveBeenCalledTimes(1)
    // A Sent copy alone is not proof of submission.
    server.deliver('Sent', { messageId: (await journal()).messageId, subject: 'Plans' })
    expect((await service.reconcile(draftId)).status).toBe('uncertain')
    const replacement = await service.replaceUncertain(draftId)
    expect(replacement).toMatchObject({ subject: 'Plans', status: 'local' })
    expect(replacement.id).not.toBe(draftId)
    expect((await service.drafts()).find((d) => d.id === draftId)?.status).toBe('uncertain')
    expect(submit).toHaveBeenCalledTimes(1)
  })
  it('treats a crash while the journal says submitting as unconfirmed, never as unsent', async () => {
    const write = store.write.bind(store)
    let crash = false
    vi.spyOn(store, 'write').mockImplementation((name, data, version) => {
      if (crash && name === 'submissions') return Promise.reject(new Error('Power lost'))
      return write(name, data, version)
    })
    submit.mockImplementationOnce(async (_s, envelope) => {
      crash = true
      return { accepted: envelope.to, rejected: [] }
    })
    expect((await service.send(draft)).message).toContain('reconciled after restart')
    crash = false
    await restart()
    expect((await journal()).state).toBe('uncertain')
    expect((await service.send(draft)).status).toBe('uncertain')
    expect(submit).toHaveBeenCalledTimes(1)
  })
  it('does not submit when the journal cannot be written first', async () => {
    const write = store.write.bind(store)
    vi.spyOn(store, 'write').mockImplementation((name, data, version) => {
      if (name === 'submissions' && (data as any[]).some((j) => j.state === 'submitting'))
        return Promise.reject(new Error('Disk full'))
      return write(name, data, version)
    })
    await expect(service.send(draft)).rejects.toThrow('Disk full')
    expect(submit).not.toHaveBeenCalled()
    expect((await service.drafts())[0]).toMatchObject({ text: 'Hello' })
  })
  it('restores a draft interrupted before submission began without claiming it was sent', async () => {
    await service.saveDraft(draft)
    await store.write('submissions', [
      { draftId, accountId, state: 'preparing', at: draft.updatedAt },
    ])
    await restart()
    expect(await journal()).toBeUndefined()
    // The draft is editable again (and may already be saved to the server), never marked sent.
    expect(['local', 'synced']).toContain((await service.drafts())[0].status)
    expect((await service.drafts())[0].text).toBe('Hello')
    expect(submit).not.toHaveBeenCalled()
  })
  it('distinguishes an outgoing login failure from incoming problems', async () => {
    submit.mockRejectedValueOnce(
      new ProviderError('outgoingAuthentication', 'The outgoing server rejected your login.'),
    )
    await expect(service.send(draft)).rejects.toThrow('outgoing server')
    expect(service.accounts[0]).toMatchObject({
      status: 'connected',
      outgoingError: 'The outgoing server rejected your login.',
    })
    expect((await service.drafts())[0]).toMatchObject({
      status: 'error',
      errorKind: 'outgoingAuthentication',
    })
    expect((await journal()).state).toBe('rejected')
    expect((await service.send(draft)).status).toBe('sent')
    expect(service.accounts[0].outgoingError).toBeUndefined()
  })
})

describe('IMAP drafts', () => {
  beforeEach(() => service.connect(input))

  it('replaces the server draft only after the new copy is confirmed', async () => {
    const first = await service.syncDraft(draft)
    expect(first.status).toBe('synced')
    const second = await service.syncDraft({
      ...first,
      text: 'Hello again',
      updatedAt: '2026-09-23T10:01:00.000Z',
    })
    expect(second.status).toBe('synced')
    expect(second.serverId).not.toBe(first.serverId)
    expect(server.box('Drafts').messages.map((m) => m.input.text?.trim())).toEqual(['Hello again'])
  })
  it('keeps both copies when another client changed the server draft', async () => {
    const first = await service.syncDraft(draft)
    // Another client saves its own edit: it appends a new draft and removes the old one.
    server.remove('Drafts', server.box('Drafts').messages[0].uid)
    server.deliver('Drafts', {
      messageId: 'theirs@x',
      subject: 'Plans',
      text: 'Their edit',
      flags: ['\\Draft'],
    })
    const second = await service.syncDraft({
      ...first,
      text: 'Mine',
      updatedAt: '2026-09-23T10:01:00.000Z',
    })
    expect(second).toMatchObject({ status: 'error', errorKind: 'conflict', text: 'Mine' })
    expect(server.box('Drafts').messages.map((m) => m.input.text)).toEqual(['Their edit'])
  })
  it('keeps the previous server draft when the replacement cannot be confirmed', async () => {
    const first = await service.syncDraft(draft)
    server.hooks.set('APPEND:before', () => {
      throw new ProviderError('command', 'Over quota')
    })
    const failed = await service.syncDraft({
      ...first,
      text: 'Newer',
      updatedAt: '2026-09-23T10:01:00.000Z',
    })
    expect(failed.status).toBe('error')
    expect(failed.text).toBe('Newer')
    expect(server.box('Drafts').messages).toHaveLength(1)
    expect(server.box('Drafts').messages[0].input.text?.trim()).toBe('Hello')
  })
})
