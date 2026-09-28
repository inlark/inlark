import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { SMTPServer, type SMTPServerOptions } from 'smtp-server'
import { composeMime } from '../packages/imap/src/mime'
import { smtpOptions, submitSmtp, verifySmtp, type SmtpSettings } from '../packages/imap/src/smtp'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url))
const ca = fixture('ca.crt')
const trusted = { key: fixture('server.key'), cert: fixture('server.crt') }
const untrusted = { key: fixture('untrusted.key'), cert: fixture('untrusted.crt') }
const password = 'correct horse battery'

type Handlers = Pick<SMTPServerOptions, 'onRcptTo' | 'onData' | 'onMailFrom'>
const servers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()))
})

async function start(options: Partial<SMTPServerOptions> = {}) {
  const log = {
    auth: [] as string[],
    names: [] as string[],
    mailFrom: [] as string[],
    rcptTo: [] as string[],
    data: [] as Buffer[],
  }
  const sockets = new Set<Socket>()
  const server = new SMTPServer({
    logger: false,
    disableReverseLookup: true,
    ...trusted,
    onAuth(auth, session, callback) {
      log.auth.push(auth.username ?? '')
      log.names.push(session.hostNameAppearsAs)
      if (auth.username === 'user' && auth.password === password) callback(null, { user: 'user' })
      else callback(new Error('Invalid username or password'))
    },
    onMailFrom(address, _session, callback) {
      log.mailFrom.push(address.address)
      callback()
    },
    onRcptTo(address, _session, callback) {
      log.rcptTo.push(address.address)
      if (address.address.startsWith('nobody@'))
        callback(Object.assign(new Error('No such user here'), { responseCode: 550 }))
      else callback()
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        log.data.push(Buffer.concat(chunks))
        callback(null, 'Queued as 1234')
      })
    },
    ...options,
  })
  // Clients that abort a TLS handshake surface as server errors; they are expected here.
  server.on('error', () => undefined)
  server.server.on('connection', (socket: Socket) => sockets.add(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.server.address() as AddressInfo).port
  servers.push(async () => {
    sockets.forEach((s) => s.destroy())
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return { port, log, sockets }
}

const settings = (port: number, overrides: Partial<SmtpSettings> = {}): SmtpSettings => ({
  host: '127.0.0.1',
  port,
  security: 'tls',
  username: 'user',
  password,
  timeoutMs: 3000,
  tls: { ca },
  ...overrides,
})
const message = (bcc: string[] = []) =>
  composeMime({
    from: { name: 'Me', email: 'me@example.test' },
    to: [{ name: 'You', email: 'you@example.test' }],
    cc: [],
    bcc: bcc.map((email) => ({ name: '', email })),
    subject: 'Hello',
    html: '<p>Hi</p>',
    text: 'Hi\n.a line starting with a dot\n',
    messageId: 'm1@example.test',
    attachments: [],
  })
const envelope = (to: string[] = ['you@example.test']) => ({ from: 'me@example.test', to })
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { code: string; message: string },
  )
  expect(error, 'expected a failure').toBeDefined()
  expect(error!.message).not.toContain(password)
  return error!
}
const finalReply = (responseCode: number): Handlers['onData'] =>
  function (stream, _session, callback) {
    stream.on('data', () => undefined)
    stream.on('end', () => callback(Object.assign(new Error('Not now'), { responseCode })))
  }

describe('SMTP submission', () => {
  it('submits over implicit TLS, transmitting exactly the given bytes', async () => {
    const { port, log } = await start({ secure: true })
    const mime = await message()
    const outcome = await submitSmtp(settings(port), envelope(), mime)
    expect(outcome).toEqual({ accepted: ['you@example.test'], rejected: [] })
    expect(log.mailFrom).toEqual(['me@example.test'])
    expect(log.data).toHaveLength(1)
    expect(new Uint8Array(log.data[0])).toEqual(mime)
    expect(log.names).toEqual(['[127.0.0.1]'])
  })

  it('submits over STARTTLS', async () => {
    const { port, log } = await start()
    const outcome = await submitSmtp(
      settings(port, { security: 'starttls' }),
      envelope(),
      await message(),
    )
    expect(outcome.accepted).toEqual(['you@example.test'])
    expect(log.auth).toEqual(['user'])
    await verifySmtp(settings(port, { security: 'starttls', host: 'localhost' }))
  })

  it('never signs in when STARTTLS is required but not offered', async () => {
    const { port, log } = await start({ hideSTARTTLS: true })
    const error = await failure(verifySmtp(settings(port, { security: 'starttls' })))
    expect(error.code).toBe('outgoingNetwork')
    expect(error.message).toMatch(/STARTTLS/)
    expect(log.auth).toEqual([])
    await failure(submitSmtp(settings(port, { security: 'starttls' }), envelope(), await message()))
    expect(log.auth).toEqual([])
    expect(log.mailFrom).toEqual([])
  })

  it('rejects an untrusted certificate before signing in', async () => {
    const tls = await start({ secure: true, ...untrusted })
    const error = await failure(verifySmtp(settings(tls.port)))
    expect(error).toMatchObject({ code: 'outgoingNetwork' })
    expect(error.message).toMatch(/certificate/)
    const starttls = await start({ ...untrusted })
    const upgrade = await failure(verifySmtp(settings(starttls.port, { security: 'starttls' })))
    expect(upgrade).toMatchObject({ code: 'outgoingNetwork' })
    expect(upgrade.message).toMatch(/certificate/)
    expect([...tls.log.auth, ...starttls.log.auth]).toEqual([])
  })

  it('reports a wrong password as an authentication failure', async () => {
    const { port, log } = await start({ secure: true })
    const error = await failure(verifySmtp(settings(port, { password: 'wrong' })))
    expect(error.code).toBe('outgoingAuthentication')
    const send = await failure(
      submitSmtp(settings(port, { password: 'wrong' }), envelope(), await message()),
    )
    expect(send.code).toBe('outgoingAuthentication')
    expect(log.mailFrom).toEqual([])
  })

  it('fails rather than sending unauthenticated when AUTH is not offered', async () => {
    const { port, log } = await start({
      secure: true,
      authOptional: true,
      disabledCommands: ['AUTH'],
    })
    const error = await failure(submitSmtp(settings(port), envelope(), await message()))
    expect(error.code).toBe('outgoingNetwork')
    expect(log.mailFrom).toEqual([])
  })

  it('reports an unreachable server as a network failure', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    const error = await failure(verifySmtp(settings(port)))
    expect(error.code).toBe('outgoingNetwork')
  })

  it('verifies without ever starting a message', async () => {
    const { port, log } = await start({ secure: true })
    await verifySmtp(settings(port))
    expect(log.auth).toEqual(['user'])
    expect(log.mailFrom).toEqual([])
    expect(log.rcptTo).toEqual([])
    expect(log.data).toEqual([])
  })

  it('treats a refused sender or every refused recipient as a definite rejection', async () => {
    const { port, log } = await start({ secure: true })
    const error = await failure(
      submitSmtp(
        settings(port),
        envelope(['nobody@example.test', 'nobody@other.test']),
        await message(),
      ),
    )
    expect(error.code).toBe('submissionRejected')
    expect(error.message).toMatch(/every recipient/)
    expect(log.data).toEqual([])

    const sender = await start({
      secure: true,
      onMailFrom: (_address, _session, callback) =>
        callback(Object.assign(new Error('Not your address'), { responseCode: 553 })),
    })
    const refused = await failure(submitSmtp(settings(sender.port), envelope(), await message()))
    expect(refused.code).toBe('submissionRejected')
    expect(refused.message).toMatch(/sender/)
    expect(sender.log.rcptTo).toEqual([])
  })

  it('reports partial acceptance with the rejected recipients and reasons', async () => {
    const { port, log } = await start({ secure: true })
    const outcome = await submitSmtp(
      settings(port),
      envelope(['you@example.test', 'nobody@example.test']),
      await message(),
    )
    expect(outcome.accepted).toEqual(['you@example.test'])
    expect(outcome.rejected).toEqual([
      { email: 'nobody@example.test', reason: expect.stringMatching(/550.*No such user/) },
    ])
    expect(log.data).toHaveLength(1)
  })

  it('delivers Bcc through the envelope only', async () => {
    const { port, log } = await start({ secure: true })
    const mime = await message(['secret@example.test'])
    await submitSmtp(settings(port), envelope(['you@example.test', 'secret@example.test']), mime)
    expect(log.rcptTo).toEqual(['you@example.test', 'secret@example.test'])
    const received = log.data[0].toString('latin1')
    expect(received).not.toMatch(/^Bcc:/im)
    expect(received).not.toContain('secret@example.test')
  })

  it('treats a lost final response as uncertain', async () => {
    const { port, log, sockets } = await start({
      secure: true,
      onData(stream) {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => {
          log.data.push(Buffer.concat(chunks))
          sockets.forEach((s) => s.destroy())
        })
      },
    })
    const error = await failure(submitSmtp(settings(port), envelope(), await message()))
    expect(error.code).toBe('submissionUncertain')
    expect(log.data).toHaveLength(1)
  })

  it('treats a missing final response as uncertain after the timeout', async () => {
    const { port } = await start({
      secure: true,
      onData: (stream) => stream.on('data', () => undefined),
    })
    const error = await failure(
      submitSmtp(settings(port, { timeoutMs: 500 }), envelope(), await message()),
    )
    expect(error.code).toBe('submissionUncertain')
  })

  it('treats 4xx and 5xx final responses as definite rejections', async () => {
    const temporary = await start({ secure: true, onData: finalReply(451) })
    const soft = await failure(submitSmtp(settings(temporary.port), envelope(), await message()))
    expect(soft.code).toBe('submissionRejected')
    expect(soft.message).toMatch(/temporarily/)
    const permanent = await start({ secure: true, onData: finalReply(554) })
    const hard = await failure(submitSmtp(settings(permanent.port), envelope(), await message()))
    expect(hard.code).toBe('submissionRejected')
    expect(hard.message).not.toMatch(/temporarily/)
    expect(hard.message).toMatch(/554/)
  })

  it('rejects an unusable envelope without connecting', async () => {
    const { port, log } = await start({ secure: true })
    for (const to of [[], ['bad address@example.test'], ['<x@example.test>']]) {
      const error = await failure(submitSmtp(settings(port), envelope(to), await message()))
      expect(error.code).toBe('submissionRejected')
    }
    expect(log.auth).toEqual([])
  })

  it('enforces the TLS policy in the connection options', () => {
    const tls = smtpOptions(settings(465, { host: 'mail.example.test' }))
    expect(tls).toMatchObject({ secure: true, ignoreTLS: false, name: '[127.0.0.1]' })
    expect(tls.tls).toMatchObject({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      servername: 'mail.example.test',
    })
    const starttls = smtpOptions(settings(587, { security: 'starttls', tls: undefined }))
    expect(starttls).toMatchObject({
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      opportunisticTLS: false,
    })
    expect(starttls.tls).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' })
    expect(starttls.logger).toBe(false)
    expect(starttls.debug).toBe(false)
  })
})
