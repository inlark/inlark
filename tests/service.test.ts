import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: (value: string) => Buffer.from('encrypted:' + value),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
  },
  dialog: {},
  shell: {},
  Notification: { isSupported: () => false },
}))
import { MailService } from '../apps/desktop/src/main/service'
import { JsonStore, encryptSecret } from '../apps/desktop/src/main/storage'
import { JmapProvider, JmapError, draftFingerprint } from '../packages/jmap/src'
import { type Account, type Draft, type Mailbox, type Message } from '../packages/core/src'
import { publicAddress, publicFetch } from '../apps/desktop/src/main/public-fetch'
const account: Account = {
  id: 'account',
  connectionId: 'connection',
  remoteId: 'remote',
  name: 'Test',
  email: 'me@example.com',
  color: '#aaa',
  status: 'connected',
}
const draft: Draft = {
  id: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17',
  accountId: account.id,
  identityId: 'identity',
  to: [{ name: 'Recipient', email: 'recipient@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Test',
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: [],
  updatedAt: '2026-09-23T10:00:00.000Z',
  status: 'local',
}
const mail: Message = {
  id: 'message',
  threadId: 'thread',
  accountId: account.id,
  subject: 'Test',
  from: [],
  to: [],
  cc: [],
  bcc: [],
  replyTo: [],
  receivedAt: '2026-09-23T10:00:00Z',
  preview: '',
  keywords: { $seen: true },
  mailboxIds: { inbox: true, custom: true },
  size: 1,
  hasAttachment: false,
}
const boxes = ['inbox', 'archive', 'drafts', 'sent', 'trash', 'custom'].map((id) => ({
  id,
  accountId: account.id,
  name: id,
  role: id === 'custom' ? null : id,
  parentId: null,
  totalEmails: 1,
  unreadEmails: 0,
  rights: {
    mayReadItems: true,
    mayAddItems: true,
    mayRemoveItems: true,
    maySetSeen: true,
    maySetKeywords: true,
    mayCreateChild: true,
    mayRename: true,
    mayDelete: true,
  },
})) satisfies Mailbox[]
let directory: string, service: MailService, store: JsonStore
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-test-'))
  store = new JsonStore(directory)
  service = new MailService(store, () => {})
  await service.init()
  vi.spyOn(JmapProvider.prototype, 'connect').mockResolvedValue([account])
  vi.spyOn(JmapProvider.prototype, 'identities').mockResolvedValue([
    { id: 'identity', accountId: account.id, name: 'Me', email: account.email },
  ])
  vi.spyOn(JmapProvider.prototype, 'subscribe').mockReturnValue(() => {})
  vi.spyOn(JmapProvider.prototype, 'mailboxes').mockResolvedValue(boxes)
  vi.spyOn(JmapProvider.prototype, 'query').mockResolvedValue({ items: [], total: 0 })
  vi.spyOn(JmapProvider.prototype, 'conversationMetadata').mockResolvedValue([mail])
  vi.spyOn(JmapProvider.prototype, 'messages').mockResolvedValue([mail])
  vi.spyOn(JmapProvider.prototype, 'createDraft').mockResolvedValue('created')
  vi.spyOn(JmapProvider.prototype, 'update').mockImplementation(async (_a, updates) => ({
    updated: Object.keys(updates),
    failures: [],
  }))
  await service.connect({
    config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'test' },
    password: 'disposable',
    name: 'Test',
    remember: false,
    connectionId: 'connection',
  })
})
afterEach(async () => {
  service.dispose()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
describe('durable mail operations', () => {
  it('keeps the title bar preference across restarts in either mode', async () => {
    for (const systemTitleBar of [true, false]) {
      await service.setSettings({ ...service.settings, systemTitleBar })
      service.dispose()
      service = new MailService(new JsonStore(directory), () => {})
      await service.init()
      expect((await service.bootstrap()).settings.systemTitleBar).toBe(systemTitleBar)
    }
  })

  it('archives without removing unrelated folder memberships', async () => {
    const result = await service.mutate({
      targets: [{ accountId: account.id, threadId: 'thread' }],
      action: 'archive',
    })
    const update = vi.mocked(JmapProvider.prototype.update).mock.calls.at(-1)![1]
    expect(update.message).toEqual({ mailboxes: { inbox: false, archive: true } })
    expect(result.undoId).toBeTruthy()
  })
  it('serializes overlapping changes to one account so neither sees stale state', async () => {
    let state = 's0'
    vi.spyOn(JmapProvider.prototype, 'getStateToken').mockImplementation(() => state)
    vi.mocked(JmapProvider.prototype.update).mockImplementation(
      async (_account, updates, _destroy, expected) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        if (expected !== state) return { updated: [], failures: ['stateMismatch'] }
        state = 's' + (Number(state.slice(1)) + 1)
        return { updated: Object.keys(updates), failures: [] }
      },
    )
    const target = [{ accountId: account.id, threadId: 'thread' }]
    // Archiving in the reader opens the next conversation, which is marked read at once.
    const [archive, read] = await Promise.all([
      service.mutate({ targets: target, action: 'archive' }),
      service.mutate({ targets: target, action: 'unread' }),
    ])
    expect(archive.failures).toEqual([])
    expect(read.failures).toEqual([])
    expect(state).toBe('s2')
  })
  it('preserves drafts across service restart with private permissions', async () => {
    await service.saveDraft(draft)
    expect((await stat(join(directory, 'drafts.json'))).mode & 0o777).toBe(0o600)
    service.dispose()
    service = new MailService(new JsonStore(directory), () => {})
    await service.init()
    expect((await service.drafts())[0].text).toBe('Hello')
  })
  it('reconnects after restart with an explicitly remembered local password', async () => {
    await service.connect({
      config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'test' },
      password: 'disposable',
      name: 'Test',
      remember: true,
      connectionId: 'connection',
    })
    const path = join(directory, 'connections.json')
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      version: 2,
      data: [
        {
          localSecret: 'disposable',
          config: { protocol: 'jmap', serverUrl: 'https://mail.example' },
        },
      ],
    })
    service.dispose()
    service = new MailService(new JsonStore(directory), () => {})
    await service.init()
    await vi.waitFor(() => expect(service.accounts[0].status).toBe('connected'))
    expect(service.accounts[0].sessionOnly).toBe(false)
  })
  it('keeps the chosen avatar across reconnects and restarts', async () => {
    await service.connect({
      config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'test' },
      password: 'disposable',
      name: 'Test',
      remember: true,
      connectionId: 'connection',
    })
    const appearance = { seed: 'a1b2c3d4', image: 'data:image/png;base64,iVBORw0KGgo=' }
    await service.updateAccount(account.id, appearance)
    await service.reconnect('connection')
    expect(service.accounts[0]).toMatchObject(appearance)
    service.dispose()
    service = new MailService(new JsonStore(directory), () => {})
    await service.init()
    await vi.waitFor(() => expect(service.accounts[0].status).toBe('connected'))
    expect(service.accounts[0]).toMatchObject(appearance)
  })
  it('refuses a picture whose contents do not match its type', async () => {
    const html = 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64')
    await expect(service.updateAccount(account.id, { image: html })).rejects.toThrow(
      'could not be read',
    )
    expect(service.accounts[0].image).toBeUndefined()
  })
  it('does not save the password for session-only login', async () => {
    const connection = JSON.parse(await readFile(join(directory, 'connections.json'), 'utf8'))
      .data[0]
    expect(connection.secret).toBeUndefined()
    expect(connection.localSecret).toBeUndefined()
  })
  it('moves a local password to secure storage when a keyring becomes available', async () => {
    const input = {
      config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'test' },
      password: 'disposable',
      name: 'Test',
      remember: true,
      connectionId: 'connection',
    }
    await service.connect(input)
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true)
    vi.spyOn(safeStorage, 'getSelectedStorageBackend').mockReturnValue('gnome_libsecret')
    await service.reconnect('connection')
    const connection = JSON.parse(await readFile(join(directory, 'connections.json'), 'utf8'))
      .data[0]
    expect(connection.localSecret).toBeUndefined()
    expect(connection.secret).toBe(Buffer.from('encrypted:disposable').toString('base64'))
  })
  it('never resubmits an ambiguous send, including after restart', async () => {
    const submit = vi
      .spyOn(JmapProvider.prototype, 'submit')
      .mockRejectedValue(new JmapError('network', 'Response lost'))
    vi.spyOn(JmapProvider.prototype, 'submissionExists').mockResolvedValue(false)
    expect((await service.send(draft)).status).toBe('uncertain')
    expect((await service.send(draft)).status).toBe('uncertain')
    expect(submit).toHaveBeenCalledTimes(1)
    const persisted = await store.read<any[]>('submissions', [])
    expect(persisted[0].state).toBe('uncertain')
    await service.saveDraft({ ...draft, text: 'Newer UI autosave' })
    expect((await service.drafts())[0].status).toBe('uncertain')
  })
  it('reconciles a lost send response using server submission records', async () => {
    vi.spyOn(JmapProvider.prototype, 'submit').mockRejectedValue(
      new JmapError('network', 'Response lost'),
    )
    vi.spyOn(JmapProvider.prototype, 'submissionExists').mockResolvedValue(true)
    await service.send(draft)
    expect((await service.reconcile(draft.id)).status).toBe('sent')
    expect((await service.drafts())[0].status).toBe('sent')
  })
  it('retains the draft after an explicit server rejection and allows a deliberate retry', async () => {
    const submit = vi
      .spyOn(JmapProvider.prototype, 'submit')
      .mockRejectedValueOnce(new JmapError('submissionRejected', 'Recipient rejected'))
      .mockResolvedValue({ accepted: ['recipient@example.com'], rejected: [] })
    await expect(service.send(draft)).rejects.toThrow('Recipient rejected')
    expect((await service.drafts())[0].text).toBe('Hello')
    expect((await service.send(draft)).status).toBe('sent')
    expect(submit).toHaveBeenCalledTimes(2)
  })
  it('keeps the local copy when another client edits the server draft', async () => {
    const saved = await service.syncDraft({
      ...draft,
      serverId: 'original',
      serverFingerprint: 'different',
    })
    expect(saved.status).toBe('error')
    expect(saved.text).toBe('Hello')
    expect(JmapProvider.prototype.createDraft).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'keeps JMAP replacement IDs through delayed saves (encrypted: %s)',
    async (encrypted) => {
      const remote = new Map<string, { message: Message; raw: Uint8Array }>()
      if (encrypted) {
        await service.encryption.vault.create('test-vault-password')
        const fixture = await readFile(
          new URL('./fixtures/openpgp/encrypted-signed.eml', import.meta.url),
        )
        vi.spyOn(service.encryption, 'compose').mockImplementation(async (_draft, _own, id) =>
          Buffer.concat([Buffer.from('X-Draft-Revision: ' + id + '\r\n'), fixture]),
        )
      }
      let revision = 0
      vi.mocked(JmapProvider.prototype.createDraft).mockImplementation(
        async (_account, input, _messageId, mime) => {
          const id = 'revision-' + ++revision
          remote.set(id, {
            message: {
              ...mail,
              id,
              subject: input.subject,
              to: input.to,
              html: input.html,
              text: input.text,
              keywords: { $draft: true, $seen: true },
            },
            raw: mime || Buffer.from('Content-Type: text/plain\r\n\r\n' + input.text),
          })
          return id
        },
      )
      vi.mocked(JmapProvider.prototype.messages).mockImplementation(async (_account, ids) =>
        ids.flatMap((id) => (remote.has(id) ? [remote.get(id)!.message] : [])),
      )
      vi.spyOn(JmapProvider.prototype, 'rawMessage').mockImplementation(
        async (_account, id) => remote.get(id)!.raw,
      )
      vi.mocked(JmapProvider.prototype.update).mockImplementation(async (_a, _changes, ids) => {
        for (const id of ids || []) remote.delete(id)
        return { updated: [], failures: [] }
      })
      const first = await service.syncDraft(draft)
      const second = await service.syncDraft({
        ...first,
        encryption: encrypted ? 'encrypt' : undefined,
        text: 'Second revision',
        updatedAt: '2026-09-23T10:01:00.000Z',
      })
      expect(second.status).toBe('synced')
      expect(remote.has(first.serverId!)).toBe(false)
      // The next edit was captured before the replacement reply reached the composer.
      const third = await service.syncDraft({
        ...second,
        serverId: first.serverId,
        serverFingerprint: first.serverFingerprint,
        text: 'Third revision',
        updatedAt: '2026-09-23T10:02:00.000Z',
      })
      expect(third.status).toBe('synced')
      expect([...remote.keys()]).toEqual([third.serverId])
      if (encrypted) {
        expect(third.serverFingerprint).toMatch(/^[a-f0-9]{64}$/)
        expect(await readFile(join(directory, 'drafts.json'), 'utf8')).not.toContain(
          'Third revision',
        )
      }
      vi.spyOn(JmapProvider.prototype, 'submit').mockResolvedValue({
        accepted: ['recipient@example.com'],
        rejected: [],
      })
      expect(
        (
          await service.send({
            ...third,
            serverId: first.serverId,
            serverFingerprint: first.serverFingerprint,
          })
        ).status,
      ).toBe('sent')
    },
  )

  it('does not undo over a subsequent change from another client', async () => {
    const result = await service.mutate({
      targets: [{ accountId: account.id, threadId: 'thread' }],
      action: 'archive',
    })
    vi.mocked(JmapProvider.prototype.messages).mockResolvedValue([
      { ...mail, mailboxIds: { custom: true, trash: true } },
    ])
    vi.mocked(JmapProvider.prototype.update).mockClear()
    const undone = await service.undo(result.undoId!)
    expect(undone.changed).toBe(0)
    expect(undone.failures.join()).toContain('changed since')
    expect(vi.mocked(JmapProvider.prototype.update).mock.calls[0][1]).toEqual({})
  })
  it('recovers a crash during submission and preserves the immutable attempted content', async () => {
    await service.saveDraft({ ...draft, status: 'sending' })
    await store.write('submissions', [
      {
        draftId: draft.id,
        accountId: account.id,
        emailId: 'created',
        state: 'submitting',
        at: draft.updatedAt,
      },
    ])
    service.dispose()
    service = new MailService(new JsonStore(directory), () => {})
    await service.init()
    expect((await service.drafts())[0].status).toBe('uncertain')
    await service.saveDraft({
      ...draft,
      text: 'stale renderer write',
      updatedAt: new Date().toISOString(),
    })
    expect((await service.drafts())[0].text).toBe('Hello')
  })
  it('does not send or delete a server draft changed by another client', async () => {
    const submit = vi
      .spyOn(JmapProvider.prototype, 'submit')
      .mockResolvedValue({ accepted: ['recipient@example.com'], rejected: [] })
    await expect(
      service.send({ ...draft, serverId: 'original', serverFingerprint: 'different' }),
    ).rejects.toThrow('another client')
    expect(submit).not.toHaveBeenCalled()
    expect(JmapProvider.prototype.update).not.toHaveBeenCalled()
    expect((await service.drafts())[0].text).toBe('Hello')
  })
  it('returns successful accounts and explicitly identifies an unavailable account', async () => {
    const second = { ...account, id: 'second', connectionId: 'other', remoteId: 'other' }
    vi.mocked(JmapProvider.prototype.connect).mockResolvedValue([second])
    await service.connect({
      config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'second' },
      password: 'disposable',
      name: 'Second',
      remember: false,
      connectionId: 'other',
    })
    vi.mocked(JmapProvider.prototype.query).mockImplementation(async (a) => {
      if (a.id === account.id) throw new JmapError('network', 'Offline')
      return { items: [], total: 12 }
    })
    const result = await service.query({ view: 'inbox' })
    expect(result.total).toBe(12)
    expect(result.failedAccounts).toEqual([account.id])
  })
  it('synchronizes a closed offline draft on the next connected refresh', async () => {
    await service.saveDraft(draft)
    await service.refresh()
    expect((await service.drafts())[0].status).toBe('synced')
    expect(JmapProvider.prototype.createDraft).toHaveBeenCalledTimes(1)
  })
  it('recovers a completed submission when its final local draft write failed', async () => {
    const submit = vi
      .spyOn(JmapProvider.prototype, 'submit')
      .mockResolvedValue({ accepted: ['recipient@example.com'], rejected: [] })
    const write = store.write.bind(store)
    const failingWrite = vi.spyOn(store, 'write').mockImplementation((name, data) => {
      if (name === 'drafts' && (data as Draft[]).some((d) => d.status === 'sent'))
        return Promise.reject(new Error('Disk full'))
      return write(name, data)
    })
    expect((await service.send(draft)).status).toBe('sent')
    failingWrite.mockRestore()
    service.dispose()
    service = new MailService(new JsonStore(directory), () => {})
    await service.init()
    expect((await service.drafts())[0]).toMatchObject({
      status: 'sent',
      text: '',
      html: '',
      attachments: [],
    })
    expect((await service.reconcile(draft.id)).status).toBe('sent')
    expect(submit).toHaveBeenCalledTimes(1)
  })
  it('preserves a message sent by another client when discarding the stale local draft', async () => {
    const remote = { ...mail, keywords: { $seen: true }, text: 'Hello' }
    vi.mocked(JmapProvider.prototype.messages).mockResolvedValue([remote])
    await service.saveDraft({
      ...draft,
      serverId: remote.id,
      serverFingerprint: draftFingerprint(remote),
    })
    await service.deleteDraft(draft.id)
    expect(JmapProvider.prototype.update).not.toHaveBeenCalled()
    expect(await service.drafts()).toEqual([])
  })
  it('deletes a server-only draft but never a message sent meanwhile', async () => {
    vi.mocked(JmapProvider.prototype.messages).mockResolvedValue([
      { ...mail, keywords: { $draft: true } },
    ])
    await service.deleteServerDraft(account.id, mail.id)
    expect(vi.mocked(JmapProvider.prototype.update).mock.calls.at(-1)!.slice(1, 3)).toEqual([
      {},
      [mail.id],
    ])
    vi.mocked(JmapProvider.prototype.update).mockClear()
    vi.mocked(JmapProvider.prototype.messages).mockResolvedValue([mail])
    await expect(service.deleteServerDraft(account.id, mail.id)).rejects.toThrow(
      'no longer a draft',
    )
    expect(JmapProvider.prototype.update).not.toHaveBeenCalled()
  })
  it('does not recreate a draft deleted or sent in another client without a decision', async () => {
    for (const remote of [[], [{ ...mail, keywords: { $seen: true } }]]) {
      vi.mocked(JmapProvider.prototype.messages).mockResolvedValue(remote)
      const result = await service.syncDraft({
        ...draft,
        serverId: 'original',
        serverFingerprint: 'previous',
      })
      expect(result.status).toBe('error')
      expect(result.error).toContain('another client')
      expect(result.text).toBe('Hello')
    }
    expect(JmapProvider.prototype.createDraft).not.toHaveBeenCalled()
  })
  it('never silently stores weakly encrypted credentials', () => {
    expect(() => encryptSecret('secret')).toThrow('Secure credential storage is unavailable')
  })
  it('excludes mail contents and login details from diagnostics', async () => {
    await service.saveDraft(draft)
    const log = await service.diagnostics()
    expect(log).not.toContain('recipient@example.com')
    expect(log).not.toContain('disposable')
    expect(log).not.toContain('Hello')
  })
})
describe('untrusted message resource boundaries', () => {
  it('rejects local and reserved IP ranges, including mapped IPv6', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      '2001:db8::1',
    ])
      expect(publicAddress(address)).toBe(false)
    expect(publicAddress('8.8.8.8')).toBe(true)
    await expect(publicFetch('http://127.0.0.1/image')).rejects.toThrow('Private network')
  })
})
