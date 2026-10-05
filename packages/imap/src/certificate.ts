import { X509Certificate } from 'node:crypto'
import { connect as connectTcp, isIP, type Socket } from 'node:net'
import {
  checkServerIdentity,
  connect as connectTls,
  getCACertificates,
  type ConnectionOptions,
  type TLSSocket,
} from 'node:tls'
import {
  ProviderError,
  type CertificateDetails,
  type CertificateProblem,
  type ServerSettings,
} from '@inlark/core'

type TrustSettings = Pick<ServerSettings, 'host' | 'certificate'>

/** Verification failures that trusting the presented certificate resolves. */
const trustable: Partial<Record<string, CertificateProblem>> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'selfSigned',
  SELF_SIGNED_CERT_IN_CHAIN: 'unknownIssuer',
  UNABLE_TO_GET_ISSUER_CERT: 'unknownIssuer',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'unknownIssuer',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'unknownIssuer',
  CERT_UNTRUSTED: 'unknownIssuer',
  ERR_TLS_CERT_ALTNAME_INVALID: 'otherName',
  HOSTNAME_MISMATCH: 'otherName',
}
/** Every certificate verification failure, as opposed to a failed TLS handshake. */
const certificateCodes = new Set([
  ...Object.keys(trustable),
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE',
  'CERT_CHAIN_TOO_LONG',
  'INVALID_CA',
  'INVALID_PURPOSE',
  'PATH_LENGTH_EXCEEDED',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
])
export const isCertificateFailure = (code?: string | null) => !!code && certificateCodes.has(code)

/** The name a certificate must match: an IPv6 address loses its brackets. */
const bare = (host: string) => host.replace(/^\[|\]$/g, '')
/** The name to send with SNI, which never carries an IP address. */
const serverName = (host: string) => (isIP(bare(host)) ? undefined : host)

export const certificateFingerprint = (pem: string) => new X509Certificate(pem).fingerprint256

/**
 * TLS options that require a certificate the public authorities vouch for, issued for the server's
 * name. A certificate the user trusted for this server is accepted too, but only that exact one:
 * it must match by fingerprint, whoever issued it and whatever names it's for. `ca` replaces the
 * public authorities and is for tests only.
 */
export function certificateOptions(
  server: TrustSettings,
  ca?: string | Uint8Array,
): ConnectionOptions {
  const authorities = ca && (typeof ca === 'string' ? ca : Buffer.from(ca))
  const base: ConnectionOptions = {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ...(authorities ? { ca: authorities } : {}),
  }
  const trusted = server.certificate?.pem
  if (!trusted) return base
  const sha256 = certificateFingerprint(trusted)
  return {
    ...base,
    ca: [...(authorities ? [authorities] : getCACertificates('default')), trusted],
    // Lets the trusted certificate anchor the chain even when it isn't an authority itself.
    allowPartialTrustChain: true,
    checkServerIdentity: (name, cert) =>
      cert.fingerprint256 === sha256 ? undefined : checkServerIdentity(name, cert),
  }
}

/** Explains a refused certificate. The connection stopped before any login was sent. */
export function certificateError(
  direction: 'incoming' | 'outgoing',
  server: TrustSettings,
  code?: string | null,
): ProviderError {
  const host = server.host
  const stopped = 'so the connection was stopped before signing in.'
  return new ProviderError(
    direction === 'incoming' ? 'certificate' : 'outgoingCertificate',
    code === 'CERT_HAS_EXPIRED'
      ? `The certificate of ${host} has expired, ${stopped}`
      : code === 'CERT_NOT_YET_VALID'
        ? `The certificate of ${host} isn't valid yet, ${stopped} Check this computer's date and time.`
        : server.certificate && code && trustable[code]
          ? `${host} presented a different certificate than the one you trusted, ${stopped}`
          : `The certificate of ${host} couldn't be verified, ${stopped}`,
  )
}

/**
 * Connects, secures the connection and reads the server's certificate, then hangs up without
 * signing in. Resolves to undefined when the certificate would be accepted, when trusting it
 * wouldn't help, or when the server never presents one.
 */
export async function inspectCertificate(
  server: ServerSettings,
  protocol: 'imap' | 'smtp',
  options: { ca?: string | Uint8Array; timeoutMs?: number } = {},
): Promise<CertificateDetails | undefined> {
  // Only the outermost socket is ever destroyed. A TLS socket closes the plain one beneath it,
  // and destroying that plain socket first crashes Node 24.
  let outer: Socket | undefined
  const timer = setTimeout(
    () => outer?.destroy(new Error('Timed out')),
    options.timeoutMs ?? 10_000,
  )
  const open = <T extends Socket>(socket: T, ready: 'connect' | 'secureConnect') =>
    new Promise<T>((resolve, reject) => {
      outer = socket
      socket.once(ready, () => resolve(socket))
      socket.on('error', reject)
    })
  const secure = (extra: ConnectionOptions) =>
    open(
      connectTls({
        host: bare(server.host),
        port: server.port,
        servername: serverName(server.host),
        minVersion: 'TLSv1.2',
        ...(options.ca ? { ca: Buffer.from(options.ca) } : {}),
        // Only to read the certificate, which is judged below. Nothing is sent over this connection.
        rejectUnauthorized: false,
        ...extra,
      }),
      'secureConnect',
    )
  try {
    let socket: TLSSocket
    if (server.security === 'tls') socket = await secure({})
    else {
      const plain = await open(
        connectTcp({ host: bare(server.host), port: server.port }),
        'connect',
      )
      if (!(await (protocol === 'imap' ? startImapTls : startSmtpTls)(plain))) return undefined
      socket = await secure({ socket: plain })
    }
    const peer = socket.getPeerX509Certificate()
    return peer && review(server, peer, socket.authorized, socket.authorizationError)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    outer?.destroy()
  }
}

function review(
  server: ServerSettings,
  peer: X509Certificate,
  authorized: boolean,
  reason: Error | string | null,
): CertificateDetails | undefined {
  const code = typeof reason === 'string' ? reason : (reason as { code?: string } | null)?.code
  const now = Date.now()
  const trusted = server.certificate && certificateFingerprint(server.certificate.pem)
  const problem: CertificateProblem | undefined =
    now > peer.validToDate.getTime()
      ? 'expired'
      : now < peer.validFromDate.getTime()
        ? 'notYetValid'
        : authorized || peer.fingerprint256 === trusted || !code || !trustable[code]
          ? undefined
          : trusted
            ? 'changed'
            : trustable[code]
  if (!problem) return undefined
  return {
    problem,
    sha256: peer.fingerprint256,
    pem: peer.toString(),
    subject: nameOf(peer.subject, 'CN', 'O') || 'Unnamed',
    issuer: nameOf(peer.issuer, 'O', 'CN') || 'Unnamed',
    // The same address often appears as both a DNS name and an IP address.
    names: [
      ...new Set(
        [...(peer.subjectAltName || '').matchAll(/(?:DNS|IP Address):("[^"]*"|[^,]*)/g)].map((m) =>
          m[1].replace(/^"|"$/g, ''),
        ),
      ),
    ],
    validFrom: peer.validFromDate.toISOString(),
    validTo: peer.validToDate.toISOString(),
  }
}

/** The first of these attributes in a distinguished name, such as `CN` in `O=Example\nCN=mail`. */
function nameOf(dn: string, ...attributes: string[]) {
  const fields = dn.split('\n').map((line) => line.split(/=(.*)/s))
  for (const attribute of attributes) {
    const value = fields.find(([key]) => key === attribute)?.[1]
    if (value) return value.replace(/^"|"$/g, '')
  }
}

/** Collects lines until `last` matches one, so a reply's continuation lines are included. */
function reply(socket: Socket, last: (line: string) => boolean): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    let buffer = ''
    const received = (chunk: Buffer) => {
      buffer += chunk.toString('latin1')
      // A greeting or capability list is small; anything this large isn't a mail server.
      if (buffer.length > 65_536) return finish(new Error('Reply too long'))
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end).replace(/\r$/, '')
        buffer = buffer.slice(end + 1)
        lines.push(line)
        if (last(line)) return finish()
      }
    }
    const closed = () => finish(new Error('Connection closed'))
    function finish(error?: Error) {
      socket.off('data', received)
      socket.off('error', closed)
      socket.off('close', closed)
      if (error) reject(error)
      else resolve(lines)
    }
    socket.on('data', received)
    socket.once('error', closed)
    socket.once('close', closed)
  })
}

async function startImapTls(socket: Socket): Promise<boolean> {
  const greeting = await reply(socket, (line) => line.startsWith('* '))
  if (!/^\* OK\b/i.test(greeting.at(-1)!)) return false
  socket.write('A1 STARTTLS\r\n')
  const done = await reply(socket, (line) => line.startsWith('A1 '))
  return /^A1 OK\b/i.test(done.at(-1)!)
}

async function startSmtpTls(socket: Socket): Promise<boolean> {
  // The last line of a reply has a space, or nothing, after its code.
  const smtpReply = () => reply(socket, (line) => /^\d{3}(?: |$)/.test(line))
  if (!(await smtpReply()).at(-1)!.startsWith('220')) return false
  // The same neutral name as a real session, so the local hostname never reaches the server.
  socket.write('EHLO [127.0.0.1]\r\n')
  const ehlo = await smtpReply()
  if (!ehlo.at(-1)!.startsWith('250') || !ehlo.some((line) => /^250[ -]STARTTLS\s*$/i.test(line)))
    return false
  socket.write('STARTTLS\r\n')
  return (await smtpReply()).at(-1)!.startsWith('220')
}
