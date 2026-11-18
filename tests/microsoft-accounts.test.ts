import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
import { MicrosoftAuth } from '../apps/desktop/src/main/microsoft-auth'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import { ImapProvider, type SubmissionFallback } from '../packages/imap/src'
import {
  ProviderError,
  accountSchema,
  microsoftGraphMessageLimit,
  microsoftSendLimit,
  type Account,
  type ConnectInput,
  type Draft,
  type ImapConnectionConfig,
  type OutgoingMessage,
  type SubmissionOutcome,
} from '../packages/core/src'
import { FakeImapServer } from './support/fake-imap'

const config: ImapConnectionConfig = {
  protocol: 'imap',
  email: 'me@outlook.com',
  incoming: {
    host: 'outlook.office365.com',
    port: 993,
    security: 'tls',
    username: 'me@outlook.com',
  },
  outgoing: {
    host: 'smtp-mail.outlook.com',
    port: 587,
    security: 'starttls',
    username: 'me@outlook.com',
  },
  outgoingSameCredentials: true,
}
const pem = readFileSync(new URL('./fixtures/tls/untrusted.crt', import.meta.url), 'utf8')
const smtpOff = () =>
  new ProviderError(
    'outgoingDisabled',
    'Microsoft has switched off sending over SMTP for this mailbox.',
  )
const accepted: SubmissionOutcome = { accepted: ['alex@example.org'], rejected: [] }
let directory: string
let server: FakeImapServer
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-microsoft-'))
  server = new FakeImapServer()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await rm(directory, { recursive: true, force: true })
})

describe('an account that signs in with a token', () => {
  const providers: ImapProvider[] = []
  afterEach(async () => {
    for (const p of providers.splice(0)) await p.close()
  })
  const smtp = () => ({
    submit: vi.fn<(...args: any[]) => Promise<SubmissionOutcome>>(async () => accepted),
    verify: vi.fn<(...args: any[]) => Promise<void>>(async () => {}),
  })
  const fallback = (active = false) => ({
    active,
    limit: microsoftSendLimit,
    verify: vi.fn(async () => {}),
    submit: vi.fn(async (_message: OutgoingMessage) => accepted),
    onChange: vi.fn(),
  })
  function provider(options: Partial<ConstructorParameters<typeof ImapProvider>[0]> = {}) {
    const p = new ImapProvider({
      connectionId: 'c1',
      name: 'Outlook',
      config,
      accessToken: async () => 'access-token',
      serverSentCopy: true,
      index: openInProcessIndex(join(directory, `index-${providers.length}.sqlite`)),
      readAttachment: async () => new Uint8Array(),
      background: false,
      ports: server.port,
      timing: { sentCopyGraceMs: 0, previews: 0 },
      ...options,
    })
    providers.push(p)
    return p
  }
  const message = (bytes = 200): OutgoingMessage => ({
    messageId: 'attempt@outlook.com',
    mime: new Uint8Array(bytes),
    envelope: { from: 'me@outlook.com', to: ['alex@example.org'] },
  })

  it('presents the token to both servers, under the account’s own login', async () => {
    const mail = smtp()
    const accessToken = vi.fn(async () => 'access-token')
    const p = provider({
      accessToken,
      smtp: mail,
      // A separate outgoing login makes no sense with one sign-in, so it is ignored.
      config: {
        ...config,
        outgoing: { ...config.outgoing, username: 'someone-else' },
        outgoingSameCredentials: false,
      },
    })
    const [account] = await p.connect()
    expect(server.tokens).toEqual(['access-token'])
    await p.verifyOutgoing()
    const settings = mail.verify.mock.calls[0][0]
    expect(settings).toMatchObject({ username: 'me@outlook.com', host: 'smtp-mail.outlook.com' })
    expect(settings.password).toBeUndefined()
    expect(await settings.accessToken()).toBe('access-token')
    expect(account.limits?.send).toBeUndefined()
  })

  it('refuses to connect with a token the server rejects', async () => {
    const p = provider({ accessToken: async () => 'stale' })
    await expect(p.connect()).rejects.toMatchObject({ code: 'authentication' })
  })

  it('checks the other way of sending once SMTP is switched off, and says so', async () => {
    const mail = smtp()
    mail.verify.mockRejectedValue(smtpOff())
    const other = fallback()
    const p = provider({ smtp: mail, fallback: other })
    await p.connect()
    await p.verifyOutgoing()
    expect(other.verify).toHaveBeenCalledTimes(1)
    expect(other.active).toBe(true)
    expect(other.onChange).toHaveBeenCalledWith(true)
    // The limit shows on the account from the next connection on.
    const [account] = await p.connect()
    expect(account.limits?.send).toEqual(microsoftSendLimit)
    // Asking the server again takes seconds and rarely changes anything.
    await p.verifyOutgoing()
    expect(mail.verify).toHaveBeenCalledTimes(1)
    expect(other.verify).toHaveBeenCalledTimes(2)
  })

  it('reports a mailbox that can send neither way', async () => {
    const mail = smtp()
    mail.verify.mockRejectedValue(smtpOff())
    const other = fallback()
    other.verify.mockRejectedValue(
      new ProviderError('outgoingAuthentication', 'Microsoft doesn’t let inlark send for it.'),
    )
    const p = provider({ smtp: mail, fallback: other })
    await p.connect()
    await expect(p.verifyOutgoing()).rejects.toMatchObject({ code: 'outgoingAuthentication' })
    expect(other.active).toBe(false)
    // Without another way, the refusal is the answer.
    const alone = provider({ smtp: mail })
    await alone.connect()
    await expect(alone.verifyOutgoing()).rejects.toMatchObject({ code: 'outgoingDisabled' })
  })

  it('sends the other way in the same attempt when SMTP refuses the mailbox', async () => {
    const mail = smtp()
    mail.submit.mockRejectedValue(smtpOff())
    const other = fallback()
    const p = provider({ smtp: mail, fallback: other })
    const [account] = await p.connect()
    const hidden = {
      ...message(),
      envelope: { ...message().envelope, bcc: ['secret@example.net'] },
    }
    expect(await p.submit(account, hidden)).toEqual(accepted)
    expect(other.submit).toHaveBeenCalledWith(hidden)
    // SMTP itself is never given the hidden recipients as anything but envelope addresses.
    expect(mail.submit.mock.calls[0][1]).toEqual({
      from: 'me@outlook.com',
      to: ['alex@example.org'],
    })
    expect(other.onChange).toHaveBeenCalledWith(true)
    await p.submit(account, message())
    expect(mail.submit).toHaveBeenCalledTimes(1)
    expect(other.submit).toHaveBeenCalledTimes(2)
  })

  it('does not send the other way after any other SMTP failure', async () => {
    const other = fallback()
    for (const error of [
      new ProviderError('submissionUncertain', 'It may have gone out.'),
      new ProviderError('submissionRejected', 'Refused.'),
      new ProviderError('outgoingAuthentication', 'Sign in again.'),
      new ProviderError('outgoingNetwork', 'Unreachable.'),
    ]) {
      const mail = smtp()
      mail.submit.mockRejectedValue(error)
      const p = provider({ smtp: mail, fallback: other })
      const [account] = await p.connect()
      await expect(p.submit(account, message())).rejects.toBe(error)
    }
    expect(other.submit).not.toHaveBeenCalled()
    expect(other.active).toBe(false)
  })

  it('asks SMTP again for a message too large to go the other way', async () => {
    const mail = smtp()
    const other = fallback(true)
    const p = provider({ smtp: mail, fallback: other })
    const [account] = await p.connect()
    const large = message(microsoftGraphMessageLimit + 1)
    // SMTP works again, so the limit is gone.
    expect(await p.submit(account, large)).toEqual(accepted)
    expect(other.submit).not.toHaveBeenCalled()
    expect(other.onChange).toHaveBeenLastCalledWith(false)
    expect(other.active).toBe(false)
    // Still refused: the other way gets to say why the message can't go.
    other.active = true
    mail.submit.mockRejectedValue(smtpOff())
    other.submit.mockRejectedValue(new ProviderError('submissionRejected', 'Too large.'))
    await expect(p.submit(account, large)).rejects.toMatchObject({ code: 'submissionRejected' })
  })

  it('files no Sent copy of its own, because the provider keeps one under another Message-ID', async () => {
    const p = provider({ smtp: smtp() })
    const [account] = await p.connect()
    expect(await p.fileSentCopy(account, message())).toBe('server')
    expect(server.box('Sent').messages).toHaveLength(0)
    expect(server.commands).not.toContain('APPEND')
  })
})

describe('the request to connect a Microsoft account', () => {
  const base = { config, name: 'Outlook', remember: true }
  it('needs a sign-in or a password, and Microsoft sign-in only over IMAP', () => {
    expect(accountSchema.safeParse({ ...base, microsoft: {} }).success).toBe(true)
    expect(
      accountSchema.safeParse({
        ...base,
        microsoft: { grant: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17' },
      }).success,
    ).toBe(true)
    expect(accountSchema.safeParse(base).success).toBe(false)
    expect(accountSchema.safeParse({ ...base, microsoft: { grant: 'not-an-id' } }).success).toBe(
      false,
    )
    expect(accountSchema.safeParse({ ...base, microsoft: { token: 'x' } }).success).toBe(false)
    expect(
      accountSchema.safeParse({
        config: { protocol: 'jmap', serverUrl: 'https://mail.example.com', username: 'me' },
        name: '',
        remember: true,
        microsoft: {},
      }).success,
    ).toBe(false)
    // A separate outgoing password is not asked of an account that signs in with Microsoft.
    expect(
      accountSchema.safeParse({
        ...base,
        config: { ...config, outgoingSameCredentials: false },
        microsoft: {},
      }).success,
    ).toBe(true)
  })
})

describe('Microsoft accounts in the mail service', () => {
  const personalDirectory = '9188040d-6c67-4c5b-b112-36a304b66dad'
  const idToken = (claims: Record<string, unknown>) =>
    ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.')
  const connectionId = 'outlook-connection'
  const accountId = JSON.stringify([connectionId, 'imap'])
  let service: MailService
  let store: JsonStore
  let auth: MicrosoftAuth
  let submit: ReturnType<typeof vi.fn<(...args: any[]) => Promise<SubmissionOutcome>>>
  let verify: ReturnType<typeof vi.fn<(...args: any[]) => Promise<void>>>
  let fallbacks: SubmissionFallback[]
  let inspect: ReturnType<typeof vi.fn<(...args: any[]) => Promise<undefined>>>
  /** What the token endpoint hands out next, and what it was asked. */
  let tokens: { identity: Record<string, unknown>; refused: boolean; requests: URLSearchParams[] }
  let issued: number
  let graph: ReturnType<typeof vi.fn<(...args: any[]) => Promise<Response>>>
  const tokenFetch = async (_url: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body))
    tokens.requests.push(body)
    if (tokens.refused) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    issued++
    return Response.json({
      // The fake mail server accepts exactly this one access token.
      access_token: 'access-token',
      refresh_token: `refresh-${issued}`,
      expires_in: 3600,
      id_token: idToken(tokens.identity),
    })
  }
  const factory: ProviderFactory = (options) => {
    if (options.fallback) fallbacks.push(options.fallback)
    return new ImapProvider({
      connectionId: options.connectionId,
      name: options.name,
      config: options.config as ImapConnectionConfig,
      password: options.secrets.password,
      accessToken: options.accessToken,
      fallback: options.fallback,
      serverSentCopy: options.serverSentCopy,
      folders: options.folders,
      index: openInProcessIndex(
        options.temporary ? ':memory:' : join(directory, options.connectionId + '.sqlite'),
      ),
      readAttachment: options.readAttachment,
      background: false,
      ports: server.port,
      smtp: { submit, verify },
      inspect: inspect as never,
      timing: { sentCopyGraceMs: 0, previews: 0 },
    })
  }
  async function start() {
    store = new JsonStore(directory)
    auth = new MicrosoftAuth({ open: async () => {}, fetch: tokenFetch as never })
    service = new MailService(store, () => {}, {
      providers: factory,
      microsoft: auth,
      fetch: graph as never,
    })
    await service.init()
  }
  /** A finished browser sign-in, as the window would hand it to the service. */
  async function signIn() {
    const started = await service.startMicrosoftSignIn('me@outlook.com')
    const finished = service.finishMicrosoftSignIn(started.id)
    const sent = new URL(started.url).searchParams
    await fetch(`${sent.get('redirect_uri')}?code=the-code&state=${sent.get('state')}`)
    const result = await finished
    if (!result.ok) throw new Error(result.message)
    return result
  }
  const input = (grant?: string): ConnectInput => ({
    config,
    name: 'Outlook',
    remember: true,
    connectionId,
    microsoft: grant ? { grant } : {},
  })
  const saved = async () =>
    JSON.parse(await readFile(join(directory, 'connections.json'), 'utf8')).data[0]
  const restart = async () => {
    service.dispose()
    await start()
  }
  const draft: Draft = {
    id: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17',
    accountId,
    identityId: 'default',
    to: [{ name: 'Alex', email: 'alex@example.org' }],
    cc: [],
    bcc: [],
    subject: 'Plans',
    html: '<p>Hello</p>',
    text: 'Hello',
    attachments: [],
    updatedAt: '2026-11-18T10:00:00.000Z',
    status: 'local',
  }
  beforeEach(async () => {
    tokens = {
      identity: { tid: personalDirectory, email: 'me@outlook.com' },
      refused: false,
      requests: [],
    }
    issued = 0
    fallbacks = []
    submit = vi.fn(async () => accepted)
    verify = vi.fn(async () => {})
    inspect = vi.fn(async () => undefined)
    graph = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.body === '!'
        ? Response.json({ error: { code: 'ErrorMimeContentInvalidBase64String' } }, { status: 400 })
        : new Response(null, { status: 202 }),
    )
    await start()
  })
  afterEach(() => service.dispose())

  it('connects with a browser sign-in and keeps only its long-lived token', async () => {
    const { grant, email, personal } = await signIn()
    expect({ email, personal }).toEqual({ email: 'me@outlook.com', personal: true })
    const test = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(test.incoming).toEqual({ ok: true })
    expect(test.outgoing).toEqual({ ok: true })
    const [account] = await service.connect(input(grant))
    expect(account).toMatchObject({ email: 'me@outlook.com', status: 'connected' })
    expect(server.tokens.every((token) => token === 'access-token')).toBe(true)
    const record = await saved()
    // Kept apart from the password fields, which an older build would send to a server.
    expect(record.secret).toBeUndefined()
    expect(record.localSecret).toBeUndefined()
    expect(record.microsoft).toEqual({ personal: true, localSecret: 'refresh-1' })
    expect(JSON.stringify(record)).not.toContain('access-token')
    expect(await service.connectionSettings(connectionId)).toMatchObject({
      remember: true,
      microsoft: true,
    })
    // The sign-in now belongs to the connection.
    expect(auth.grant(grant)).toBeUndefined()
  })

  it('gives both servers the account’s own login, whatever the request says', async () => {
    const { grant } = await signIn()
    await service.connect({
      ...input(grant),
      config: {
        ...config,
        outgoing: { ...config.outgoing, username: 'someone-else' },
        outgoingSameCredentials: false,
      },
    })
    expect((await saved()).config).toMatchObject({
      outgoing: { username: 'me@outlook.com' },
      outgoingSameCredentials: true,
    })
  })

  it('never presents a Microsoft token to a server that isn’t Microsoft’s', async () => {
    const { grant } = await signIn()
    const elsewhere = { ...config.outgoing, host: 'smtp.attacker.example' }
    for (const hostile of [
      { ...config, outgoing: elsewhere },
      { ...config, incoming: { ...config.incoming, host: 'imap.attacker.example' } },
      { ...config, outgoing: { ...config.outgoing, host: 'smtp.office365.com.attacker.example' } },
    ]) {
      await expect(
        service.testConnection({ ...input(grant), config: hostile, connectionId: undefined }),
      ).rejects.toThrow(/only works with Microsoft’s own mail servers/)
      await expect(service.connect({ ...input(grant), config: hostile })).rejects.toThrow(
        /only works with Microsoft’s own mail servers/,
      )
    }
    // Nothing was contacted, so nothing was presented anywhere.
    expect(server.tokens).toEqual([])
    expect(verify).not.toHaveBeenCalled()
    expect(service.accounts).toEqual([])
    // The same sign-in still connects to Microsoft's servers afterwards.
    await service.connect(input(grant))
    expect(service.accounts).toHaveLength(1)
  })

  it('never accepts a certificate trusted by hand for a Microsoft sign-in', async () => {
    const { grant } = await signIn()
    const certificate = { sha256: Array(32).fill('AB').join(':'), pem }
    const pinned = {
      ...config,
      incoming: { ...config.incoming, certificate },
      outgoing: { ...config.outgoing, certificate },
    }
    await service.connect({ ...input(grant), config: pinned })
    const record = await saved()
    expect(record.config.incoming.certificate).toBeUndefined()
    expect(record.config.outgoing.certificate).toBeUndefined()
    expect(verify.mock.calls[0][0].certificate).toBeUndefined()
    // A certificate that isn't publicly trusted is not offered for review either.
    verify.mockRejectedValue(new ProviderError('outgoingCertificate', 'Not trusted.'))
    inspect.mockResolvedValue({ sha256: certificate.sha256, pem } as never)
    const again = await signIn()
    const test = await service.testConnection({ ...input(again.grant), connectionId: undefined })
    expect(test.outgoing).toMatchObject({ ok: false })
    expect(test.outgoing).not.toHaveProperty('certificate')
    expect(test.outgoing?.error).toMatch(/isn’t publicly trusted/)
    expect(inspect).not.toHaveBeenCalled()
  })

  it('walks a personal mailbox with IMAP off through turning it on, without a new sign-in', async () => {
    const { grant } = await signIn()
    server.imapDisabled = true
    const off = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(off.incoming).toMatchObject({ ok: false, fix: 'outlookImap' })
    await expect(service.connect(input(grant))).rejects.toMatchObject({ code: 'imapDisabled' })
    expect(service.accounts).toEqual([])
    // The same sign-in works once the switch is on.
    server.imapDisabled = false
    const on = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(on.incoming).toEqual({ ok: true })
    await service.connect(input(grant))
    expect(
      tokens.requests.filter((r) => r.get('grant_type') === 'authorization_code'),
    ).toHaveLength(1)
  })

  it('tells a work mailbox with IMAP off to ask its administrator', async () => {
    tokens.identity = { tid: 'contoso-directory', preferred_username: 'me@outlook.com' }
    const { grant, personal } = await signIn()
    expect(personal).toBe(false)
    server.imapDisabled = true
    const test = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(test.incoming).toMatchObject({ ok: false, fix: 'microsoftImapAdmin' })
  })

  it('asks for a sign-in when there is none, and names the account when it is the wrong one', async () => {
    await expect(service.testConnection(input())).resolves.toMatchObject({
      incoming: { ok: false, fix: 'microsoftSignIn' },
    })
    await expect(service.connect(input())).rejects.toMatchObject({ code: 'authentication' })
    tokens.identity = { tid: personalDirectory, email: 'someone.else@outlook.com' }
    const { grant } = await signIn()
    // Microsoft refuses a mailbox to another account's token.
    server.accessToken = 'a-token-for-me'
    const test = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(test.incoming).toMatchObject({ ok: false, fix: 'microsoftSignIn' })
    expect(test.incoming.error).toBe(
      'Microsoft signed you in as someone.else@outlook.com, which isn’t me@outlook.com.',
    )
  })

  it('learns during the check that SMTP is off, and does not ask the server twice', async () => {
    verify.mockRejectedValue(smtpOff())
    const { grant } = await signIn()
    const test = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(test.outgoing).toMatchObject({ ok: true, note: expect.stringMatching(/another way/) })
    expect(verify).toHaveBeenCalledTimes(1)
    const [account] = await service.connect(input(grant))
    expect(verify).toHaveBeenCalledTimes(1)
    expect(account.limits?.send).toEqual(microsoftSendLimit)
    expect((await saved()).microsoft).toMatchObject({ graph: true })
    // Checking Graph sends "!", which is no message.
    expect(graph.mock.calls.every(([, init]) => init.body === '!')).toBe(true)
    expect(graph.mock.calls[0][1].headers.authorization).toBe('Bearer access-token')
  })

  it('reports a mailbox that Microsoft lets send neither way', async () => {
    verify.mockRejectedValue(smtpOff())
    graph.mockResolvedValue(
      Response.json({ error: { message: 'Access is denied.' } }, { status: 403 }),
    )
    const { grant } = await signIn()
    const test = await service.testConnection({ ...input(grant), connectionId: undefined })
    expect(test.incoming).toEqual({ ok: true })
    expect(test.outgoing).toMatchObject({ ok: false, fix: 'microsoftSignIn' })
    await expect(service.connect(input(grant))).rejects.toMatchObject({
      code: 'outgoingAuthentication',
    })
  })

  it('sends through Graph once SMTP refuses, remembers that, and files no second Sent copy', async () => {
    const { grant } = await signIn()
    await service.connect(input(grant))
    expect(service.accounts[0].limits?.send).toBeUndefined()
    submit.mockRejectedValue(smtpOff())
    const result = await service.send(draft)
    expect(result).toMatchObject({ status: 'sent', sentCopy: 'filed' })
    const sent = graph.mock.calls.find(([, init]) => init.body !== '!')!
    expect(sent[0]).toBe('https://graph.microsoft.com/v1.0/me/sendMail')
    const mime = Buffer.from(sent[1].body, 'base64').toString('utf8')
    expect(mime).toMatch(/^To: (Alex )?<?alex@example\.org>?/m)
    expect(mime).toMatch(/^Message-ID: <[^@>]+@outlook\.com>/m)
    expect(server.box('Sent').messages).toHaveLength(0)
    await vi.waitFor(async () => expect((await saved()).microsoft).toMatchObject({ graph: true }))
    expect(service.accounts[0].limits?.send).toEqual(microsoftSendLimit)
    // After a restart it goes straight to Graph, with the limit already showing.
    await restart()
    await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('connected'))
    expect(service.accounts[0].limits?.send).toEqual(microsoftSendLimit)
    expect(fallbacks.at(-1)!.active).toBe(true)
  })

  it('signs in again after a restart from the saved token, and saves the one that replaces it', async () => {
    const { grant } = await signIn()
    await service.connect(input(grant))
    await restart()
    await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('connected'))
    const renewal = tokens.requests.at(-1)!
    expect(Object.fromEntries(renewal)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
    })
    await vi.waitFor(async () =>
      expect((await saved()).microsoft).toEqual({ personal: true, localSecret: 'refresh-2' }),
    )
  })

  it('needs a new sign-in once Microsoft ends the saved one', async () => {
    const { grant } = await signIn()
    await service.connect(input(grant))
    tokens.refused = true
    await restart()
    await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('authentication'))
    expect(service.accounts[0].error).toMatch(/Sign in with Microsoft again/)
    const check = await service.testConnection(input())
    expect(check.incoming).toMatchObject({ ok: false, fix: 'microsoftSignIn' })
    // A new sign-in in the browser brings it back, under the same connection.
    tokens.refused = false
    const again = await signIn()
    const [account] = await service.connect(input(again.grant))
    expect(account.status).toBe('connected')
    expect(service.accounts).toHaveLength(1)
  })

  it('shows a mailbox whose IMAP was switched off as waiting for the user', async () => {
    const { grant } = await signIn()
    await service.connect(input(grant))
    server.imapDisabled = true
    await restart()
    await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('authentication'))
    expect(service.accounts[0].error).toMatch(/IMAP is switched off/)
    // Checking with the saved sign-in leads to the same steps as during setup.
    const check = await service.testConnection(input())
    expect(check.incoming).toMatchObject({ ok: false, fix: 'outlookImap' })
    server.imapDisabled = false
    await service.reconnect(connectionId)
    expect(service.accounts[0].status).toBe('connected')
  })

  it('keeps nothing on disk for a session-only login', async () => {
    const { grant } = await signIn()
    await service.connect({ ...input(grant), remember: false })
    const record = await saved()
    expect(record.microsoft).toEqual({ personal: true })
    expect(JSON.stringify(record)).not.toMatch(/refresh-\d/)
    expect(await service.connectionSettings(connectionId)).toMatchObject({
      remember: false,
      microsoft: true,
    })
    await restart()
    await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('authentication'))
    expect(await service.connectionSettings(connectionId)).not.toHaveProperty('microsoft')
  })

  it('says so when a build has no Microsoft sign-in', async () => {
    service.dispose()
    service = new MailService(new JsonStore(directory), () => {}, { providers: factory })
    await service.init()
    expect(() => service.startMicrosoftSignIn('me@outlook.com')).toThrow(/not available/)
    await expect(service.connect(input())).rejects.toThrow(/not available|Sign in with Microsoft/)
  })
})
