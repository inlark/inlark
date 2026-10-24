import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const desktop = vi.hoisted(() => ({
  value: '',
  supported: true,
  write: vi.fn(),
  read: vi.fn(),
  notices: [] as { title: string; body: string; handlers: Record<string, () => void> }[],
}))
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
  },
  dialog: {},
  shell: {},
  clipboard: { writeText: desktop.write, readText: desktop.read },
  Notification: class {
    static isSupported() {
      return desktop.supported
    }
    notice: (typeof desktop.notices)[number]
    constructor(options: { title: string; body: string }) {
      this.notice = { ...options, handlers: {} }
    }
    on(event: string, handler: () => void) {
      this.notice.handlers[event] = handler
      return this
    }
    show() {
      desktop.notices.push(this.notice)
    }
  },
}))
import { MailService } from '../apps/desktop/src/main/service'
import { JsonStore } from '../apps/desktop/src/main/storage'
import { JmapProvider } from '../packages/jmap/src'
import {
  conversationFromMessages,
  defaultSettings,
  settingsSchema,
  type Account,
  type AppEvent,
  type ConnectInput,
  type MailProvider,
  type Message,
  type ProviderEvent,
  type ProviderPage,
} from '../packages/core/src'

const account: Account = {
  id: 'account',
  connectionId: 'connection',
  remoteId: 'remote',
  name: 'Personal',
  email: 'me@example.com',
  color: '#aaa',
  status: 'connected',
}
const input = (protocol: 'imap' | 'jmap'): ConnectInput => ({
  connectionId: account.connectionId,
  name: account.name,
  password: 'test',
  remember: false,
  config:
    protocol === 'jmap'
      ? { protocol, serverUrl: 'https://mail.example', username: account.email }
      : {
          protocol,
          email: account.email,
          incoming: { host: 'mail.example', port: 993, security: 'tls', username: account.email },
          outgoing: { host: 'mail.example', port: 465, security: 'tls', username: account.email },
          outgoingSameCredentials: true,
        },
})
function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    accountId: account.id,
    threadId: id,
    subject: 'Your verification code',
    from: [{ name: 'Example', email: 'login@example.com' }],
    to: [],
    cc: [],
    bcc: [],
    replyTo: [],
    receivedAt: new Date().toISOString(),
    preview: '',
    keywords: {},
    mailboxIds: { inbox: true },
    size: 100,
    hasAttachment: false,
    text: 'Your verification code is: 012345',
    ...overrides,
  }
}
let service: MailService, directory: string, store: JsonStore
let events: AppEvent[], messages: Message[], listener: (event: ProviderEvent) => void
let query: ReturnType<typeof vi.fn<MailProvider['query']>>
let getMessages: ReturnType<typeof vi.fn<MailProvider['messages']>>
let provider: MailProvider
const tick = (ms = 1000) => vi.setSystemTime(Date.now() + ms)
const refresh = () => service.refreshConnection(account.connectionId)

describe.each(['imap', 'jmap'] as const)('automatic copying on %s arrival', (protocol) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    desktop.notices = []
    desktop.value = ''
    desktop.supported = true
    desktop.write.mockReset().mockImplementation(async (value: string) => {
      desktop.value = value
    })
    desktop.read.mockReset().mockImplementation(async () => desktop.value)
    events = []
    messages = []
    directory = await mkdtemp(join(tmpdir(), 'inlark-auth-copy-'))
    store = new JsonStore(directory)
    query = vi.fn(async (_account, _query, position = 0, limit = 25): Promise<ProviderPage> => {
      const threads = new Map<string, Message[]>()
      for (const m of messages.filter((m) => m.accountId === _account.id))
        threads.set(m.threadId, [...(threads.get(m.threadId) || []), m])
      const items = [...threads]
        .map(([id, list]) => conversationFromMessages(_account.id, id, list))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      return {
        items: items.slice(position, position + limit),
        total: items.length,
        next: position + limit < items.length ? position + limit : undefined,
      }
    })
    getMessages = vi.fn(async (a, ids) =>
      messages.filter((m) => m.accountId === a.id && ids.includes(m.id)),
    )
    provider = {
      connect: vi.fn(async () => [{ ...account }]),
      identities: vi.fn(async () => [
        { id: 'identity', accountId: account.id, email: account.email, name: 'Me' },
      ]),
      mailboxes: vi.fn(async () => [{ id: 'inbox', role: 'inbox', unreadEmails: 1 }]),
      query,
      messages: getMessages,
      conversation: vi.fn(async (_a, threadId) => messages.filter((m) => m.threadId === threadId)),
      rawMessage: vi.fn(async (_a, id) =>
        new TextEncoder().encode(
          'Content-Type: text/plain\r\n\r\n' + messages.find((m) => m.id === id)?.text,
        ),
      ),
      subscribe: vi.fn((callback) => {
        listener = callback
        return () => {}
      }),
      dispose: vi.fn(),
    } as unknown as MailProvider
    if (protocol === 'jmap') {
      for (const key of [
        'connect',
        'identities',
        'mailboxes',
        'query',
        'messages',
        'conversation',
        'rawMessage',
        'subscribe',
        'dispose',
      ] as const) {
        vi.spyOn(JmapProvider.prototype, key).mockImplementation(provider[key] as any)
      }
    }
    service = new MailService(store, (event) => events.push(event), { providers: () => provider })
    await service.init()
    await service.connect(input(protocol))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'changed')).toBe(true))
    tick()
  })
  afterEach(async () => {
    service.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('copies in the background by default, shows the exact value and opens the right message', async () => {
    messages = [message('new')]
    await refresh()
    expect(desktop.write).toHaveBeenCalledExactlyOnceWith('012345')
    expect(desktop.notices).toHaveLength(1)
    expect(desktop.notices[0]).toMatchObject({
      title: 'Verification code copied',
      body: '012345\nExample · Personal',
    })
    desktop.notices[0].handlers.click()
    expect(events).toContainEqual({ type: 'open', accountId: account.id, threadId: 'new' })
    expect(messages[0].keywords.$seen).toBeUndefined()
    expect(getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ id: account.id }),
      ['new'],
      true,
    )
  })
  it('copies password reset links without opening or requesting the URL', async () => {
    messages = [message('new', { text: 'Reset your password: https://example.com/?token=secret' })]
    await refresh()
    expect(desktop.value).toBe('https://example.com/?token=secret')
    expect(desktop.notices[0].title).toBe('Verification link copied')
  })
  it('does not repeat copying after synchronization or reconnect', async () => {
    messages = [message('new')]
    await refresh()
    await refresh()
    await service.reconnect(account.connectionId)
    await refresh()
    expect(desktop.write).toHaveBeenCalledTimes(1)
  })
  it('skips old mail, far-future dates, drafts, and messages outside the inbox', async () => {
    messages = [
      message('old', { receivedAt: new Date(Date.now() - 6 * 60_000).toISOString() }),
      message('future', { receivedAt: new Date(Date.now() + 10 * 60_000).toISOString() }),
      message('draft', { keywords: { $draft: true } }),
      message('archive', { mailboxIds: { archive: true } }),
    ]
    await refresh()
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('does not copy a code present at startup or after restarting', async () => {
    messages = [message('existing')]
    service.dispose()
    service = new MailService(store, (event) => events.push(event), { providers: () => provider })
    await service.init()
    await service.connect(input(protocol))
    await vi.waitFor(() => expect(query.mock.calls.length).toBeGreaterThan(1))
    await refresh()
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('detects distinct messages with the same received timestamp', async () => {
    messages = [message('first')]
    await refresh()
    messages.push(message('second', { text: 'Your verification code: 654321' }))
    await refresh()
    expect(desktop.value).toBe('654321')
    expect(desktop.write).toHaveBeenCalledTimes(2)
  })
  it('does not use an older code in a conversation when a reply arrives', async () => {
    messages = [message('old-code', { threadId: 'thread' })]
    await refresh()
    desktop.write.mockClear()
    tick()
    messages.push(message('reply', { threadId: 'thread', text: 'Thanks, this worked.' }))
    await refresh()
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('copies only the newest confidently detected value in a batch', async () => {
    messages = [message('older')]
    tick()
    messages.push(message('newer', { text: 'Your verification code: 654321' }))
    await refresh()
    expect(desktop.write).toHaveBeenCalledExactlyOnceWith('654321')
  })
  it('does not overwrite a newer code with a late older message', async () => {
    const earlier = new Date().toISOString()
    tick()
    messages = [message('newer')]
    await refresh()
    messages.push(message('late', { receivedAt: earlier, text: 'Your verification code: 654321' }))
    await refresh()
    expect(desktop.write).toHaveBeenCalledTimes(1)
  })
  it('checks beyond the first page of conversations after a burst of mail', async () => {
    messages = [message('code')]
    tick()
    messages.push(
      ...Array.from({ length: 30 }, (_, i) => message('normal-' + i, { text: 'Hello there' })),
    )
    await refresh()
    expect(desktop.value).toBe('012345')
    expect(query.mock.calls.some((call) => call[2] === 25)).toBe(true)
  })
  it('honors the opt-out, persists it, and does not replay skipped mail on re-enabling', async () => {
    await service.setSettings({ ...service.settings, autoCopyAuth: false })
    messages = [message('disabled')]
    await refresh()
    expect((await store.read('settings', defaultSettings)).autoCopyAuth).toBe(false)
    await service.setSettings({ ...service.settings, autoCopyAuth: true })
    await refresh()
    expect(desktop.write).not.toHaveBeenCalled()
    tick()
    messages.push(message('enabled'))
    await refresh()
    expect(desktop.write).toHaveBeenCalledTimes(1)
  })
  it('keeps copy confirmations independent of ordinary mail notifications', async () => {
    await service.setSettings({ ...service.settings, notifications: false })
    messages = [message('new')]
    await refresh()
    expect(desktop.notices[0].title).toBe('Verification code copied')
  })
  it('copies even on platforms without native notification support', async () => {
    desktop.supported = false
    messages = [message('new')]
    await refresh()
    expect(desktop.value).toBe('012345')
    expect(desktop.notices).toHaveLength(0)
  })
  it.each(['write', 'read'] as const)(
    'reports clipboard %s failure without claiming success or disconnecting',
    async (operation) => {
      desktop[operation].mockRejectedValueOnce(new Error('failure containing 012345'))
      messages = [message('new')]
      await refresh()
      expect(desktop.notices.some((n) => n.title === 'Verification code copied')).toBe(false)
      expect(desktop.notices[0].title).toBe('Couldn’t copy verification code')
      expect(service.accounts[0].status).toBe('connected')
      expect(await service.diagnostics()).not.toContain('012345')
    },
  )
  it('does not claim success if the OS clipboard did not accept the value', async () => {
    desktop.read.mockResolvedValueOnce('previous clipboard')
    messages = [message('new')]
    await refresh()
    expect(desktop.notices[0].title).toBe('Couldn’t copy verification code')
  })
  it('does not copy ambiguous values', async () => {
    messages = [
      message('ambiguous', {
        text: 'Your verification code: 012345\nYour verification code: 654321',
      }),
    ]
    await refresh()
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('does not copy on historical indexing events', async () => {
    const calls = query.mock.calls.length
    messages = [message('historical', { receivedAt: new Date(Date.now() - 60_000).toISOString() })]
    listener({ type: 'changed', accountId: account.id, historical: true })
    expect(query).toHaveBeenCalledTimes(calls)
    tick()
    await refresh()
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('keeps arrival deduplication separate for accounts with the same message IDs', async () => {
    const second = { ...account, id: 'second-account', name: 'Work' }
    vi.mocked(provider.connect).mockResolvedValueOnce([{ ...account }, second])
    const count = query.mock.calls.length
    await service.reconnect(account.connectionId)
    await vi.waitFor(() => expect(query.mock.calls.length).toBeGreaterThan(count + 1))
    tick()
    messages = [
      message('same-id'),
      message('same-id', { accountId: second.id, text: 'Your verification code: 654321' }),
    ]
    await refresh()
    expect(desktop.write).toHaveBeenCalledTimes(2)
    expect(desktop.value).toBe('654321')
    expect(
      desktop.notices.filter((n) => n.title === 'Verification code copied').map((n) => n.body),
    ).toEqual(['012345\nExample · Personal', '654321\nExample · Work'])
    await refresh()
    expect(desktop.write).toHaveBeenCalledTimes(2)
  })
  it('rechecks the setting after the body arrives', async () => {
    let resolve!: (messages: Message[]) => void
    getMessages.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    messages = [message('pending')]
    const pending = refresh()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await service.setSettings({ ...service.settings, autoCopyAuth: false })
    resolve(messages)
    await pending
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('does not let a slower account overwrite a newer code from another connection', async () => {
    const second = {
      ...account,
      id: 'second-account',
      connectionId: 'second-connection',
      name: 'Work',
    }
    vi.mocked(provider.connect).mockResolvedValueOnce([second])
    await service.connect({
      ...input(protocol),
      connectionId: second.connectionId,
      name: second.name,
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'changed' && e.accountId === second.id)).toBe(true),
    )
    tick()
    messages = [message('slow')]
    tick()
    messages.push(message('fast', { accountId: second.id, text: 'Your verification code: 654321' }))
    let resolve!: (messages: Message[]) => void
    getMessages.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const pending = refresh()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await service.refreshConnection(second.connectionId)
    resolve([messages[0]])
    await pending
    expect(desktop.write).toHaveBeenCalledExactlyOnceWith('654321')
  })
  it.each(['locked', 'missingKey', 'integrityFailure'] as const)(
    'withholds encrypted values when %s',
    async (state) => {
      vi.spyOn(service.encryption, 'read').mockImplementation(async (m) => ({
        ...m,
        security: { encrypted: true, state, signature: 'unknown', confirmed: false },
      }))
      messages = [message('encrypted')]
      await refresh()
      expect(desktop.write).not.toHaveBeenCalled()
      expect((await service.conversation(account.id, 'encrypted'))[0].authCandidate).toBeUndefined()
    },
  )
  it('extracts after normal decryption while the vault is unlocked', async () => {
    vi.spyOn(service.encryption, 'read').mockImplementation(async (m) => ({
      ...m,
      text: 'Your verification code: 654321',
      security: { encrypted: true, state: 'decrypted', signature: 'unsigned', confirmed: false },
    }))
    vi.spyOn(service.encryption.vault, 'unlocked', 'get').mockReturnValue(true)
    messages = [message('encrypted', { text: 'ciphertext' })]
    await refresh()
    expect(desktop.value).toBe('654321')
  })
  it('offers message-specific manual copying even when automatic copying is off', async () => {
    await service.setSettings({ ...service.settings, autoCopyAuth: false })
    messages = [
      message('first', { threadId: 'thread' }),
      message('second', { threadId: 'thread', text: 'Your code is: 654321' }),
    ]
    const read = await service.conversation(account.id, 'thread')
    expect(read.map((m) => m.authCandidate?.value)).toEqual(['012345', '654321'])
    expect(desktop.write).not.toHaveBeenCalled()
  })
  it('keeps extracted secrets out of local service data and diagnostics', async () => {
    messages = [message('new')]
    await refresh()
    expect(await service.diagnostics()).not.toContain('012345')
    for (const name of await readdir(directory))
      if (name.endsWith('.json')) {
        expect(await readFile(join(directory, name), 'utf8')).not.toContain('012345')
      }
  })
})

it('accepts legacy settings and enables copying by default', () => {
  const { autoCopyAuth: _, ...legacy } = defaultSettings
  expect(settingsSchema.parse(legacy).autoCopyAuth).toBeUndefined()
  expect(defaultSettings.autoCopyAuth).toBe(true)
  expect(settingsSchema.parse({ ...legacy, autoCopyAuth: false }).autoCopyAuth).toBe(false)
})
