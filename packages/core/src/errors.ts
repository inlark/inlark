/**
 * Codes shared by every provider so the service can react without knowing the protocol.
 *
 * - `network` / `authentication` / `tls` / `certificate`: the incoming connection is unavailable.
 * - `imapDisabled`: the sign-in was accepted, but the provider has IMAP switched off for this
 *   mailbox. Signing in again does not help; the mailbox setting has to change.
 * - `outgoingNetwork` / `outgoingAuthentication` / `outgoingCertificate`: the outgoing server is
 *   unavailable; nothing was sent.
 * - `certificate` / `outgoingCertificate`: the server's certificate isn't trusted, so nothing was
 *   signed in. The user may be able to review and trust it.
 * - `outgoingDisabled`: the provider has switched off SMTP for this mailbox, before anything was
 *   sent. Another way of sending may still work.
 * - `submissionRejected`: the server refused the message; nothing was sent.
 * - `submissionUncertain`: the message may have been sent. Never retry automatically.
 * - `filing` / `filingUncertain`: the message was sent, but its Sent copy is not confirmed.
 * - `conflict` / `stateMismatch`: mail changed elsewhere since it was read.
 * - `unsupported`: the server lacks a capability this action needs to be safe.
 */
export type ProviderErrorCode =
  | 'network'
  | 'authentication'
  | 'tls'
  | 'certificate'
  | 'outgoingNetwork'
  | 'outgoingAuthentication'
  | 'outgoingCertificate'
  | 'imapDisabled'
  | 'outgoingDisabled'
  | 'submissionRejected'
  | 'submissionUncertain'
  | 'filing'
  | 'filingUncertain'
  | 'conflict'
  | 'stateMismatch'
  | 'unsupported'
  | 'rateLimit'
  | 'notFound'
  | 'permission'
  | (string & {})

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Errors meaning the incoming server cannot currently be used at all. */
export const connectionErrorCodes: readonly string[] = [
  'network',
  'authentication',
  'imapDisabled',
  'http',
  'tls',
  'certificate',
]

export const isProviderError = (error: unknown, ...codes: string[]): error is ProviderError =>
  error instanceof ProviderError && (!codes.length || codes.includes(error.code))
