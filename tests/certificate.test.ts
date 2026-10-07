import { describe, it, expect, afterEach } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  createServer as createTcpServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net'
import { createServer as createTlsServer, createSecureContext, TLSSocket } from 'node:tls'
import { SMTPServer } from 'smtp-server'
import type { ServerSettings } from '../packages/core/src'
import { certificateOptions, inspectCertificate } from '../packages/imap/src/certificate'
import { ImapFlowPort } from '../packages/imap/src/imapflow-port'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url))
const ca = fixture('ca.crt')
const pair = (name: string) => ({ key: fixture(name + '.key'), cert: fixture(name + '.crt') })
const trust = (name: string) => {
  const pem = fixture(name + '.crt').toString()
  return { sha256: new X509Certificate(pem).fingerprint256, pem }
}
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})
const listen = async (server: Server, sockets: Set<Socket>) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(async () => {
    sockets.forEach((s) => s.destroy())
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return (server.address() as AddressInfo).port
}

/**
 * Just enough IMAP to sign in: every command succeeds. With `starttls` the session starts in
 * plain text and upgrades on request. Records each command name, never its arguments.
 */
async function imapServer(certificate: string, security: 'tls' | 'starttls') {
  const commands: string[] = []
  const sockets = new Set<Socket>()
  const context = createSecureContext(pair(certificate))
  const session = (socket: Socket, plain: boolean) => {
    sockets.add(socket)
    let buffer = ''
    const received = (chunk: Buffer) => {
      buffer += chunk.toString('latin1')
      for (let end = buffer.indexOf('\r\n'); end >= 0; end = buffer.indexOf('\r\n')) {
        const [tag, name = ''] = buffer.slice(0, end).split(' ')
        buffer = buffer.slice(end + 2)
        const command = name.toUpperCase()
        commands.push(command)
        if (command === 'STARTTLS' && plain) {
          socket.write(tag + ' OK Begin TLS\r\n')
          socket.off('data', received)
          sockets.delete(socket)
          const secure = new TLSSocket(socket, { isServer: true, secureContext: context })
          // A client that refuses the certificate ends the handshake; close this side too.
          secure.on('error', () => secure.destroy())
          return session(secure, false)
        }
        if (command === 'CAPABILITY')
          socket.write('* CAPABILITY IMAP4rev1' + (plain ? ' STARTTLS' : '') + '\r\n')
        socket.write(tag + ' OK Done\r\n')
        if (command === 'LOGOUT') socket.end()
      }
    }
    socket.on('data', received)
    socket.on('error', () => socket.destroy())
  }
  const greet = (socket: Socket, plain: boolean) => {
    socket.write('* OK [CAPABILITY IMAP4rev1' + (plain ? ' STARTTLS' : '') + '] Ready\r\n')
    session(socket, plain)
  }
  const server =
    security === 'tls'
      ? createTlsServer(pair(certificate), (socket) => greet(socket, false))
      : createTcpServer((socket) => greet(socket, true))
  server.on('tlsClientError', () => undefined)
  return { port: await listen(server, sockets), commands }
}

async function smtpServer(certificate: string) {
  const auth: string[] = []
  const server = new SMTPServer({
    logger: false,
    disableReverseLookup: true,
    closeTimeout: 10,
    ...pair(certificate),
    onAuth(credentials, _session, callback) {
      auth.push(credentials.username ?? '')
      callback(null, { user: credentials.username })
    },
  })
  server.on('error', () => undefined)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { port: (server.server.address() as AddressInfo).port, auth }
}

const server = (port: number, overrides: Partial<ServerSettings> = {}): ServerSettings => ({
  host: '127.0.0.1',
  port,
  security: 'tls',
  username: 'user',
  ...overrides,
})

describe('trusted certificates', () => {
  it('verifies the normal way unless a certificate is trusted', () => {
    expect(certificateOptions({ host: 'mail.example.test' })).toEqual({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    })
    const certificate = trust('untrusted')
    const options = certificateOptions({ host: '127.0.0.1', certificate }, ca)
    expect(options).toMatchObject({ rejectUnauthorized: true, allowPartialTrustChain: true })
    // The trusted certificate is added to the authorities, never in place of verification.
    expect(options.ca).toEqual([ca, certificate.pem])
    const peer = (name: string) => new X509Certificate(fixture(name + '.crt')).toLegacyObject()
    expect(options.checkServerIdentity!('127.0.0.1', peer('untrusted'))).toBeUndefined()
    expect(options.checkServerIdentity!('other.example.test', peer('untrusted'))).toBeUndefined()
    expect(options.checkServerIdentity!('other.example.test', peer('server'))).toBeInstanceOf(Error)
  })

  it('signs in to IMAP only with the certificate the user trusted', async () => {
    const { port, commands } = await imapServer('untrusted', 'tls')
    const settings = { ...server(port), password: 'secret', timeoutMs: 3000, tls: { ca } }
    const refused = new ImapFlowPort(settings, 'command')
    await expect(refused.connect()).rejects.toMatchObject({ code: 'certificate' })
    const changed = new ImapFlowPort({ ...settings, certificate: trust('server') }, 'command')
    await expect(changed.connect()).rejects.toMatchObject({
      code: 'certificate',
      message: expect.stringMatching(/different certificate than the one you trusted/),
    })
    expect(commands).toEqual([])
    const trusted = new ImapFlowPort({ ...settings, certificate: trust('untrusted') }, 'command')
    await trusted.connect()
    await trusted.close()
    expect(commands).toContain('LOGIN')
  })
})

describe('certificate inspection', () => {
  it('reads a self-signed certificate over implicit TLS', async () => {
    const { port, commands } = await imapServer('untrusted', 'tls')
    const certificate = await inspectCertificate(server(port), 'imap', { ca })
    expect(certificate).toMatchObject({
      problem: 'selfSigned',
      sha256: trust('untrusted').sha256,
      pem: trust('untrusted').pem,
      subject: 'localhost',
      issuer: 'localhost',
      names: ['localhost', '127.0.0.1'],
    })
    expect(Date.parse(certificate!.validTo)).toBeGreaterThan(Date.now())
    expect(commands).toEqual([])
  })

  it('upgrades IMAP and SMTP with STARTTLS without ever signing in', async () => {
    const imap = await imapServer('untrusted', 'starttls')
    const viaImap = await inspectCertificate(server(imap.port, { security: 'starttls' }), 'imap')
    expect(viaImap).toMatchObject({ problem: 'selfSigned', sha256: trust('untrusted').sha256 })
    expect(imap.commands).toEqual(['STARTTLS'])
    const smtp = await smtpServer('untrusted')
    const viaSmtp = await inspectCertificate(server(smtp.port, { security: 'starttls' }), 'smtp')
    expect(viaSmtp).toMatchObject({ problem: 'selfSigned', sha256: trust('untrusted').sha256 })
    expect(smtp.auth).toEqual([])
  })

  it('reports nothing for a certificate that would be accepted', async () => {
    const verified = await imapServer('server', 'tls')
    expect(await inspectCertificate(server(verified.port), 'imap', { ca })).toBeUndefined()
    const trusted = await imapServer('untrusted', 'tls')
    const settings = server(trusted.port, { certificate: trust('untrusted') })
    expect(await inspectCertificate(settings, 'imap', { ca })).toBeUndefined()
  })

  it('explains why a certificate is refused', async () => {
    const privateAuthority = await imapServer('server', 'tls')
    expect(await inspectCertificate(server(privateAuthority.port), 'imap')).toMatchObject({
      problem: 'unknownIssuer',
      subject: 'localhost',
      issuer: 'inlark Test CA',
    })
    const replaced = await imapServer('untrusted', 'tls')
    const settings = server(replaced.port, { certificate: trust('server') })
    expect(await inspectCertificate(settings, 'imap', { ca })).toMatchObject({ problem: 'changed' })
    const expired = await imapServer('expired', 'tls')
    // Even a trusted certificate stops working once it expires.
    const trustedExpired = server(expired.port, { certificate: trust('expired') })
    expect(await inspectCertificate(trustedExpired, 'imap', { ca })).toMatchObject({
      problem: 'expired',
      validTo: '2021-01-01T00:00:00.000Z',
    })
  })

  it('gives up quietly when no certificate can be read', async () => {
    const plain = await imapServer('untrusted', 'starttls')
    // A server that only speaks plain text on the implicit TLS port.
    expect(await inspectCertificate(server(plain.port), 'imap')).toBeUndefined()
    const closed = createTcpServer()
    const port = await listen(closed, new Set())
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    expect(await inspectCertificate(server(port), 'imap')).toBeUndefined()
    const silent = createTcpServer(() => undefined)
    const sockets = new Set<Socket>()
    silent.on('connection', (socket) => sockets.add(socket))
    const quiet = await listen(silent, sockets)
    const started = Date.now()
    expect(
      await inspectCertificate(server(quiet, { security: 'starttls' }), 'smtp', { timeoutMs: 200 }),
    ).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
