import SMTPConnection from 'nodemailer/lib/smtp-connection'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { TLSSocket } from 'node:tls'
import { ProviderError, type ServerSettings, type SubmissionOutcome } from '@inlark/core'
import { certificateError, certificateOptions } from './certificate'

export interface SmtpSettings extends ServerSettings {
  password: string
  timeoutMs?: number
  /** Tests only: trust this CA instead of the system roots. */
  tls?: { ca?: string | Uint8Array }
}

/** The fields nodemailer puts on its errors (see smtp-connection `_formatError`). */
type SmtpFailure = Error & {
  code?: string
  command?: string
  responseCode?: number
  response?: string
  recipient?: string
}
/**
 * `connect` covers connect, TLS, greeting, EHLO, STARTTLS and AUTH; `envelope` covers MAIL FROM, RCPT TO and
 * the DATA command; `data` starts when nodemailer first reads the message, i.e. after the server's 354.
 */
type Phase = 'connect' | 'envelope' | 'data'
interface State {
  phase: Phase
  startTlsMissing?: boolean
}
/** smtp-connection internals this module relies on; covered by tests/smtp.test.ts. */
interface Internals {
  _ehloLines?: string[]
  _supportedAuth?: string[]
  _actionSTARTTLS(this: Internals, response: string): void
  _onError(error: Error, code: string, response: string | false, command: string): void
}

const passwordMethods = ['PLAIN', 'LOGIN', 'CRAM-MD5']

export function smtpOptions(settings: SmtpSettings): SMTPConnection.Options {
  const timeout = settings.timeoutMs
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    ignoreTLS: false,
    opportunisticTLS: false,
    // A neutral EHLO name, so the local hostname never reaches the server.
    name: '[127.0.0.1]',
    connectionTimeout: timeout ?? 30_000,
    greetingTimeout: timeout ?? 30_000,
    dnsTimeout: timeout ?? 30_000,
    // Servers may scan a message for a while before answering the end of DATA.
    socketTimeout: timeout ?? 120_000,
    logger: false,
    debug: false,
    transactionLog: false,
    lmtp: false,
    tls: {
      ...certificateOptions(settings, settings.tls?.ca),
      ...(isIP(settings.host) ? {} : { servername: settings.host }),
    },
  }
}

/** Connects, secures the connection and signs in, then quits. Never sends a message. */
export async function verifySmtp(settings: SmtpSettings): Promise<void> {
  await session(settings, async () => undefined)
}

/**
 * Transmits exactly `mime` to `envelope.to`. Throws `submissionUncertain` whenever the message may have reached the
 * server without a definitive reply; callers must never retry that automatically.
 */
export async function submitSmtp(
  settings: SmtpSettings,
  envelope: { from: string; to: string[] },
  mime: Uint8Array,
): Promise<SubmissionOutcome> {
  const to = [...new Map(envelope.to.map((a) => [a.trim().toLowerCase(), a.trim()])).values()]
  const invalid = [envelope.from, ...to].find((a) => !a || /[\s<>]/.test(a))
  const problem = !envelope.from
    ? 'The sender address is missing.'
    : !to.length
      ? 'The message has no recipients.'
      : invalid !== undefined
        ? `“${clean(invalid)}” isn't a valid address.`
        : !mime.byteLength
          ? 'The message is empty.'
          : undefined
  if (problem) throw new ProviderError('submissionRejected', `${problem} Nothing was sent.`)
  return session(
    settings,
    (conn, state) =>
      new Promise<SubmissionOutcome>((resolve, reject) => {
        state.phase = 'envelope'
        const body = new Readable({
          read() {
            state.phase = 'data'
            this.push(Buffer.from(mime.buffer, mime.byteOffset, mime.byteLength))
            this.push(null)
          },
        })
        conn.send({ from: envelope.from, to, size: mime.byteLength }, body, (error, info) => {
          if (error || !info) return reject(sendFailure(settings, state, error ?? undefined))
          const reasons = new Map(
            (info.rejectedErrors ?? []).map((e) => [
              (e as SmtpFailure).recipient,
              (e as SmtpFailure).response,
            ]),
          )
          resolve({
            accepted: [...info.accepted],
            rejected: info.rejected.map((email) => ({
              email,
              reason: clean(reasons.get(email) ?? '') || 'Rejected by the outgoing server',
            })),
          })
        })
      }),
  )
}

async function session<T>(
  settings: SmtpSettings,
  work: (conn: SMTPConnection, state: State) => Promise<T>,
): Promise<T> {
  if (
    !settings.host?.trim() ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535
  )
    throw new ProviderError('outgoingNetwork', 'The outgoing server address or port is missing.')
  if (settings.security !== 'tls' && settings.security !== 'starttls')
    throw new ProviderError('outgoingNetwork', 'The outgoing server security setting is invalid.')
  const conn = new SMTPConnection(smtpOptions(settings))
  const state: State = { phase: 'connect' }
  requireOfferedStartTls(conn, state)
  let drop!: (error: ProviderError) => void
  const dropped = new Promise<never>((_, reject) => (drop = reject))
  dropped.catch(() => undefined)
  // Socket failures and timeouts are only emitted here; send() never calls back for them.
  conn.on('error', (error: SmtpFailure) => drop(connectionLost(settings, state, conn, error)))
  conn.on('end', () => drop(connectionLost(settings, state, conn)))
  let done = false
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve()))),
      dropped,
    ])
    // Defense in depth: nodemailer's requireTLS already refuses to continue unencrypted.
    if (!conn.secure)
      throw new ProviderError(
        'outgoingNetwork',
        `The connection to ${settings.host} isn't encrypted, so no password was sent. Check the security setting.`,
      )
    await Promise.race([login(conn, settings), dropped])
    const result = await Promise.race([work(conn, state), dropped])
    done = true
    return result
  } catch (error) {
    throw error instanceof ProviderError
      ? error
      : connectionLost(settings, state, conn, error as SmtpFailure)
  } finally {
    if (done) {
      conn.quit()
      setTimeout(() => conn.close(), 5000).unref()
    } else conn.close()
  }
}

/**
 * With requireTLS nodemailer sends STARTTLS even when the plaintext EHLO did not offer it. Treat a missing offer as
 * a failed upgrade instead, before anything else is sent.
 */
function requireOfferedStartTls(conn: SMTPConnection, state: State) {
  const internals = conn as unknown as Internals
  const upgrade = internals._actionSTARTTLS
  internals._actionSTARTTLS = function (response) {
    if (!this._ehloLines?.some((line) => /^STARTTLS$/i.test(line.trim()))) {
      state.startTlsMissing = true
      this._onError(new Error('STARTTLS was not offered'), 'ETLS', false, 'STARTTLS')
      return
    }
    upgrade.call(this, response)
  }
}

async function login(conn: SMTPConnection, settings: SmtpSettings): Promise<void> {
  const host = settings.host
  if (!conn.allowsAuth)
    throw new ProviderError(
      'outgoingNetwork',
      `${host} doesn't offer password sign-in on this connection, so nothing can be sent. Check the port and security settings.`,
    )
  const offered = (conn as unknown as Internals)._supportedAuth ?? []
  // No listed mechanism means nodemailer inferred AUTH (HELO fallback); PLAIN is its default there too.
  const method = offered.length ? passwordMethods.find((m) => offered.includes(m)) : 'PLAIN'
  if (!method)
    throw new ProviderError(
      'outgoingNetwork',
      `${host} doesn't offer a supported password sign-in method.`,
    )
  await new Promise<void>((resolve, reject) =>
    conn.login({ user: settings.username, pass: settings.password, method }, (error) => {
      if (!error) return resolve()
      const failure = error as SmtpFailure
      if (failure.code !== 'EAUTH') return reject(failure)
      reject(
        failure.responseCode && failure.responseCode < 500
          ? new ProviderError(
              'outgoingNetwork',
              `${host} couldn't check the sign-in right now. Try again in a moment.`,
            )
          : new ProviderError(
              'outgoingAuthentication',
              `${host} didn't accept the username or password for sending mail. Check them in the account settings.`,
            ),
      )
    }),
  )
}

function connectionLost(
  settings: SmtpSettings,
  state: State,
  conn: SMTPConnection,
  error?: SmtpFailure,
): ProviderError {
  const host = settings.host
  if (state.phase === 'data') return uncertain(host)
  if (state.phase === 'envelope') return interrupted(host)
  const text = error?.message ?? ''
  const socket = conn._socket
  const hint = 'Check the port and security settings.'
  if (state.startTlsMissing)
    return new ProviderError(
      'outgoingNetwork',
      `${host} didn't offer an encrypted connection (STARTTLS), so no password was sent. ${hint}`,
    )
  const refused = socket instanceof TLSSocket ? socket.authorizationError : undefined
  if (refused || /certificate|altnames|self[- ]signed/i.test(text))
    // Node reports the verification code as a string, despite its type.
    return certificateError('outgoing', settings, refused as unknown as string | undefined)
  if (error?.command === 'STARTTLS' && error.responseCode)
    return new ProviderError(
      'outgoingNetwork',
      `${host} refused to start an encrypted connection, so no password was sent. ${hint}`,
    )
  if (error?.code === 'ETLS' || /\b(ssl|tls)\b|handshake|wrong version/i.test(text))
    return new ProviderError(
      'outgoingNetwork',
      `A secure connection to ${host} couldn't be established. ${hint}`,
    )
  if (error?.code === 'ETIMEDOUT')
    return new ProviderError(
      'outgoingNetwork',
      `${host} didn't respond in time. Check your connection, the port and the security setting.`,
    )
  if (error?.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(text))
    return new ProviderError(
      'outgoingNetwork',
      `${host} couldn't be found. Check the server name and your connection.`,
    )
  if (/ECONNREFUSED/.test(text))
    return new ProviderError(
      'outgoingNetwork',
      `${host} refused the connection on port ${settings.port}. ${hint}`,
    )
  return new ProviderError(
    'outgoingNetwork',
    `Couldn't connect to the outgoing server ${host}. Check your connection and the server settings, then try again.`,
  )
}

function sendFailure(settings: SmtpSettings, state: State, error?: SmtpFailure): ProviderError {
  const host = settings.host
  const code = error?.responseCode || 0
  const said = error?.response ? ` The server said: “${clean(error.response)}”` : ''
  const temporary = code >= 400 && code < 500
  if (error?.code === 'EENVELOPE') {
    const message =
      error.command === 'MAIL FROM'
        ? `${host} refused the sender address, so nothing was sent.`
        : error.command === 'RCPT TO'
          ? `${host} ${temporary ? 'temporarily ' : ''}rejected every recipient, so nothing was sent.`
          : error.command === 'DATA'
            ? `${host} refused the message before it was transmitted, so nothing was sent.`
            : `The message couldn't be addressed, so nothing was sent.`
    return new ProviderError('submissionRejected', message + said)
  }
  // The server's reply to the end of DATA: definitive either way.
  if (error?.code === 'EMESSAGE' && error.command === 'DATA' && code >= 400 && code < 600)
    return new ProviderError(
      'submissionRejected',
      (temporary
        ? `${host} temporarily refused the message, so it wasn't sent. Try again later.`
        : `${host} rejected the message, so it wasn't sent.`) + said,
    )
  // Anything else once the message started flowing: the server may have it.
  if (state.phase === 'data') return uncertain(host)
  if (error?.code === 'EMESSAGE')
    return new ProviderError(
      'submissionRejected',
      `The message is larger than ${host} accepts, so nothing was sent.`,
    )
  return interrupted(host)
}

const uncertain = (host: string) =>
  new ProviderError(
    'submissionUncertain',
    `The connection to ${host} ended while the message was being sent, so it's not known whether it went out. Check your Sent folder or ask a recipient before sending it again.`,
  )
const interrupted = (host: string) =>
  new ProviderError(
    'outgoingNetwork',
    `The connection to ${host} was interrupted before the message was transmitted. Nothing was sent; you can try again.`,
  )
const clean = (text: string) =>
  text
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, 300)
