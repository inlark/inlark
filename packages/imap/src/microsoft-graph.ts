import {
  ProviderError,
  microsoftGraphMessageLimit,
  type OutgoingMessage,
  type SubmissionOutcome,
} from '@inlark/core'

/*
 * Microsoft switches SMTP off for some mailboxes and offers no setting to turn it back on. Its
 * Graph service still sends for them, and takes the finished message as it is, so signed and
 * encrypted mail goes out unchanged. One request carries at most 4 MB.
 */

const sendMail = 'https://graph.microsoft.com/v1.0/me/sendMail'

export interface GraphOptions {
  fetch?: typeof fetch
  /** Tests only. */
  endpoint?: string
  timeoutMs?: number
}

/** Errors that mean the request never reached Microsoft, as Node and as Chromium report them. */
const unreachable = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
])
const neverConnected =
  /net::ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|CONNECTION_TIMED_OUT|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED)\b/
const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1).replace(/\.0$/, '')
const clean = (text: string) =>
  text
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, 300)

/** Why a message of this size can't go through Graph, or undefined when it fits. */
export function graphSizeProblem(bytes: number): string | undefined {
  return bytes > microsoftGraphMessageLimit
    ? `This message is ${megabytes(bytes)} MB with its attachments. Microsoft has switched off SMTP for this mailbox, and its other way of sending takes about ${megabytes(microsoftGraphMessageLimit)} MB at most. Remove or shrink attachments, then send again. Nothing was sent.`
    : undefined
}

/**
 * Graph reads recipients from the message itself and has no separate envelope, so hidden
 * recipients need a Bcc header. Microsoft removes it before delivering to anyone.
 */
export function withBcc(mime: Uint8Array, bcc: string[] = []): Uint8Array {
  if (!bcc.length) return mime
  const header = Buffer.from('Bcc: ' + bcc.join(',\r\n ') + '\r\n', 'utf8')
  return Buffer.concat([header, Buffer.from(mime.buffer, mime.byteOffset, mime.byteLength)])
}

/** How Microsoft answered: the status decides what happened, the rest only explains it. */
interface GraphReply {
  status: number
  code: string
  said: string
}
const nothingSaid = { code: '', said: '' }

/** Reads what Microsoft says about a refusal: a small JSON document, and never more than that. */
async function explanation(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ code: string; said: string }> {
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 65_536) return nothingSaid
    chunks.push(value)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    error?: { code?: unknown; message?: unknown }
  }
  const { code, message } = body?.error ?? {}
  return {
    code: typeof code === 'string' ? code : '',
    said: typeof message === 'string' && message ? ` Microsoft said: “${clean(message)}”` : '',
  }
}
/**
 * The explanation in a reply, or none when it can't be read before `expired` rejects, in full,
 * or as JSON. Whatever happens, the reply is then let go of. The reader holds the stream, so
 * stopping it goes through the reader. Cancelling ends any read still waiting at once, so the
 * lock is released straight away rather than when the cancellation finishes: a reply that
 * ignores the deadline may never finish being cancelled.
 */
async function explained(response: Response, expired: Promise<never>) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = response.body?.getReader()
    return reader ? await Promise.race([explanation(reader), expired]) : nothingSaid
  } catch {
    return nothingSaid
  } finally {
    if (reader) {
      void reader.cancel().catch(() => undefined)
      try {
        reader.releaseLock()
      } catch {
        // Already released with the stream.
      }
    }
  }
}

/**
 * One request to Graph under one deadline, which also covers reading the reply: a reply whose
 * headers arrive and whose body never does must not leave a send waiting forever.
 */
async function request(
  accessToken: () => Promise<string>,
  body: string,
  options: GraphOptions,
  uncertain: () => ProviderError,
): Promise<GraphReply> {
  let token: string
  try {
    token = await accessToken()
  } catch (error) {
    // Nothing has left yet. An unreachable sign-in service is a sending problem here.
    if (error instanceof ProviderError && error.code === 'network')
      throw new ProviderError('outgoingNetwork', error.message)
    throw error
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 120_000)
  const expired = new Promise<never>((_resolve, reject) =>
    abort.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }),
  )
  expired.catch(() => undefined)
  try {
    let response: Response
    try {
      response = await Promise.race([
        (options.fetch ?? fetch)(options.endpoint ?? sendMail, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'text/plain' },
          body,
          redirect: 'error',
          signal: abort.signal,
        }),
        expired,
      ])
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code
      if ((code && unreachable.has(code)) || neverConnected.test((error as Error)?.message || ''))
        throw new ProviderError(
          'outgoingNetwork',
          'Microsoft couldn’t be reached, so nothing was sent. Check your connection, then try again.',
        )
      throw uncertain()
    }
    const { status } = response
    // An acceptance needs no explanation. For anything else the status already says what
    // happened, so a reply that can't be read in time or in full only loses its wording.
    if (status !== 202) return { status, ...(await explained(response, expired)) }
    void response.body?.cancel().catch(() => undefined)
    return { status, ...nothingSaid }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Checks, without sending anything, that Microsoft accepts this sign-in for sending through
 * Graph. The request carries "!", which is no message: Microsoft documents that it answers
 * malformed content with `ErrorMimeContentInvalidBase64String`, and a real mailbox with a valid
 * sign-in answered exactly that. A refused sign-in is answered with 401 or 403 instead. This
 * shows the sign-in is accepted for sending; it cannot promise that a later message will be.
 */
export async function verifyGraph(
  accessToken: () => Promise<string>,
  options: GraphOptions = {},
): Promise<void> {
  const unavailable = () =>
    new ProviderError(
      'outgoingNetwork',
      'Microsoft couldn’t check sending for this mailbox right now. Try again in a moment.',
    )
  const reply = await request(accessToken, '!', { timeoutMs: 30_000, ...options }, unavailable)
  if (
    reply.status === 400 &&
    (reply.code === 'ErrorMimeContentInvalidBase64String' ||
      /invalid base64 string for MIME content/i.test(reply.said))
  )
    return
  if (reply.status === 401 || reply.status === 403 || reply.status === 404)
    throw new ProviderError(
      'outgoingAuthentication',
      'Microsoft has switched off SMTP for this mailbox and doesn’t let inlark send for it another way.' +
        reply.said,
    )
  throw unavailable()
}

/**
 * Sends a prepared message through Microsoft Graph. Like SMTP submission, it throws
 * `submissionUncertain` whenever the message may have reached Microsoft without a definitive
 * reply; callers must never retry that automatically.
 */
export async function submitGraph(
  accessToken: () => Promise<string>,
  message: OutgoingMessage,
  options: GraphOptions = {},
): Promise<SubmissionOutcome> {
  if (!message.mime) throw new ProviderError('submission', 'The message was not prepared.')
  const mime = withBcc(message.mime, message.envelope.bcc)
  const problem = graphSizeProblem(mime.byteLength)
  if (problem) throw new ProviderError('submissionRejected', problem)
  const { status, code, said } = await request(
    accessToken,
    Buffer.from(mime.buffer, mime.byteOffset, mime.byteLength).toString('base64'),
    options,
    () =>
      new ProviderError(
        'submissionUncertain',
        'The connection to Microsoft ended while the message was being sent, so it’s not known whether it went out. Check your Sent folder or ask a recipient before sending it again.',
      ),
  )
  // Accepted for delivery. A recipient Microsoft can't reach comes back as a bounce message.
  if (status === 202) return { accepted: [...message.envelope.to], rejected: [] }
  if (status === 401)
    throw new ProviderError(
      'outgoingAuthentication',
      'Microsoft didn’t accept this sign-in for sending mail. Sign in with Microsoft again.',
    )
  if (status === 413 || /SizeExceeded|TooLarge/i.test(code))
    throw new ProviderError(
      'submissionRejected',
      'The message is larger than Microsoft accepts for this mailbox, so nothing was sent.' + said,
    )
  if (status === 429 || status === 503)
    throw new ProviderError(
      'outgoingNetwork',
      'Microsoft is limiting how fast this mailbox can send right now. Nothing was sent; try again in a few minutes.',
    )
  if (/SendAsDenied/i.test(code))
    throw new ProviderError(
      'submissionRejected',
      `Microsoft refused to send from ${clean(message.envelope.from)}, so nothing was sent. If it's an alias, check that Microsoft lets this account send from it.` +
        said,
    )
  if (status >= 400 && status < 500)
    throw new ProviderError(
      'submissionRejected',
      'Microsoft refused the message, so nothing was sent.' + said,
    )
  throw new ProviderError(
    'submissionUncertain',
    'Microsoft didn’t confirm whether the message was sent. Check your Sent folder or ask a recipient before sending it again.',
  )
}
