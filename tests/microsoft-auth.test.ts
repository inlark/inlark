import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { MicrosoftAuth, type MicrosoftSession } from '../apps/desktop/src/main/microsoft-auth'
import { ProviderError, microsoftClientId } from '../packages/core/src'

const personalDirectory = '9188040d-6c67-4c5b-b112-36a304b66dad'
const idToken = (claims: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.')

/** Microsoft's token endpoint: records each request and answers from a queue or a default. */
function tokenEndpoint() {
  const requests: URLSearchParams[] = []
  const queue: (Response | Error)[] = []
  let issued = 0
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body))
    requests.push(body)
    const next = queue.shift()
    if (next instanceof Error) throw next
    if (next) return next
    issued++
    return Response.json({
      access_token: `access-${issued}`,
      refresh_token: `refresh-${issued}`,
      expires_in: 3600,
      ...(body.get('grant_type') === 'authorization_code'
        ? { id_token: idToken({ tid: personalDirectory, email: 'me@outlook.com' }) }
        : {}),
    })
  })
  return { fetch, requests, queue }
}
const refuse = (error: string, status = 400) =>
  Response.json({ error, error_description: 'AADSTS70000: details' }, { status })

const auths: MicrosoftAuth[] = []
afterEach(() => {
  for (const auth of auths.splice(0)) auth.dispose()
})
function setup(options: Partial<ConstructorParameters<typeof MicrosoftAuth>[0]> = {}) {
  const endpoint = tokenEndpoint()
  const opened: string[] = []
  let now = 1_000_000
  const auth = new MicrosoftAuth({
    open: async (url) => void opened.push(url),
    fetch: endpoint.fetch as never,
    now: () => now,
    ...options,
  })
  auths.push(auth)
  return { auth, endpoint, opened, advance: (ms: number) => (now += ms) }
}
/** Plays the browser coming back from Microsoft. */
async function comeBack(url: string, answer: Record<string, string>) {
  const sent = new URL(url).searchParams
  const target = new URL(sent.get('redirect_uri')!)
  for (const [key, value] of Object.entries({ state: sent.get('state')!, ...answer }))
    target.searchParams.set(key, value)
  return fetch(target)
}
async function signedIn(context = setup()) {
  const started = await context.auth.start('me@outlook.com')
  const finished = context.auth.finish(started.id)
  await comeBack(started.url, { code: 'the-code' })
  const result = await finished
  if (!result.ok) throw new Error('expected a finished sign-in: ' + result.message)
  return { ...context, started, result, session: context.auth.grant(result.grant)! }
}

describe('signing in with Microsoft', () => {
  it('sends the browser to Microsoft with PKCE and no secret', async () => {
    const { auth, opened } = setup()
    const started = await auth.start('  Me@Outlook.com ')
    expect(opened).toEqual([started.url])
    const url = new URL(started.url)
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    )
    const sent = Object.fromEntries(url.searchParams)
    expect(sent).toMatchObject({
      client_id: microsoftClientId,
      response_type: 'code',
      response_mode: 'query',
      code_challenge_method: 'S256',
      prompt: 'select_account',
      login_hint: 'Me@Outlook.com',
    })
    expect(sent.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(sent.scope.split(' ').sort()).toEqual(
      [
        'openid',
        'email',
        'offline_access',
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://outlook.office.com/SMTP.Send',
        'https://graph.microsoft.com/Mail.Send',
      ].sort(),
    )
    expect(sent).not.toHaveProperty('client_secret')
    expect(sent.state.length).toBeGreaterThan(20)
  })

  it('exchanges the code it gets back, proving it started the request', async () => {
    const { endpoint, started, result, session } = await signedIn()
    expect(result).toMatchObject({ ok: true, email: 'me@outlook.com', personal: true })
    const [exchange] = endpoint.requests
    const sent = new URL(started.url).searchParams
    expect(Object.fromEntries(exchange)).toMatchObject({
      client_id: microsoftClientId,
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: sent.get('redirect_uri'),
    })
    expect(exchange.has('client_secret')).toBe(false)
    const challenge = createHash('sha256').update(exchange.get('code_verifier')!).digest()
    expect(challenge.toString('base64url')).toBe(sent.get('code_challenge'))
    // The first token is for mail; the one for sending another way is fetched when needed.
    expect(exchange.get('scope')).not.toContain('graph.microsoft.com')
    expect(session.refreshToken()).toBe('refresh-1')
    expect(await session.accessToken('mail')).toBe('access-1')
    expect(endpoint.requests).toHaveLength(1)
  })

  it('tells a work account from a personal one, and reads its address', async () => {
    const context = setup()
    context.endpoint.queue.push(
      Response.json({
        access_token: 'a',
        refresh_token: 'r',
        id_token: idToken({ tid: 'contoso-directory', preferred_username: 'me@contoso.com' }),
      }),
    )
    const { result } = await signedIn(context)
    expect(result).toMatchObject({ email: 'me@contoso.com', personal: false })
  })

  it('answers only the request that carries its own state, and only once', async () => {
    const { auth } = setup()
    const started = await auth.start('me@outlook.com')
    const finished = auth.finish(started.id)
    const redirect = new URL(started.url).searchParams.get('redirect_uri')!
    expect((await fetch(redirect + '?code=stolen&state=guess')).status).toBe(404)
    expect((await fetch(redirect + 'favicon.ico')).status).toBe(404)
    expect(
      (
        await fetch(redirect + '?code=x&state=' + new URL(started.url).searchParams.get('state'), {
          method: 'POST',
        })
      ).status,
    ).toBe(404)
    const page = await comeBack(started.url, { code: 'the-code' })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('You’re signed in')
    expect(html).not.toContain('the-code')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    // The only script allowed is the one that takes the code out of the address bar.
    const script = /<script>([^<]*)<\/script>/.exec(html)![1]
    expect(script).toBe("history.replaceState(null,'','/')")
    expect(page.headers.get('content-security-policy')).toContain(
      `script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`,
    )
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect((await finished).ok).toBe(true)
    // The listener is gone as soon as the sign-in is over.
    await expect(comeBack(started.url, { code: 'again' })).rejects.toThrow()
  })

  it('takes Microsoft’s answer once, even while the code is still being exchanged', async () => {
    const context = setup()
    let release!: (response: Response) => void
    // The first exchange hangs, as a slow network would make it.
    context.endpoint.queue.push(new Promise<Response>((resolve) => (release = resolve)) as never)
    const started = await context.auth.start('me@outlook.com')
    const finished = context.auth.finish(started.id)
    const first = comeBack(started.url, { code: 'the-code' })
    await vi.waitFor(() => expect(context.endpoint.requests).toHaveLength(1))
    // A second request with the same state, such as a replay, starts nothing.
    expect((await comeBack(started.url, { code: 'replayed' })).status).toBe(404)
    expect(context.endpoint.requests).toHaveLength(1)
    release(
      Response.json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: idToken({ tid: personalDirectory, email: 'me@outlook.com' }),
      }),
    )
    expect((await first).status).toBe(200)
    expect(await finished).toMatchObject({ ok: true, email: 'me@outlook.com' })
    expect(context.endpoint.requests.map((r) => r.get('code'))).toEqual(['the-code'])
  })

  it('keeps nothing from a sign-in cancelled while its code was being exchanged', async () => {
    const context = setup()
    let aborted = false
    context.endpoint.fetch.mockImplementationOnce(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('aborted', 'AbortError'))
          }),
        ),
    )
    const started = await context.auth.start('me@outlook.com')
    const finished = context.auth.finish(started.id)
    const browser = comeBack(started.url, { code: 'the-code' }).catch(() => undefined)
    await vi.waitFor(() => expect(context.endpoint.fetch).toHaveBeenCalledTimes(1))
    context.auth.cancel(started.id)
    expect(await finished).toMatchObject({ ok: false, reason: 'cancelled' })
    await browser
    expect(aborted).toBe(true)
    expect((context.auth as any).grants.size).toBe(0)
  })

  it('keeps nothing when the exchange succeeds after the sign-in was cancelled', async () => {
    const context = setup()
    let release!: (response: Response) => void
    // An exchange that can't be stopped any more and comes back with tokens.
    context.endpoint.queue.push(new Promise<Response>((resolve) => (release = resolve)) as never)
    const started = await context.auth.start('me@outlook.com')
    const finished = context.auth.finish(started.id)
    const browser = comeBack(started.url, { code: 'the-code' }).catch(() => undefined)
    await vi.waitFor(() => expect(context.endpoint.requests).toHaveLength(1))
    context.auth.cancel(started.id)
    expect(await finished).toMatchObject({ ok: false, reason: 'cancelled' })
    release(
      Response.json({
        access_token: 'access-late',
        refresh_token: 'refresh-late',
        id_token: idToken({ tid: personalDirectory, email: 'me@outlook.com' }),
      }),
    )
    await browser
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect((context.auth as any).grants.size).toBe(0)
  })

  it('shrugs off requests no browser would send', async () => {
    const { auth } = setup()
    const started = await auth.start('me@outlook.com')
    const finished = auth.finish(started.id)
    const { port } = new URL(new URL(started.url).searchParams.get('redirect_uri')!)
    const raw = (target: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(Number(port), '127.0.0.1', () =>
          socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`),
        )
        let data = ''
        socket.on('data', (chunk) => (data += chunk))
        socket.on('close', () => resolve(data))
        socket.on('error', reject)
      })
    // An address `new URL` rejects used to throw inside the listener.
    expect(await raw('http://[')).toMatch(/^HTTP\/1\.1 4\d\d/)
    expect(await raw('//[::')).toMatch(/^HTTP\/1\.1 4\d\d/)
    // The sign-in is still waiting and still works.
    await comeBack(started.url, { code: 'the-code' })
    expect((await finished).ok).toBe(true)
  })

  it('reports how a sign-in ended without one', async () => {
    const outcome = async (answer: Record<string, string>) => {
      const { auth } = setup()
      const started = await auth.start('me@contoso.com')
      const finished = auth.finish(started.id)
      const page = await comeBack(started.url, answer)
      expect(await page.text()).toContain('Sign-in didn’t finish')
      return finished
    }
    expect(await outcome({ error: 'access_denied' })).toMatchObject({
      ok: false,
      reason: 'cancelled',
    })
    expect(
      await outcome({
        error: 'access_denied',
        error_description:
          'AADSTS65001: The user or administrator has not consented to use the application.',
      }),
    ).toMatchObject({ ok: false, reason: 'adminApproval' })
    expect(
      await outcome({
        error: 'invalid_client',
        error_description: 'AADSTS90094: An administrator needs to grant permission.',
      }),
    ).toMatchObject({ ok: false, reason: 'adminApproval' })
    expect(await outcome({ error: 'server_error' })).toMatchObject({ ok: false, reason: 'failed' })
  })

  it('fails the sign-in when the code cannot be exchanged', async () => {
    const context = setup()
    context.endpoint.queue.push(refuse('invalid_grant'))
    const started = await context.auth.start('me@outlook.com')
    const finished = context.auth.finish(started.id)
    await comeBack(started.url, { code: 'the-code' })
    expect(await finished).toMatchObject({ ok: false, reason: 'failed' })
    const offline = setup()
    offline.endpoint.queue.push(new TypeError('fetch failed'))
    const again = await offline.auth.start('me@outlook.com')
    const result = offline.auth.finish(again.id)
    await comeBack(again.url, { code: 'the-code' })
    expect(await result).toMatchObject({
      ok: false,
      reason: 'failed',
      message: expect.stringMatching(/couldn’t be reached/),
    })
  })

  it('can be cancelled, times out, and gives way to a newer sign-in', async () => {
    const { auth } = setup()
    const first = await auth.start('me@outlook.com')
    const firstResult = auth.finish(first.id)
    const second = await auth.start('me@outlook.com')
    expect(await firstResult).toMatchObject({ ok: false, reason: 'cancelled' })
    await expect(comeBack(first.url, { code: 'late' })).rejects.toThrow()
    auth.cancel(second.id)
    expect(await auth.finish(second.id)).toMatchObject({ ok: false, reason: 'cancelled' })
    expect(await auth.finish('unknown')).toMatchObject({ ok: false, reason: 'failed' })
    const impatient = setup({ waitMs: 20 })
    const third = await impatient.auth.start('me@outlook.com')
    expect(await impatient.auth.finish(third.id)).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('still offers the link when the browser cannot be opened', async () => {
    const { auth } = setup({
      open: async () => {
        throw new Error('no browser')
      },
    })
    const started = await auth.start('me@outlook.com')
    expect(started.url).toContain('/authorize?')
  })

  it('forgets a sign-in nobody connected', async () => {
    const context = await signedIn()
    context.advance(31 * 60_000)
    expect(context.auth.grant(context.result.grant)).toBeUndefined()
    const kept = await signedIn()
    kept.auth.release(kept.result.grant)
    expect(kept.auth.grant(kept.result.grant)).toBeUndefined()
  })
})

describe('staying signed in with Microsoft', () => {
  const resumed = () => {
    const context = setup()
    const session = context.auth.resume('saved-refresh', true, 'me@outlook.com')
    return { ...context, session }
  }

  it('renews an access token shortly before it ends, and not before', async () => {
    const { endpoint, session, advance } = resumed()
    expect(await session.accessToken('mail')).toBe('access-1')
    expect(await session.accessToken('mail')).toBe('access-1')
    advance(54 * 60_000)
    expect(await session.accessToken('mail')).toBe('access-1')
    advance(2 * 60_000)
    expect(await session.accessToken('mail')).toBe('access-2')
    expect(endpoint.requests).toHaveLength(2)
    expect(Object.fromEntries(endpoint.requests[0])).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'saved-refresh',
      scope:
        'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access',
    })
  })

  it('keeps the long-lived token Microsoft replaces, and presents the newest one', async () => {
    const { endpoint, session, advance } = resumed()
    const rotated = vi.fn()
    session.onRotate = rotated
    await session.accessToken('mail')
    expect(rotated).toHaveBeenLastCalledWith('refresh-1')
    expect(session.refreshToken()).toBe('refresh-1')
    // A token for another service comes from the same sign-in.
    expect(await session.accessToken('graph')).toBe('access-2')
    expect(endpoint.requests[1].get('refresh_token')).toBe('refresh-1')
    expect(endpoint.requests[1].get('scope')).toBe(
      'https://graph.microsoft.com/Mail.Send offline_access',
    )
    expect(rotated).toHaveBeenLastCalledWith('refresh-2')
    // Microsoft may also answer without a replacement; the current one stays.
    endpoint.queue.push(Response.json({ access_token: 'access-x', expires_in: 3600 }))
    advance(60 * 60_000)
    expect(await session.accessToken('mail')).toBe('access-x')
    expect(session.refreshToken()).toBe('refresh-2')
    expect(rotated).toHaveBeenCalledTimes(2)
  })

  it('renews one at a time, so no renewal presents a token another just replaced', async () => {
    const { endpoint, session } = resumed()
    const tokens = await Promise.all([
      session.accessToken('mail'),
      session.accessToken('graph'),
      session.accessToken('mail'),
    ])
    expect(tokens).toEqual(['access-1', 'access-2', 'access-1'])
    expect(endpoint.requests.map((r) => r.get('refresh_token'))).toEqual([
      'saved-refresh',
      'refresh-1',
    ])
  })

  it('asks for a new sign-in once Microsoft ends this one', async () => {
    const { endpoint, session } = resumed()
    endpoint.queue.push(refuse('invalid_grant'))
    const ended = await session.accessToken('mail').catch((e: ProviderError) => e)
    expect(ended).toMatchObject({ code: 'authentication' })
    expect((ended as ProviderError).message).toMatch(/Sign in with Microsoft again/)
    expect((ended as ProviderError).message).not.toContain('saved-refresh')
    // A failure doesn't stop later renewals.
    expect(await session.accessToken('mail')).toBe('access-1')
  })

  it('treats an unreachable or overloaded sign-in service as temporary', async () => {
    const { endpoint, session } = resumed()
    endpoint.queue.push(
      new TypeError('fetch failed'),
      refuse('server_error', 503),
      refuse('x', 429),
    )
    for (let i = 0; i < 3; i++)
      await expect(session.accessToken('mail')).rejects.toMatchObject({ code: 'network' })
    expect(session.refreshToken()).toBe('saved-refresh')
  })

  it('keeps reading mail when only sending another way was never allowed', async () => {
    const { endpoint, session } = resumed()
    endpoint.queue.push(refuse('invalid_grant'))
    await expect(session.accessToken('graph')).rejects.toMatchObject({
      code: 'outgoingAuthentication',
    })
    expect(await session.accessToken('mail')).toBe('access-1')
  })

  it('never puts a token in an error', async () => {
    const { endpoint, session } = resumed()
    endpoint.queue.push(
      Response.json(
        { error: 'invalid_grant', error_description: 'saved-refresh was revoked' },
        { status: 400 },
      ),
    )
    const error = (await session.accessToken('mail').catch((e) => e)) as ProviderError
    expect(JSON.stringify([error.message, error.code])).not.toContain('saved-refresh')
    const typed: MicrosoftSession = session
    expect(typed.personal).toBe(true)
  })
})
