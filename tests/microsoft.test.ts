import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createServer as createTlsServer, type TLSSocket } from 'node:tls'
import type { AddressInfo } from 'node:net'
import { SMTPServer } from 'smtp-server'
import {
  ProviderError,
  isMicrosoftAutodiscover,
  isMicrosoftMailHost,
  isMicrosoftPersonalHost,
  isMicrosoftSmtpDisabled,
  microsoftCandidate,
  microsoftGraphMessageLimit,
  microsoftImapError,
  microsoftMx,
  type OutgoingMessage,
} from '@inlark/core'
import {
  ImapFlowPort,
  connectionError,
  graphSizeProblem,
  imapFlowOptions,
  submitGraph,
  submitSmtp,
  verifyGraph,
  verifySmtp,
  withBcc,
  type SmtpSettings,
} from '../packages/imap/src'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url))
const ca = fixture('ca.crt')
const trusted = { key: fixture('server.key'), cert: fixture('server.crt') }
const closers: (() => Promise<void> | void)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as ProviderError,
  )
  expect(error, 'expected a failure').toBeInstanceOf(ProviderError)
  return error!
}

describe('recognizing Microsoft', () => {
  it('knows Microsoft’s mail servers, and nothing that only resembles them', () => {
    for (const host of [
      'outlook.office365.com',
      'OUTLOOK.Office365.com.',
      ' smtp-mail.outlook.com ',
      'smtp.office365.com',
      'imap-mail.outlook.com',
    ])
      expect(isMicrosoftMailHost(host), host).toBe(true)
    for (const host of [
      'outlook.office365.com.evil.example',
      'evil-outlook.office365.com',
      'office365.com',
      'outlook.com',
      'smtp.gmail.com',
      '',
    ])
      expect(isMicrosoftMailHost(host), host).toBe(false)
    expect(isMicrosoftPersonalHost('smtp-mail.outlook.com')).toBe(true)
    expect(isMicrosoftPersonalHost('smtp.office365.com')).toBe(false)
  })

  it('tells personal mail exchangers from an organization’s', () => {
    expect(microsoftMx('outlook-com.olc.protection.outlook.com.')).toBe('personal')
    expect(microsoftMx('hotmail-com.olc.protection.outlook.com')).toBe('personal')
    expect(microsoftMx('contoso-com.mail.protection.outlook.com')).toBe('work')
    expect(microsoftMx('contoso-com.o-v1.mx.microsoft')).toBe('work')
    for (const host of [
      'protection.outlook.com.evil.example',
      'mx.microsoft.evil.example',
      'notprotection.outlook.com',
      'mx.example.net',
    ])
      expect(microsoftMx(host), host).toBeUndefined()
  })

  it('recognizes where Microsoft 365 domains point their mail apps', () => {
    expect(isMicrosoftAutodiscover('autodiscover.outlook.com.')).toBe(true)
    expect(isMicrosoftAutodiscover('autodiscover-s.outlook.com')).toBe(true)
    expect(isMicrosoftAutodiscover('autodiscover.outlook.com.evil.example')).toBe(false)
    expect(isMicrosoftAutodiscover('autodiscover.example.com')).toBe(false)
  })

  it('fills in Microsoft’s servers, which differ only in how personal accounts send', () => {
    const personal = microsoftCandidate('me@hotmail.com', 'mx', 'personal')
    const work = microsoftCandidate('me@contoso.com', 'cname', 'work')
    expect(personal).toMatchObject({
      provider: 'Outlook.com',
      incoming: { host: 'outlook.office365.com', port: 993, security: 'tls' },
      outgoing: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' },
    })
    expect(work).toMatchObject({
      provider: 'Microsoft 365',
      source: 'cname',
      incoming: { host: 'outlook.office365.com', username: 'me@contoso.com' },
      outgoing: { host: 'smtp.office365.com', port: 587, security: 'starttls' },
    })
    for (const server of [personal, work].flatMap((c) =>
      c.protocol === 'imap' ? [c.incoming, c.outgoing] : [],
    ))
      expect(isMicrosoftMailHost(server.host)).toBe(true)
  })
})

describe('what Microsoft’s servers say', () => {
  it('reads a switched-off IMAP mailbox as a setting to change, not a failed sign-in', () => {
    // Exactly what outlook.office365.com answered a valid token for a mailbox with IMAP off.
    const off = microsoftImapError('User is authenticated but not connected.', true)
    expect(off.code).toBe('imapDisabled')
    expect(off.message).toContain('Let devices and apps use IMAP')
    const refused = microsoftImapError('AUTHENTICATE failed.', true)
    expect(refused.code).toBe('authentication')
    expect(refused.message).toMatch(/Sign in with Microsoft again/)
    expect(microsoftImapError(undefined, false).message).toMatch(/doesn’t accept a password/)
  })

  it('maps a refused login by host and by how it signed in', () => {
    const refusal = {
      authenticationFailed: true,
      response: 'User is authenticated but not connected.',
    }
    expect(connectionError(refusal, { host: 'outlook.office365.com' }, true).code).toBe(
      'imapDisabled',
    )
    // Another server saying the same words is only a failed login.
    expect(connectionError(refusal, { host: 'mail.example.com' }, true)).toMatchObject({
      code: 'authentication',
      message: expect.stringMatching(/Sign in again/),
    })
    expect(
      connectionError({ authenticationFailed: true }, { host: 'outlook.office365.com' }).message,
    ).toMatch(/Sign in with Microsoft instead/)
    expect(
      connectionError({ authenticationFailed: true }, { host: 'mail.example.com' }).message,
    ).toMatch(/username and password/)
  })

  it('recognizes SMTP being switched off for a mailbox or a whole organization', () => {
    // Exactly what smtp-mail.outlook.com answered a valid token for such a mailbox.
    expect(
      isMicrosoftSmtpDisabled(
        '535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox. Visit https://aka.ms/smtp_auth_disabled for more information.',
      ),
    ).toBe(true)
    expect(
      isMicrosoftSmtpDisabled(
        '535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.',
      ),
    ).toBe(true)
    expect(isMicrosoftSmtpDisabled('535 5.7.3 Authentication unsuccessful')).toBe(false)
    expect(isMicrosoftSmtpDisabled(undefined)).toBe(false)
  })
})

/** A server that speaks just enough IMAP for a login, and records what the client presented. */
async function imapServer(accept: (user: string, token: string) => string) {
  const presented: { user: string; token: string }[] = []
  const sockets = new Set<TLSSocket>()
  const server = createTlsServer(trusted, (socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.write('* OK ready\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let at: number
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const [tag, command, ...rest] = line.split(' ')
        if (/^CAPABILITY$/i.test(command))
          socket.write(`* CAPABILITY IMAP4rev1 AUTH=XOAUTH2 SASL-IR\r\n${tag} OK done\r\n`)
        else if (/^AUTHENTICATE$/i.test(command)) {
          const fields = Buffer.from(rest[1] || '', 'base64')
            .toString('utf8')
            .split('\x01')
          const user = fields[0]?.replace(/^user=/, '') ?? ''
          const token = fields[1]?.replace(/^auth=Bearer /, '') ?? ''
          presented.push({ user, token })
          socket.write(`${tag} ${accept(user, token)}\r\n`)
        } else if (/^LOGOUT$/i.test(command)) {
          socket.write(`* BYE\r\n${tag} OK done\r\n`)
          socket.end()
        } else socket.write(`${tag} OK done\r\n`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => {
    for (const socket of sockets) socket.destroy()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return { port: (server.address() as AddressInfo).port, presented }
}

describe('IMAP sign-in with an access token', () => {
  const incoming = (port: number) => ({
    host: '127.0.0.1',
    port,
    security: 'tls' as const,
    username: 'me@outlook.com',
    timeoutMs: 3000,
    tls: { ca },
  })

  it('presents the token in place of a password', () => {
    const options = imapFlowOptions({ ...incoming(993), password: 'unused' }, 'command', 'tok')
    expect(options.auth).toEqual({ user: 'me@outlook.com', accessToken: 'tok' })
    expect(imapFlowOptions({ ...incoming(993), password: 'secret' }, 'command').auth).toEqual({
      user: 'me@outlook.com',
      pass: 'secret',
    })
  })

  it('fetches a token for each connection and signs in with XOAUTH2', async () => {
    const server = await imapServer((_user, token) =>
      token === 'fresh-token' ? 'OK AUTHENTICATE completed.' : 'NO AUTHENTICATE failed.',
    )
    const accessToken = vi.fn(async () => 'fresh-token')
    const port = new ImapFlowPort({ ...incoming(server.port), accessToken }, 'command')
    // Listeners are registered before the connection, and so before the token, exists.
    const closed = vi.fn()
    port.on('close', closed)
    expect(port.capabilities.size).toBe(0)
    await port.connect()
    expect(accessToken).toHaveBeenCalledTimes(1)
    expect(server.presented).toEqual([{ user: 'me@outlook.com', token: 'fresh-token' }])
    expect(port.capabilities.has('AUTH=XOAUTH2')).toBe(true)
    await port.close()
    await vi.waitFor(() => expect(closed).toHaveBeenCalled())
  })

  it('takes a folder role the server marks without announcing the extension as declared', async () => {
    const port = new ImapFlowPort({ ...incoming(993), password: 'x' }, 'command')
    const entry = (path: string, flags: string[], specialUse?: string, source?: string) => ({
      path,
      name: path,
      delimiter: '/',
      parentPath: '',
      flags: new Set(flags),
      ...(specialUse ? { specialUse, specialUseSource: source } : {}),
    })
    // What outlook.office365.com lists: marks on four folders, and no SPECIAL-USE capability,
    // so ImapFlow calls every role a guess from the name.
    vi.spyOn((port as any).client, 'list').mockResolvedValue([
      entry('INBOX', ['\\Marked', '\\HasNoChildren']),
      entry('Sent', ['\\HasNoChildren', '\\Sent'], '\\Sent', 'name'),
      entry('Deleted', ['\\HasNoChildren', '\\TRASH'], '\\Trash', 'name'),
      entry('Archive', ['\\HasNoChildren'], '\\Archive', 'name'),
      entry('Notes', ['\\HasNoChildren']),
      entry('Starred', ['\\Flagged'], '\\Flagged', 'extension'),
    ])
    const listed = Object.fromEntries(
      (await port.list()).map((f) => [f.path, [f.specialUse, f.guessedSpecialUse]]),
    )
    expect(listed).toEqual({
      INBOX: [null, null],
      Sent: ['\\Sent', '\\Sent'],
      Deleted: ['\\Trash', '\\Trash'],
      // Named like an archive, but not marked: still a guess to confirm.
      Archive: [null, '\\Archive'],
      Notes: [null, null],
      Starred: ['\\Flagged', null],
    })
  })

  it('reports a refused token as a sign-in to repeat, without the token', async () => {
    const server = await imapServer(() => 'NO AUTHENTICATE failed.')
    const port = new ImapFlowPort(
      { ...incoming(server.port), accessToken: async () => 'stale-token' },
      'command',
    )
    const error = await failure(port.connect())
    expect(error.code).toBe('authentication')
    expect(error.message).toMatch(/Sign in again/)
    expect(error.message).not.toContain('stale-token')
    await port.close()
  })

  it('passes on why a token could not be fetched, before connecting at all', async () => {
    const server = await imapServer(() => 'OK')
    const port = new ImapFlowPort(
      {
        ...incoming(server.port),
        accessToken: async () => {
          throw new ProviderError('authentication', 'Sign in with Microsoft again.')
        },
      },
      'command',
    )
    expect((await failure(port.connect())).message).toBe('Sign in with Microsoft again.')
    expect(server.presented).toEqual([])
  })
})

async function smtpServer(
  onAuth: (token: string, user: string) => Error | undefined,
  methods = ['XOAUTH2'],
) {
  const log = { auth: [] as { method: string; user: string; token: string }[], data: 0 }
  const server = new SMTPServer({
    logger: false,
    disableReverseLookup: true,
    closeTimeout: 10,
    secure: true,
    authMethods: methods,
    ...trusted,
    onAuth(auth, _session, callback) {
      const token = (auth as { accessToken?: string }).accessToken ?? ''
      log.auth.push({ method: auth.method, user: auth.username ?? '', token })
      const refused = onAuth(token, auth.username ?? '')
      if (refused) callback(refused)
      else callback(null, { user: auth.username })
    },
    onData(stream, _session, callback) {
      stream.on('data', () => undefined)
      stream.on('end', () => {
        log.data++
        callback(null, 'Queued')
      })
    },
  })
  server.on('error', () => undefined)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { port: (server.server.address() as AddressInfo).port, log }
}
const outgoing = (port: number, overrides: Partial<SmtpSettings> = {}): SmtpSettings => ({
  host: '127.0.0.1',
  port,
  security: 'tls',
  username: 'me@outlook.com',
  accessToken: async () => 'send-token',
  timeoutMs: 3000,
  tls: { ca },
  ...overrides,
})
const mime = new TextEncoder().encode(
  'From: me@outlook.com\r\nTo: you@example.test\r\nSubject: Hi\r\nMessage-ID: <m1@outlook.com>\r\n\r\nHello\r\n',
)
const envelope = { from: 'me@outlook.com', to: ['you@example.test'] }

describe('SMTP sign-in with an access token', () => {
  it('signs in with XOAUTH2 and sends', async () => {
    const server = await smtpServer((token) =>
      token === 'send-token' ? undefined : new Error('Invalid token'),
    )
    await verifySmtp(outgoing(server.port))
    const outcome = await submitSmtp(outgoing(server.port), envelope, mime)
    expect(outcome).toEqual({ accepted: ['you@example.test'], rejected: [] })
    expect(server.log.auth).toEqual([
      { method: 'XOAUTH2', user: 'me@outlook.com', token: 'send-token' },
      { method: 'XOAUTH2', user: 'me@outlook.com', token: 'send-token' },
    ])
    expect(server.log.data).toBe(1)
  })

  it('tells SMTP being switched off for the mailbox apart from a refused sign-in', async () => {
    const off = await smtpServer(() =>
      Object.assign(
        new Error(
          '5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox. Visit https://aka.ms/smtp_auth_disabled for more information.',
        ),
        { responseCode: 535 },
      ),
    )
    const disabled = await failure(submitSmtp(outgoing(off.port), envelope, mime))
    expect(disabled.code).toBe('outgoingDisabled')
    expect(off.log.data).toBe(0)
    const refusing = await smtpServer(() =>
      Object.assign(new Error('5.7.3 Authentication unsuccessful'), { responseCode: 535 }),
    )
    const refused = await failure(verifySmtp(outgoing(refusing.port)))
    expect(refused.code).toBe('outgoingAuthentication')
    expect(refused.message).toMatch(/Sign in again/)
    expect(refused.message).not.toContain('send-token')
  })

  it('never falls back to another way of signing in', async () => {
    const server = await smtpServer(() => undefined, ['PLAIN', 'LOGIN'])
    const error = await failure(verifySmtp(outgoing(server.port, { password: 'a password' })))
    expect(error.code).toBe('outgoingNetwork')
    expect(server.log.auth).toEqual([])
  })

  it('treats an unreachable sign-in service as a sending problem, and an ended sign-in as itself', async () => {
    const server = await smtpServer(() => undefined)
    const offline = await failure(
      verifySmtp(
        outgoing(server.port, {
          accessToken: async () => {
            throw new ProviderError('network', 'Microsoft’s sign-in service couldn’t be reached.')
          },
        }),
      ),
    )
    expect(offline.code).toBe('outgoingNetwork')
    const ended = await failure(
      verifySmtp(
        outgoing(server.port, {
          accessToken: async () => {
            throw new ProviderError('authentication', 'Sign in with Microsoft again.')
          },
        }),
      ),
    )
    expect(ended.code).toBe('authentication')
    expect(server.log.auth).toEqual([])
  })
})

describe('sending through Microsoft Graph', () => {
  const message: OutgoingMessage = { messageId: 'm1@outlook.com', mime, envelope }
  const token = async () => 'graph-token'
  const reply = (status: number, body?: unknown) =>
    vi.fn(async (_url: unknown, _init?: RequestInit) =>
      body === undefined
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), { status }),
    )
  const sent = (fetch: ReturnType<typeof reply>) =>
    Buffer.from(String(fetch.mock.calls[0][1]!.body), 'base64').toString('utf8')

  it('hands Microsoft the exact message, as text, with the token', async () => {
    const fetch = reply(202)
    const outcome = await submitGraph(token, message, { fetch: fetch as never })
    expect(outcome).toEqual({ accepted: ['you@example.test'], rejected: [] })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer graph-token', 'content-type': 'text/plain' },
      redirect: 'error',
    })
    expect(sent(fetch)).toBe(new TextDecoder().decode(mime))
  })

  it('names hidden recipients in a Bcc header, since Graph has no envelope', async () => {
    const fetch = reply(202)
    const hidden = ['secret@example.net', 'other@example.net']
    const outcome = await submitGraph(
      token,
      { ...message, envelope: { ...envelope, to: [...envelope.to, ...hidden], bcc: hidden } },
      { fetch: fetch as never },
    )
    expect(outcome.accepted).toEqual(['you@example.test', ...hidden])
    expect(sent(fetch)).toBe(
      'Bcc: secret@example.net,\r\n other@example.net\r\n' + new TextDecoder().decode(mime),
    )
    expect(withBcc(mime)).toBe(mime)
    expect(withBcc(mime, [])).toBe(mime)
  })

  it('refuses a message Graph cannot take before contacting Microsoft', async () => {
    const fetch = reply(202)
    const large = new Uint8Array(microsoftGraphMessageLimit + 1)
    const error = await failure(
      submitGraph(token, { ...message, mime: large }, { fetch: fetch as never }),
    )
    expect(error.code).toBe('submissionRejected')
    expect(error.message).toMatch(/2\.9 MB/)
    expect(error.message).toMatch(/Nothing was sent/)
    expect(fetch).not.toHaveBeenCalled()
    expect(graphSizeProblem(microsoftGraphMessageLimit)).toBeUndefined()
  })

  it('says nothing was sent only when Microsoft said so', async () => {
    const refusal = {
      error: { code: 'ErrorInvalidRecipients', message: 'At least one recipient is not valid.' },
    }
    const cases: [number, unknown, string][] = [
      [400, refusal, 'submissionRejected'],
      [
        403,
        { error: { code: 'ErrorSendAsDenied', message: 'Not allowed.' } },
        'submissionRejected',
      ],
      [413, undefined, 'submissionRejected'],
      [401, undefined, 'outgoingAuthentication'],
      [429, undefined, 'outgoingNetwork'],
      [503, undefined, 'outgoingNetwork'],
      [500, undefined, 'submissionUncertain'],
      [504, undefined, 'submissionUncertain'],
    ]
    for (const [status, body, code] of cases) {
      const error = await failure(
        submitGraph(token, message, { fetch: reply(status, body) as never }),
      )
      expect(error.code, String(status)).toBe(code)
      expect(error.message).not.toContain('graph-token')
    }
    const said = await failure(submitGraph(token, message, { fetch: reply(400, refusal) as never }))
    expect(said.message).toContain('“At least one recipient is not valid.”')
  })

  it('is uncertain when the connection ends mid-request, but not when it never began', async () => {
    const dropped = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    })
    expect((await failure(submitGraph(token, message, { fetch: dropped as never }))).code).toBe(
      'submissionUncertain',
    )
    for (const cause of [{ code: 'ENOTFOUND' }, { code: 'ECONNREFUSED' }]) {
      const never = vi.fn(async () => {
        throw new TypeError('fetch failed', { cause })
      })
      expect((await failure(submitGraph(token, message, { fetch: never as never }))).code).toBe(
        'outgoingNetwork',
      )
    }
    const chromium = vi.fn(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    expect((await failure(submitGraph(token, message, { fetch: chromium as never }))).code).toBe(
      'outgoingNetwork',
    )
  })

  it('checks that sending is allowed without sending anything', async () => {
    const accepted = reply(400, {
      error: {
        code: 'ErrorMimeContentInvalidBase64String',
        message: 'Invalid base64 string for MIME content.',
      },
    })
    await verifyGraph(token, { fetch: accepted as never })
    // Not base64, so Microsoft cannot take it for a message.
    expect(accepted.mock.calls[0][1]!.body).toBe('!')
    const denied = await failure(
      verifyGraph(token, {
        fetch: reply(403, { error: { message: 'Access is denied.' } }) as never,
      }),
    )
    expect(denied.code).toBe('outgoingAuthentication')
    expect((await failure(verifyGraph(token, { fetch: reply(500) as never }))).code).toBe(
      'outgoingNetwork',
    )
    const ended = await failure(
      verifyGraph(async () => {
        throw new ProviderError('outgoingAuthentication', 'Microsoft doesn’t let inlark send.')
      }),
    )
    expect(ended.code).toBe('outgoingAuthentication')
  })

  it('counts only Microsoft’s documented answer as proof that sending is allowed', async () => {
    // Any other refusal with the same status says nothing about the sign-in.
    for (const body of [
      { error: { code: 'BadRequest', message: 'Resource not found for the segment.' } },
      { error: { code: 'ErrorInvalidRequest' } },
      undefined,
    ]) {
      const error = await failure(verifyGraph(token, { fetch: reply(400, body) as never }))
      expect(error.code).toBe('outgoingNetwork')
    }
  })

  /** A reply whose headers arrive and whose body then stalls, as a broken proxy can produce. */
  const stalled = (status: number, start = '', deaf = false, cancelling = false) => {
    const reply = { cancelled: false, response: undefined as Response | undefined }
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (start) controller.enqueue(new TextEncoder().encode(start))
          // A `deaf` body doesn't even end when the request is abandoned.
          if (!deaf)
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
        },
        cancel() {
          reply.cancelled = true
          // `cancelling`: being cancelled never finishes either.
          if (cancelling) return new Promise<void>(() => {})
        },
      })
      return (reply.response = new Response(body, { status }))
    })
    return Object.assign(fetch, { reply })
  }

  it('never waits past its deadline for the rest of a reply', async () => {
    const within = async (promise: Promise<unknown>) => {
      const started = Date.now()
      const error = await failure(
        Promise.race([
          promise,
          new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2000)),
        ]),
      )
      expect(Date.now() - started).toBeLessThan(1500)
      return error.code
    }
    // The status alone decides what happened; only Microsoft's wording is lost.
    expect(
      await within(submitGraph(token, message, { fetch: stalled(401) as never, timeoutMs: 40 })),
    ).toBe('outgoingAuthentication')
    expect(
      await within(
        submitGraph(token, message, { fetch: stalled(403, '{"error":') as never, timeoutMs: 40 }),
      ),
    ).toBe('submissionRejected')
    expect(
      await within(submitGraph(token, message, { fetch: stalled(500) as never, timeoutMs: 40 })),
    ).toBe('submissionUncertain')
    // A body that ignores the deadline is let go of as well, not left open behind the result.
    const deaf = stalled(401, '', true)
    expect(await within(submitGraph(token, message, { fetch: deaf as never, timeoutMs: 40 }))).toBe(
      'outgoingAuthentication',
    )
    await vi.waitFor(() => expect(deaf.reply.cancelled).toBe(true))
    await vi.waitFor(() => expect(deaf.reply.response!.body!.locked).toBe(false))
    // Nor does it stay held by a cancellation that never finishes.
    const stuck = stalled(401, '', true, true)
    expect(
      await within(submitGraph(token, message, { fetch: stuck as never, timeoutMs: 40 })),
    ).toBe('outgoingAuthentication')
    expect(stuck.reply.cancelled).toBe(true)
    expect(stuck.reply.response!.body!.locked).toBe(false)
    // Without its code, a 400 doesn't prove that sending is allowed.
    expect(await within(verifyGraph(token, { fetch: stalled(400) as never, timeoutMs: 40 }))).toBe(
      'outgoingNetwork',
    )
    // The request itself never answering is as uncertain as a dropped connection.
    const silent = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    )
    expect(
      await within(submitGraph(token, message, { fetch: silent as never, timeoutMs: 40 })),
    ).toBe('submissionUncertain')
  })

  it('reads no more of a refusal than an explanation needs', async () => {
    const huge = vi.fn(
      async () =>
        new Response('{"error":{"message":"' + 'x'.repeat(200_000) + '"}}', { status: 400 }),
    )
    const error = await failure(submitGraph(token, message, { fetch: huge as never }))
    expect(error.code).toBe('submissionRejected')
    expect(error.message).toBe('Microsoft refused the message, so nothing was sent.')
    // A reply read to its end is released too.
    const complete = reply(400, { error: { code: 'ErrorInvalidRecipients', message: 'No.' } })
    await failure(submitGraph(token, message, { fetch: complete as never }))
    const answered = (await complete.mock.results[0].value) as Response
    await vi.waitFor(() => expect(answered.body!.locked).toBe(false))
    const garbled = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 }))
    expect((await failure(submitGraph(token, message, { fetch: garbled as never }))).code).toBe(
      'submissionUncertain',
    )
  })
})
