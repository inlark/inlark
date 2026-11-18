import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  ProviderError,
  microsoftClientId,
  type MicrosoftSignInResult,
  type MicrosoftSignInStart,
} from '@inlark/core'

/*
 * Signing in with Microsoft, for Outlook.com and Microsoft 365 accounts.
 *
 * The user signs in on Microsoft's own page, in their browser, so inlark never sees a password.
 * The browser hands the result to a listener on this computer's loopback address, which only
 * exists while a sign-in is waiting. inlark has no client secret; PKCE ties the result to the
 * request that started it. Tokens stay in this process and never reach the window.
 */

const defaultAuthority = 'https://login.microsoftonline.com/common/oauth2/v2.0'
/** The one Microsoft directory that holds every Outlook.com, Hotmail, Live and MSN account. */
const personalDirectory = '9188040d-6c67-4c5b-b112-36a304b66dad'

export type MicrosoftResource = 'mail' | 'graph'
/** A token is for one service. Sending through Graph needs its own, from the same sign-in. */
const scopes: Record<MicrosoftResource, string[]> = {
  mail: [
    'https://outlook.office.com/IMAP.AccessAsUser.All',
    'https://outlook.office.com/SMTP.Send',
  ],
  graph: ['https://graph.microsoft.com/Mail.Send'],
}
/** `email` tells inlark which account was chosen; `offline_access` lets it stay signed in. */
const identityScopes = ['openid', 'email', 'offline_access']

export interface MicrosoftAuthOptions {
  /** Opens a page in the user's browser. */
  open(url: string): Promise<void>
  fetch?: typeof fetch
  clientId?: string
  /** Tests only. */
  authority?: string
  now?: () => number
  /** How long a sign-in may wait in the browser. */
  waitMs?: number
  /** The browser came back, so the app can come to the front. */
  onReturn?(): void
}

/** Supplies access tokens for one account and keeps its long-lived token current. */
export interface MicrosoftSession {
  /** An Outlook.com, Hotmail, Live or MSN account, as opposed to a work or school one. */
  readonly personal: boolean
  /** The address Microsoft signed in. */
  readonly email?: string
  /** The long-lived token, to be stored like a password. */
  refreshToken(): string
  accessToken(resource: MicrosoftResource): Promise<string>
  /** Called when Microsoft replaces the long-lived token, which it does on most renewals. */
  onRotate?: (refreshToken: string) => void
}

interface TokenResponse {
  access_token: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
}
interface Pending {
  result: Promise<MicrosoftSignInResult>
  cancel(): void
}

const base64url = (value: Buffer) => value.toString('base64url')
/** Read from a token Microsoft sent directly over TLS, so its signature needs no checking. */
function identity(idToken?: string): { tid?: string; email?: string } {
  try {
    const claims = JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8'))
    const email = [claims.email, claims.preferred_username].find(
      (value) => typeof value === 'string' && value.includes('@'),
    )
    return { tid: typeof claims.tid === 'string' ? claims.tid : undefined, email }
  } catch {
    return {}
  }
}
/** Microsoft's words for "an administrator has to approve this app first". */
const needsAdmin =
  /AADSTS(65001|90094|900941|650052|650057|50105|700016)\b|admin(istrator)? (consent|approval)/i
/**
 * “User declined to consent”. Microsoft sends it for Cancel on the page that lists what inlark
 * may do, and also for “Back to app” after someone asked their administrator for approval.
 */
const declined = /AADSTS65004\b/

/** Takes the one-time code out of the address bar and the browser's history. */
const tidy = "history.replaceState(null,'','/')"
const contentPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" +
  createHash('sha256').update(tidy).digest('base64') +
  "'"
const page = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>inlark</title><style>
:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.6 system-ui,sans-serif;background:#fbfbfc;color:#1c1c21}
main{max-width:26rem;padding:2rem}h1{margin:0 0 .5rem;font-size:20px;font-weight:600;letter-spacing:-.4px}p{margin:0;color:#6b6b76}
@media(prefers-color-scheme:dark){body{background:#101014;color:#ededf0}p{color:#9a9aa6}}</style></head><body><main><h1>${title}</h1><p>${text}</p></main><script>${tidy}</script></body></html>`
const pages = {
  done: page('You’re signed in', 'You can close this tab and go back to inlark.'),
  failed: page('Sign-in didn’t finish', 'You can close this tab and go back to inlark.'),
}
function send(response: ServerResponse, status: number, html: string) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': contentPolicy,
    connection: 'close',
  })
  response.end(html)
}

class Session implements MicrosoftSession {
  onRotate?: (refreshToken: string) => void
  private cached = new Map<MicrosoftResource, { token: string; expires: number }>()
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private auth: MicrosoftAuth,
    private refresh: string,
    readonly personal: boolean,
    readonly email?: string,
  ) {}
  refreshToken() {
    return this.refresh
  }
  remember(resource: MicrosoftResource, tokens: TokenResponse) {
    this.cached.set(resource, {
      token: tokens.access_token,
      expires: this.auth.now() + (tokens.expires_in ?? 3600) * 1000,
    })
  }
  /** One renewal at a time: each one can replace the token the next one has to present. */
  accessToken(resource: MicrosoftResource): Promise<string> {
    const run = this.queue.then(() => this.current(resource))
    this.queue = run.catch(() => undefined)
    return run
  }
  private async current(resource: MicrosoftResource): Promise<string> {
    const cached = this.cached.get(resource)
    if (cached && cached.expires - this.auth.now() > 5 * 60_000) return cached.token
    let tokens: TokenResponse
    try {
      tokens = await this.auth.token({
        grant_type: 'refresh_token',
        refresh_token: this.refresh,
        // Without offline_access Microsoft sends no replacement for the long-lived token.
        scope: [...scopes[resource], 'offline_access'].join(' '),
      })
    } catch (error) {
      // Reading mail can keep working when only the permission to send this way is missing.
      if (resource === 'graph' && error instanceof ProviderError && error.code === 'authentication')
        throw new ProviderError(
          'outgoingAuthentication',
          'Microsoft doesn’t let inlark send for this mailbox. Sign in with Microsoft again to allow it.',
        )
      throw error
    }
    this.remember(resource, tokens)
    if (tokens.refresh_token && tokens.refresh_token !== this.refresh) {
      this.refresh = tokens.refresh_token
      this.onRotate?.(this.refresh)
    }
    return tokens.access_token
  }
}

export class MicrosoftAuth {
  private pending = new Map<string, Pending>()
  private grants = new Map<string, { session: Session; at: number }>()
  private readonly clientId: string
  private readonly authority: string
  constructor(private options: MicrosoftAuthOptions) {
    this.clientId = options.clientId || microsoftClientId
    this.authority = options.authority || defaultAuthority
  }
  now() {
    return this.options.now?.() ?? Date.now()
  }

  /** Exchanges a code or a long-lived token for tokens. Never logs or returns either in errors. */
  async token(parameters: Record<string, string>, abandon?: AbortSignal): Promise<TokenResponse> {
    let response: Response
    const timeout = AbortSignal.timeout(30_000)
    try {
      response = await (this.options.fetch ?? fetch)(this.authority + '/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, ...parameters }).toString(),
        redirect: 'error',
        signal: abandon ? AbortSignal.any([abandon, timeout]) : timeout,
      })
    } catch {
      throw new ProviderError(
        'network',
        'Microsoft’s sign-in service couldn’t be reached. Check your connection.',
      )
    }
    const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
      error?: string
    }
    if (response.ok && typeof body.access_token === 'string') return body as TokenResponse
    if (
      response.status >= 500 ||
      response.status === 429 ||
      body.error === 'temporarily_unavailable'
    )
      throw new ProviderError(
        'network',
        'Microsoft’s sign-in service isn’t available right now. inlark will try again.',
      )
    // The long-lived token expired or was revoked, or the account's password changed.
    throw new ProviderError(
      'authentication',
      'Your Microsoft sign-in is no longer valid. Sign in with Microsoft again.',
    )
  }

  /**
   * Opens Microsoft's sign-in page and starts listening for the browser to come back. Only one
   * sign-in waits at a time, so starting another abandons the first.
   */
  async start(email: string): Promise<MicrosoftSignInStart> {
    for (const waiting of [...this.pending.values()]) waiting.cancel()
    const id = randomUUID()
    const verifier = base64url(randomBytes(48))
    const state = base64url(randomBytes(24))
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Loopback only: nothing outside this computer can reach the listener.
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    const hint = email.trim()
    const url =
      this.authority +
      '/authorize?' +
      new URLSearchParams({
        client_id: this.clientId,
        response_type: 'code',
        redirect_uri: redirect,
        response_mode: 'query',
        scope: [...identityScopes, ...scopes.mail, ...scopes.graph].join(' '),
        state,
        code_challenge: base64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
        // Always shows which account is being used, even when the browser is signed in to one.
        prompt: 'select_account',
        ...(hint.includes('@') ? { login_hint: hint } : {}),
      })
    let settle!: (result: MicrosoftSignInResult) => void
    const result = new Promise<MicrosoftSignInResult>((resolve) => (settle = resolve))
    let finished = false
    /** Microsoft's answer is taken once; nothing after it is listened to. */
    let claimed = false
    const exchange = new AbortController()
    const finish = (value: MicrosoftSignInResult) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // A code still being exchanged is dropped, so a cancelled sign-in leaves nothing behind.
      exchange.abort()
      server.close()
      server.closeAllConnections()
      settle(value)
      // The entry stays so `finish` can still read the result; it is small and soon replaced.
    }
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: 'timeout',
          message: 'The sign-in page wasn’t finished in time. Start again when you’re ready.',
        }),
      this.options.waitMs ?? 10 * 60_000,
    )
    timer.unref?.()
    server.on('request', (request, response) => {
      let target: URL | undefined
      try {
        target = new URL(request.url || '/', redirect)
      } catch {
        // Not an address a browser would send. Any local program can reach this listener.
      }
      // Anything without this sign-in's own state is not Microsoft answering it.
      if (
        !target ||
        finished ||
        claimed ||
        request.method !== 'GET' ||
        target.pathname !== '/' ||
        target.searchParams.get('state') !== state
      ) {
        response.writeHead(404, { connection: 'close' }).end()
        return
      }
      claimed = true
      void this.complete(target.searchParams, redirect, verifier, exchange.signal).then(
        (outcome) => {
          // Cancelled or timed out while the code was being exchanged: nothing is kept.
          if (finished) return
          let value: MicrosoftSignInResult
          if ('session' in outcome) {
            const { session } = outcome
            const grant = randomUUID()
            this.sweep()
            this.grants.set(grant, { session, at: this.now() })
            value = {
              ok: true,
              grant,
              personal: session.personal,
              ...(session.email ? { email: session.email } : {}),
            }
          } else value = outcome
          send(response, 200, value.ok ? pages.done : pages.failed)
          this.options.onReturn?.()
          finish(value)
        },
      )
    })
    this.pending.set(id, {
      result,
      cancel: () =>
        finish({ ok: false, reason: 'cancelled', message: 'Microsoft sign-in was cancelled.' }),
    })
    // A browser that doesn't open is not fatal: the window offers the same link again.
    await this.options.open(url).catch(() => undefined)
    return { id, url }
  }

  /** Turns Microsoft's answer into a session, or into the reason there is none. */
  private async complete(
    answer: URLSearchParams,
    redirect: string,
    verifier: string,
    abandon: AbortSignal,
  ): Promise<{ session: Session } | Extract<MicrosoftSignInResult, { ok: false }>> {
    const code = answer.get('code')
    if (!code) {
      const description = answer.get('error_description') || ''
      if (needsAdmin.test(description))
        return {
          ok: false,
          reason: 'adminApproval',
          message:
            'Your organization hasn’t approved inlark yet. An administrator has to approve it once for everyone.',
        }
      const denied = answer.get('error') === 'access_denied'
      // Microsoft's “Need admin approval” page sends people back with no reason at all. Either
      // way inlark can't tell someone who changed their mind from someone who needs, or has
      // just asked for, an administrator's approval.
      if (declined.test(description) || (denied && !description))
        return {
          ok: false,
          reason: 'sentBack',
          message: 'Microsoft sent you back without signing in.',
        }
      if (denied)
        return { ok: false, reason: 'cancelled', message: 'Microsoft sign-in was cancelled.' }
      return {
        ok: false,
        reason: 'failed',
        message: 'Microsoft couldn’t finish the sign-in. Try again in a moment.',
      }
    }
    try {
      const tokens = await this.token(
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect,
          code_verifier: verifier,
          scope: [...scopes.mail, ...identityScopes].join(' '),
        },
        abandon,
      )
      if (!tokens.refresh_token)
        return {
          ok: false,
          reason: 'failed',
          message: 'Microsoft didn’t let inlark stay signed in. Try signing in again.',
        }
      const { tid, email } = identity(tokens.id_token)
      const session = new Session(this, tokens.refresh_token, tid === personalDirectory, email)
      session.remember('mail', tokens)
      return { session }
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        message:
          error instanceof ProviderError
            ? error.message
            : 'Microsoft couldn’t finish the sign-in. Try again in a moment.',
      }
    }
  }

  /** Resolves once the browser comes back, the user cancels, or the wait runs out. */
  finish(id: string): Promise<MicrosoftSignInResult> {
    const waiting = this.pending.get(id)
    if (!waiting)
      return Promise.resolve({
        ok: false,
        reason: 'failed',
        message: 'This sign-in is no longer waiting. Start it again.',
      })
    return waiting.result.finally(() => this.pending.delete(id))
  }
  cancel(id: string) {
    this.pending.get(id)?.cancel()
  }
  /** Abandons everything that is waiting, when the app quits. */
  dispose() {
    for (const waiting of [...this.pending.values()]) waiting.cancel()
    this.pending.clear()
    this.grants.clear()
  }

  /** A finished sign-in that hasn't been saved with a connection yet. */
  grant(id: string): MicrosoftSession | undefined {
    this.sweep()
    const entry = this.grants.get(id)
    if (entry) entry.at = this.now()
    return entry?.session
  }
  /** The connection keeps the session itself from here on. */
  release(id: string) {
    this.grants.delete(id)
  }
  /** Continues from a long-lived token saved with a connection. */
  resume(refreshToken: string, personal: boolean, email?: string): MicrosoftSession {
    return new Session(this, refreshToken, personal, email)
  }
  /** A sign-in nobody connected within half an hour is forgotten. */
  private sweep() {
    for (const [id, entry] of this.grants)
      if (this.now() - entry.at > 30 * 60_000) this.grants.delete(id)
  }
}
