import { describe, it, expect, vi } from 'vitest'
import { JmapProvider, jmapFilter, jmapPatch, parseUnsubscribe } from '../packages/jmap/src'
import { ipcSchemas } from '../packages/core/src'
const core = 'urn:ietf:params:jmap:core',
  mail = 'urn:ietf:params:jmap:mail',
  submission = 'urn:ietf:params:jmap:submission'
const session = {
  apiUrl: 'https://mail.example/jmap',
  uploadUrl: 'https://mail.example/upload/{accountId}',
  downloadUrl: 'https://mail.example/download/{accountId}/{blobId}/{name}?type={type}',
  username: 'user@example.com',
  accounts: { a: { name: 'Personal', accountCapabilities: { [mail]: {}, [submission]: {} } } },
  capabilities: {
    [core]: { maxObjectsInGet: 100, maxObjectsInSet: 100 },
    [mail]: {},
    [submission]: {},
  },
  primaryAccounts: { [mail]: 'a' },
  state: '1',
}
const raw = (id: string) => ({
  id,
  threadId: 'thread-' + id,
  receivedAt: '2026-09-23T10:00:00Z',
  subject: 'Sample',
  from: [{ email: 'sender@example.com', name: 'Sender' }],
  mailboxIds: { inbox: true },
  keywords: { $seen: true },
})
function fixture(overrides: Record<string, (args: any) => any> = {}, downloadBody?: string) {
  const calls: { name: string; args: any }[] = []
  const fetch = vi.fn(async (_url: any, init?: RequestInit) => {
    if (String(_url).includes('/download/') && downloadBody !== undefined)
      return new Response(downloadBody)
    if (!init?.body) return Response.json(session)
    const request = JSON.parse(String(init.body))
    return Response.json({
      methodResponses: request.methodCalls.map(([name, args, tag]: any) => {
        calls.push({ name, args })
        const response =
          overrides[name]?.(args) ??
          (
            {
              'Mailbox/get': {
                list: [
                  {
                    id: 'inbox',
                    name: 'Inbox',
                    role: 'inbox',
                    myRights: { mayReadItems: true },
                    totalEmails: 50_000,
                    unreadEmails: 1,
                  },
                ],
              },
              'Email/query': {
                ids: Array.from({ length: args.limit || 0 }, (_, i) =>
                  String((args.position || 0) + i),
                ),
                total: 50_000,
              },
              'Email/get': { list: (args.ids || []).map(raw) },
              'Thread/get': {
                list: (args.ids || []).map((id: string) => ({
                  id,
                  emailIds: [id.replace('thread-', '')],
                })),
              },
              'Email/set': { updated: {}, notUpdated: { bad: { type: 'forbidden' } } },
            } as any
          )[name]
        return [name, response, tag]
      }),
    })
  }) as unknown as typeof globalThis.fetch
  const provider = new JmapProvider({
    serverUrl: 'https://mail.example',
    connectionId: 'test',
    name: 'Test',
    authorization: 'Basic disposable',
    fetch,
  })
  return { provider, fetch, calls }
}
describe('JMAP provider', () => {
  it('loads only one conversation page from a 50k inbox and no bodies', async () => {
    const { provider, calls } = fixture()
    const [account] = await provider.connect()
    const page = await provider.query(account, { view: 'inbox' })
    expect(page.items).toHaveLength(50)
    expect(page.total).toBe(50_000)
    expect(page.next).toBe(50)
    const emailGets = calls.filter((c) => c.name === 'Email/get')
    expect(emailGets.flatMap((c) => c.args.ids)).toHaveLength(50)
    expect(emailGets.every((c) => !c.args.fetchAllBodyValues)).toBe(true)
    expect(calls.find((c) => c.name === 'Email/query')?.args.collapseThreads).toBe(true)
  })
  it('normalizes addresses without display names', async () => {
    const { provider } = fixture({
      'Email/get': () => ({
        list: [
          {
            ...raw('unnamed'),
            from: [{ email: 'sender@example.com', name: null }],
            to: [{ email: 'recipient@example.com', name: null }],
            cc: [{ email: 'cc@example.com' }],
            bcc: [{ email: 'bcc@example.com', name: null }],
            replyTo: [{ email: 'reply@example.com', name: null }],
          },
        ],
      }),
    })
    const [account] = await provider.connect()
    const [message] = await provider.messages(account, ['unnamed'])
    expect(message.from).toEqual([{ email: 'sender@example.com', name: '' }])
    expect(message.to).toEqual([{ email: 'recipient@example.com', name: '' }])
    expect(message.cc).toEqual([{ email: 'cc@example.com', name: '' }])
    expect(message.bcc).toEqual([{ email: 'bcc@example.com', name: '' }])
    expect(message.replyTo).toEqual([{ email: 'reply@example.com', name: '' }])
  })
  it('omits null optional attachment fields before forwarding through IPC', async () => {
    const { provider } = fixture({
      'Email/get': () => ({
        list: [
          {
            ...raw('forward'),
            bodyStructure: {
              type: 'multipart/mixed',
              subParts: [
                {
                  blobId: 'attachment-blob',
                  name: 'report.pdf',
                  type: 'application/pdf',
                  size: 42,
                  cid: null,
                  disposition: 'attachment',
                },
                {
                  blobId: 'inline-blob',
                  name: null,
                  type: 'image/png',
                  size: 12,
                  cid: 'logo@example.com',
                  disposition: null,
                },
              ],
            },
          },
        ],
      }),
    })
    const [account] = await provider.connect()
    const [message] = await provider.messages(account, ['forward'], true)
    expect(message.attachments).toEqual([
      {
        blobId: 'attachment-blob',
        name: 'report.pdf',
        type: 'application/pdf',
        size: 42,
        disposition: 'attachment',
      },
      {
        blobId: 'inline-blob',
        name: 'attachment',
        type: 'image/png',
        size: 12,
        cid: 'logo@example.com',
      },
    ])
    expect(
      ipcSchemas.stageRemoteAttachments.safeParse([account.id, message.attachments]).success,
    ).toBe(true)
  })
  it('sends with the name chosen in the app, falling back to the server identity name', async () => {
    const { provider } = fixture({
      'Identity/get': () => ({
        list: [{ id: 'i1', name: 'Server Name', email: 'user@example.com' }],
      }),
    })
    const [account] = await provider.connect()
    expect((await provider.identities(account))[0].name).toBe('Server Name')
    const [identity] = await provider.identities({ ...account, senderName: 'Jane Doe' })
    expect(identity).toMatchObject({ name: 'Jane Doe', email: 'user@example.com' })
  })
  it('passes full-history filters and page offsets to the server', async () => {
    const { provider, calls } = fixture()
    const [account] = await provider.connect()
    await provider.query(
      account,
      { view: 'all', text: 'invoice', from: 'vendor@example.com', hasAttachment: true },
      49_950,
    )
    const q = calls.find((c) => c.name === 'Email/query')!.args
    expect(q.position).toBe(49_950)
    expect(JSON.stringify(q.filter)).toContain('vendor@example.com')
    expect(JSON.stringify(q.filter)).toContain('invoice')
  })
  it('uses the JMAP mailbox exclusion filter for starred mail and search', async () => {
    const mailboxes = [
      { id: 'spam-id', role: 'junk' },
      { id: 'trash-id', role: 'trash' },
    ] as Parameters<typeof jmapFilter>[1]
    expect(jmapFilter({ view: 'starred' }, mailboxes)).toEqual({
      operator: 'AND',
      conditions: [{ inMailboxOtherThan: ['spam-id', 'trash-id'] }, { hasKeyword: '$flagged' }],
    })
    expect(jmapFilter({ view: 'all', text: 'invoice' }, mailboxes)).toEqual({
      operator: 'AND',
      conditions: [{ inMailboxOtherThan: ['spam-id', 'trash-id'] }, { text: 'invoice' }],
    })
    expect(jmapFilter({ view: 'all' }, [])).toEqual({})
  })
  it('recovers an HTML body from nested MIME parts when htmlBody is empty', async () => {
    const { provider } = fixture({
      'Email/get': () => ({
        list: [
          {
            ...raw('nested'),
            htmlBody: [{ type: 'text/html', partId: 'empty-part' }],
            bodyStructure: {
              type: 'multipart/alternative',
              subParts: [{ type: 'text/html', partId: 'html-part' }],
            },
            bodyValues: {
              'empty-part': { value: '   ' },
              'html-part': { value: '<p>Visible body</p>' },
            },
          },
        ],
      }),
    })
    const [account] = await provider.connect()
    expect((await provider.messages(account, ['nested'], true))[0].html).toBe('<p>Visible body</p>')
  })
  it('recovers a missing body value from its JMAP part blob', async () => {
    const { provider, fetch } = fixture(
      {
        'Email/get': () => ({
          list: [
            {
              ...raw('blob'),
              htmlBody: [{ type: 'text/html', blobId: 'body-blob', size: 21 }],
              bodyValues: {},
            },
          ],
        }),
      },
      '<p>Recovered body</p>',
    )
    const [account] = await provider.connect()
    expect((await provider.messages(account, ['blob'], true))[0].html).toBe('<p>Recovered body</p>')
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/download/'))).toBe(true)
  })
  it('surfaces per-object mutation failures', async () => {
    const { provider } = fixture()
    const [a] = await provider.connect()
    const result = await provider.update(a, { bad: { keywords: { $seen: true } } })
    expect(result.updated).toEqual([])
    expect(result.failures).toEqual(['bad: forbidden'])
  })
  it('accepts same-origin discovery redirects and rejects cross-origin endpoints', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/session' } }))
      .mockResolvedValueOnce(Response.json(session))
    const p = new JmapProvider({
      serverUrl: 'https://mail.example',
      connectionId: 'c',
      name: '',
      authorization: 'test',
      fetch,
    })
    expect(await p.connect()).toHaveLength(1)
    expect(fetch.mock.calls[1][0]).toBe('https://mail.example/session')
    const foreign = new JmapProvider({
      serverUrl: 'https://mail.example',
      connectionId: 'c',
      name: '',
      authorization: 'test',
      fetch: vi
        .fn()
        .mockResolvedValue(Response.json({ ...session, apiUrl: 'https://elsewhere.example/api' })),
    })
    await expect(foreign.connect()).rejects.toThrow('another origin')
  })
  it('reports rate limits without automatically replaying writes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '60' } }))
    const p = new JmapProvider({
      serverUrl: 'https://mail.example',
      connectionId: 'c',
      name: '',
      authorization: 'test',
      fetch,
    })
    const [a] = await p.connect()
    await expect(p.update(a, { m: { keywords: { $seen: true } } })).rejects.toMatchObject({
      code: 'rateLimit',
      retryAfter: 60,
    })
    await expect(p.update(a, { m: { keywords: { $seen: true } } })).rejects.toMatchObject({
      code: 'rateLimit',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('uses the operation snapshot state and surfaces stale writes without retrying', async () => {
    const { provider, calls } = fixture({
      'Email/get': (args) => ({ list: args.ids.map(raw), state: 'snapshot' }),
    })
    const [account] = await provider.connect()
    await provider.messages(account, ['1'])
    const expected = provider.getStateToken(account)
    expect(expected).toBe('snapshot')
    await provider.update(account, { bad: { keywords: { $seen: true } } }, [], expected)
    expect(calls.find((c) => c.name === 'Email/set')!.args.ifInState).toBe('snapshot')
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(
        Response.json({ methodResponses: [['error', { type: 'stateMismatch' }, 's']] }),
      )
    const stale = new JmapProvider({
      serverUrl: 'https://mail.example',
      connectionId: 'c',
      name: '',
      authorization: 'test',
      fetch,
    })
    const [a] = await stale.connect()
    await expect(
      stale.update(a, { m: { keywords: { $seen: true } } }, [], 'old'),
    ).rejects.toMatchObject({ code: 'stateMismatch' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('translates typed changes into escaped JMAP patch paths', () => {
    expect(
      jmapPatch({ mailboxes: { inbox: false, 'custom/a~b': true }, keywords: { $seen: true } }),
    ).toEqual({
      'mailboxIds/inbox': null,
      'mailboxIds/custom~1a~0b': true,
      'keywords/$seen': true,
    })
  })
  it('recognizes only supported unsubscribe destinations', () => {
    expect(
      parseUnsubscribe('<https://list.example/unsubscribe>', 'List-Unsubscribe=One-Click'),
    ).toEqual({ url: 'https://list.example/unsubscribe', oneClick: true })
    expect(parseUnsubscribe('<javascript:alert(1)>')).toBeUndefined()
  })
})
