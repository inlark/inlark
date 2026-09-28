import { describe, expect, it } from 'vitest'
import {
  discoverAccount,
  parseAutoconfig,
  serverSettingsSchema,
  serverUrlSchema,
  type DiscoveryResponse,
  type DiscoveryTransport,
  type SrvRecord,
} from '@inlark/core'

type Reply =
  Partial<DiscoveryResponse> | SrvRecord[] | Error | 'hang' | { delay: number; reply: Reply }
const hang = new Promise<never>(() => {})
function fakeTransport(http: Record<string, Reply> = {}, srv: Record<string, Reply> = {}) {
  const gets: { url: string; options: unknown }[] = []
  const lookups: string[] = []
  const settle = async <T>(reply: unknown, map: (r: never) => T): Promise<T> => {
    if (reply === 'hang') return hang
    if (reply instanceof Error) throw reply
    if (reply && typeof reply === 'object' && 'delay' in reply) {
      const { delay, reply: next } = reply as { delay: number; reply: unknown }
      await new Promise((resolve) => setTimeout(resolve, delay))
      return settle(next, map)
    }
    return map(reply as never)
  }
  const transport: DiscoveryTransport = {
    resolveSrv(name) {
      lookups.push(name)
      return settle(srv[name] ?? [], (r: SrvRecord[]) => r)
    },
    get(url, ...rest) {
      expect(rest).toHaveLength(1)
      gets.push({ url, options: rest[0] })
      return settle(http[url] ?? { status: 404 }, (r: Partial<DiscoveryResponse>) => ({
        status: 200,
        headers: {},
        body: '',
        ...r,
      }))
    },
  }
  return { transport, gets, lookups, urls: () => gets.map((g) => g.url) }
}

const email = 'paul.private@example.com'
const wellKnown = 'https://example.com/.well-known/jmap'
const autoconfigUrl = 'https://autoconfig.example.com/mail/config-v1.1.xml'
const wellKnownAutoconfig = 'https://example.com/.well-known/autoconfig/mail/config-v1.1.xml'
const directory = 'https://autoconfig.thunderbird.net/v1.1/example.com'
const srvRecord = (name: string, port: number, priority = 0, weight = 0) => ({
  name,
  port,
  priority,
  weight,
})
const server = (
  tag: string,
  type: string,
  host: string,
  port: number,
  socket: string,
  extra = '',
) =>
  `<${tag} type="${type}"><hostname>${host}</hostname><port>${port}</port><socketType>${socket}</socketType>${extra}</${tag}>`
function config(host: string, body?: string, name = 'Example Mail') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>
    <displayName>${name}</displayName>
    ${
      body ??
      server(
        'incomingServer',
        'imap',
        host,
        993,
        'SSL',
        '<username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>',
      ) +
        server(
          'outgoingServer',
          'smtp',
          host,
          465,
          'SSL',
          '<username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>',
        )
    }
  </emailProvider>
</clientConfig>`
}
const hosts = (result: Awaited<ReturnType<typeof discoverAccount>>) =>
  result.candidates.map((c) =>
    c.protocol === 'jmap' ? `${c.source} ${c.serverUrl}` : `${c.source} ${c.incoming.host}`,
  )

describe('account discovery order', () => {
  it('lists JMAP before IMAP and IMAP sources in fixed order, whichever answers first', async () => {
    const fake = fakeTransport(
      {
        [wellKnown]: { delay: 15, reply: { status: 401 } },
        [autoconfigUrl]: { body: config('autoconfig.example.com') },
        [wellKnownAutoconfig]: { delay: 5, reply: { body: config('wellknown.example.com') } },
        [directory]: { body: config('directory.example.com') },
      },
      {
        '_jmap._tcp.example.com': { delay: 25, reply: [srvRecord('jmap.example.com', 443)] },
        '_imaps._tcp.example.com': [srvRecord('srv.example.com', 993)],
        '_submissions._tcp.example.com': [srvRecord('srv.example.com', 465)],
      },
    )
    const result = await discoverAccount(email, fake.transport)
    expect(result.domain).toBe('example.com')
    expect(hosts(result)).toEqual([
      'jmap-srv https://jmap.example.com',
      'jmap-well-known https://example.com',
      'autoconfig autoconfig.example.com',
      'autoconfig wellknown.example.com',
      'imap-srv srv.example.com',
    ])
    // The domain published settings, so the public directory was never asked.
    expect(fake.urls()).not.toContain(directory)
    for (const c of result.candidates) {
      if (c.protocol === 'jmap') expect(serverUrlSchema.safeParse(c.serverUrl).success).toBe(true)
      else {
        expect(serverSettingsSchema.parse(c.incoming)).toEqual(c.incoming)
        expect(serverSettingsSchema.parse(c.outgoing)).toEqual(c.outgoing)
      }
    }
  })

  it('keeps only the earliest of identical candidates', async () => {
    const fake = fakeTransport(
      {
        [wellKnown]: { status: 401 },
        [autoconfigUrl]: { body: config('mail.example.com') },
        [wellKnownAutoconfig]: { body: config('mail.example.com') },
        [directory]: { body: config('mail.example.com', undefined, 'Directory name') },
      },
      { '_jmap._tcp.example.com': [srvRecord('example.com', 443)] },
    )
    const result = await discoverAccount(email, fake.transport)
    expect(result.candidates).toEqual([
      { protocol: 'jmap', source: 'jmap-srv', serverUrl: 'https://example.com', username: email },
      {
        protocol: 'imap',
        source: 'autoconfig',
        provider: 'Example Mail',
        incoming: { host: 'mail.example.com', port: 993, security: 'tls', username: email },
        outgoing: { host: 'mail.example.com', port: 465, security: 'tls', username: email },
      },
    ])
  })
})

describe('account discovery privacy and bounds', () => {
  it('sends only the domain, anonymously, over HTTPS', async () => {
    const fake = fakeTransport()
    await discoverAccount(`  ${email.replace('example.com', 'Example.COM')} `, fake.transport)
    expect(fake.urls().sort()).toEqual(
      [wellKnown, autoconfigUrl, wellKnownAutoconfig, directory].sort(),
    )
    expect(fake.lookups.sort()).toEqual(
      [
        '_jmap._tcp.example.com',
        '_imaps._tcp.example.com',
        '_imap._tcp.example.com',
        '_submissions._tcp.example.com',
        '_submission._tcp.example.com',
      ].sort(),
    )
    for (const { url, options } of fake.gets) {
      expect(url.startsWith('https://')).toBe(true)
      expect(url).not.toMatch(/paul|private|@|emailaddress/i)
      expect(options).toEqual({ timeoutMs: 6000, maxBytes: 256 * 1024 })
    }
    for (const name of fake.lookups) expect(name).not.toMatch(/paul|private|@/)
  })

  it('rejects malformed addresses and skips IP-literal domains without any request', async () => {
    const fake = fakeTransport()
    await expect(discoverAccount('no-at-sign', fake.transport)).rejects.toThrow(/valid email/)
    await expect(discoverAccount('@example.com', fake.transport)).rejects.toThrow(/valid email/)
    await expect(discoverAccount('a@exa mple.com', fake.transport)).rejects.toThrow(/valid email/)
    await expect(discoverAccount('a@example.com/x', fake.transport)).rejects.toThrow(/valid email/)
    expect((await discoverAccount('a@[192.0.2.1]', fake.transport)).candidates).toEqual([])
    expect((await discoverAccount('a@192.0.2.1', fake.transport)).candidates).toEqual([])
    expect(fake.gets).toEqual([])
    expect(fake.lookups).toEqual([])
  })

  it('ignores oversized responses', async () => {
    const huge = config('mail.example.com').replace(
      '<domain>',
      `<!-- ${'x'.repeat(256 * 1024)} --><domain>`,
    )
    const fake = fakeTransport({ [autoconfigUrl]: { body: huge } })
    expect((await discoverAccount(email, fake.transport)).candidates).toEqual([])
    expect(() => parseAutoconfig(huge, email)).toThrow(/too large/)
  })

  it('keeps other sources when one fails or never answers', async () => {
    const fake = fakeTransport(
      {
        [wellKnown]: new Error('connection reset'),
        [autoconfigUrl]: 'hang',
        [wellKnownAutoconfig]: { body: '<clientConfig><broken' },
        [directory]: { body: config('directory.example.com') },
      },
      {
        '_jmap._tcp.example.com': new Error('SERVFAIL'),
        '_imaps._tcp.example.com': 'hang',
        '_imap._tcp.example.com': [srvRecord('imap.example.com', 143)],
        '_submission._tcp.example.com': [srvRecord('smtp.example.com', 587)],
      },
    )
    const result = await discoverAccount(email, fake.transport, { requestTimeoutMs: 20 })
    expect(result.candidates).toEqual([
      {
        protocol: 'imap',
        source: 'imap-srv',
        incoming: { host: 'imap.example.com', port: 143, security: 'starttls', username: email },
        outgoing: { host: 'smtp.example.com', port: 587, security: 'starttls', username: email },
      },
    ])
  })

  it('asks the public directory only when the domain publishes nothing', async () => {
    const fake = fakeTransport({ [directory]: { body: config('directory.example.com') } })
    const result = await discoverAccount(email, fake.transport)
    expect(result.candidates).toEqual([
      expect.objectContaining({ source: 'directory', provider: 'Example Mail' }),
    ])
    expect(fake.urls()).toContain(directory)
  })

  it('returns what it found by the deadline', async () => {
    const fake = fakeTransport(
      { [wellKnown]: { status: 401 }, [autoconfigUrl]: 'hang', [directory]: 'hang' },
      { '_jmap._tcp.example.com': 'hang' },
    )
    const started = Date.now()
    const result = await discoverAccount(email, fake.transport, {
      deadlineMs: 30,
      requestTimeoutMs: 1000,
    })
    expect(Date.now() - started).toBeLessThan(500)
    expect(hosts(result)).toEqual(['jmap-well-known https://example.com'])
  })
})

describe('JMAP discovery', () => {
  it('uses the best SRV record and ignores "." targets', async () => {
    const pick = async (records: SrvRecord[]) =>
      hosts(
        await discoverAccount(
          email,
          fakeTransport({}, { '_jmap._tcp.example.com': records }).transport,
        ),
      )
    expect(await pick([srvRecord('.', 0)])).toEqual([])
    expect(
      await pick([
        srvRecord('backup.example.net.', 443, 20, 100),
        srvRecord('light.example.net.', 443, 10, 1),
        srvRecord('Heavy.Example.NET.', 8443, 10, 50),
        srvRecord('.', 443, 0, 0),
      ]),
    ).toEqual(['jmap-srv https://heavy.example.net:8443'])
  })

  it('treats a session or an authentication challenge as evidence', async () => {
    const found = async (reply: Reply) =>
      hosts(await discoverAccount(email, fakeTransport({ [wellKnown]: reply }).transport))
    expect(await found({ status: 401 })).toEqual(['jmap-well-known https://example.com'])
    // A blanket firewall 403 must not outrank real IMAP settings.
    expect(await found({ status: 403 })).toEqual([])
    expect(await found({ body: '{"capabilities":{"urn:ietf:params:jmap:core":{}}}' })).toEqual([
      'jmap-well-known https://example.com',
    ])
    expect(await found({ status: 404 })).toEqual([])
    expect(await found({ body: '<html>Welcome</html>' })).toEqual([])
    expect(await found({ body: '{"capabilities":null}' })).toEqual([])
    expect(await found({ status: 500 })).toEqual([])
  })

  it('follows HTTPS redirects and reports the final origin', async () => {
    const crossHost = fakeTransport({
      [wellKnown]: {
        status: 301,
        headers: { location: 'https://jmap.example.net/.well-known/jmap' },
      },
      'https://jmap.example.net/.well-known/jmap': { status: 401 },
    })
    expect(hosts(await discoverAccount(email, crossHost.transport))).toEqual([
      'jmap-well-known https://jmap.example.net',
    ])
    const relative = fakeTransport({
      [wellKnown]: { status: 307, headers: { location: '/jmap/session#ignored' } },
      'https://example.com/jmap/session': { body: '{"capabilities":{}}' },
    })
    expect(hosts(await discoverAccount(email, relative.transport))).toEqual([
      'jmap-well-known https://example.com/jmap/session',
    ])
  })

  it('stops after three redirects and never downgrades to HTTP', async () => {
    const chain = fakeTransport({
      [wellKnown]: { status: 302, headers: { location: 'https://a.example.com/' } },
      'https://a.example.com/': { status: 302, headers: { location: 'https://b.example.com/' } },
      'https://b.example.com/': { status: 302, headers: { location: 'https://c.example.com/' } },
      'https://c.example.com/': { status: 302, headers: { location: 'https://d.example.com/' } },
      'https://d.example.com/': { status: 401 },
    })
    expect((await discoverAccount(email, chain.transport)).candidates).toEqual([])
    expect(chain.urls()).not.toContain('https://d.example.com/')
    expect(chain.urls()).toContain('https://c.example.com/')

    const threeHops = fakeTransport({
      [wellKnown]: { status: 302, headers: { location: 'https://a.example.com/' } },
      'https://a.example.com/': { status: 302, headers: { location: 'https://b.example.com/' } },
      'https://b.example.com/': { status: 308, headers: { location: 'https://c.example.com/x' } },
      'https://c.example.com/x': { status: 401 },
    })
    expect(hosts(await discoverAccount(email, threeHops.transport))).toEqual([
      'jmap-well-known https://c.example.com/x',
    ])

    const downgrade = fakeTransport({
      [wellKnown]: { status: 301, headers: { location: 'http://example.com/.well-known/jmap' } },
      [autoconfigUrl]: { status: 302, headers: { location: 'http://autoconfig.example.com/' } },
      'http://example.com/.well-known/jmap': { status: 401 },
    })
    expect((await discoverAccount(email, downgrade.transport)).candidates).toEqual([])
    expect(downgrade.urls().every((url) => url.startsWith('https://'))).toBe(true)
  })
})

describe('IMAP SRV discovery', () => {
  it('prefers implicit TLS and needs both directions', async () => {
    const both = fakeTransport(
      {},
      {
        '_imaps._tcp.example.com': [srvRecord('imap.example.com.', 993)],
        '_imap._tcp.example.com': [srvRecord('imap.example.com.', 143)],
        '_submissions._tcp.example.com': [srvRecord('.', 0)],
        '_submission._tcp.example.com': [srvRecord('smtp.example.com.', 587)],
      },
    )
    expect((await discoverAccount(email, both.transport)).candidates).toEqual([
      {
        protocol: 'imap',
        source: 'imap-srv',
        incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: email },
        outgoing: { host: 'smtp.example.com', port: 587, security: 'starttls', username: email },
      },
    ])
    const incomingOnly = fakeTransport(
      {},
      { '_imaps._tcp.example.com': [srvRecord('imap.example.com', 993)] },
    )
    expect((await discoverAccount(email, incomingOnly.transport)).candidates).toEqual([])
  })
})

describe('autoconfig parsing', () => {
  const auth = (...methods: string[]) =>
    methods.map((m) => `<authentication>${m}</authentication>`).join('')
  const smtp = server('outgoingServer', 'smtp', 'smtp.example.com', 587, 'STARTTLS')

  it('substitutes placeholders and prefers TLS entries', () => {
    const parsed = parseAutoconfig(
      config(
        '',
        server(
          'incomingServer',
          'imap',
          'imap.%EMAILDOMAIN%',
          143,
          'STARTTLS',
          '<username>%EMAILLOCALPART%</username>',
        ) +
          server('incomingServer', 'pop3', 'pop.example.com', 995, 'SSL') +
          server(
            'incomingServer',
            'IMAP',
            'IMAP.%EMAILDOMAIN%.',
            993,
            'SSL',
            `<username>%EMAILADDRESS%</username>${auth('OAuth2', 'password-encrypted')}`,
          ) +
          smtp,
      ),
      'Paul@Example.com',
    )
    expect(parsed).toEqual({
      provider: 'Example Mail',
      incoming: [
        { host: 'imap.example.com', port: 143, security: 'starttls', username: 'Paul' },
        { host: 'imap.example.com', port: 993, security: 'tls', username: 'Paul@Example.com' },
      ],
      outgoing: [
        { host: 'smtp.example.com', port: 587, security: 'starttls', username: 'Paul@Example.com' },
      ],
    })
  })

  it('drops plaintext, OAuth-only, and invalid servers', () => {
    const parsed = parseAutoconfig(
      config(
        '',
        server('incomingServer', 'imap', 'plain.example.com', 143, 'plain') +
          server('incomingServer', 'imap', 'oauth.example.com', 993, 'SSL', auth('OAuth2')) +
          server('incomingServer', 'imap', 'krb.example.com', 993, 'SSL', auth('GSSAPI', 'NTLM')) +
          server(
            'incomingServer',
            'imap',
            'cert.example.com',
            993,
            'SSL',
            auth('client-IP-address', 'TLS-client-cert'),
          ) +
          server('incomingServer', 'imap', 'bad_host!.example.com', 993, 'SSL') +
          server('incomingServer', 'imap', 'https://imap.example.com', 993, 'SSL') +
          server('incomingServer', 'imap', 'port.example.com', 99999, 'SSL') +
          server('incomingServer', 'imap', 'port.example.com', 0, 'SSL') +
          server('outgoingServer', 'smtp', 'open.example.com', 25, 'STARTTLS', auth('none')),
      ),
      email,
    )
    expect(parsed.incoming).toEqual([])
    expect(parsed.outgoing).toEqual([])
  })

  it('needs an incoming and an outgoing server for a candidate', async () => {
    const fake = fakeTransport({
      [autoconfigUrl]: {
        body: config('', server('incomingServer', 'imap', 'imap.example.com', 993, 'SSL')),
      },
    })
    expect((await discoverAccount(email, fake.transport)).candidates).toEqual([])
  })

  it('decodes predefined and numeric entities, comments, and CDATA', () => {
    const parsed = parseAutoconfig(
      `<clientConfig><!-- note --><emailProvider id='x'>
        <displayName>A &amp; B &#x4D;ail &#77;<![CDATA[ <co> ]]>${'x'.repeat(200)}</displayName>
        ${server('incomingServer', 'imap', 'imap.example.com', 993, 'SSL', '<username>a&apos;b</username>')}
        <outgoingServer type="smtp"/>
      </emailProvider></clientConfig>`,
      email,
    )
    expect(parsed.provider).toBe(`A & B Mail M <co> ${'x'.repeat(200)}`.slice(0, 100))
    expect(parsed.incoming[0].username).toBe("a'b")
    expect(parsed.outgoing).toEqual([])
  })

  it('rejects DTDs, entities, processing instructions, and malformed XML', () => {
    const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>
<clientConfig><emailProvider><displayName>&lol2;</displayName></emailProvider></clientConfig>`
    const deep = `<clientConfig>${'<a>'.repeat(40)}${'</a>'.repeat(40)}</clientConfig>`
    const many = `<clientConfig>${'<a/>'.repeat(5000)}</clientConfig>`
    for (const xml of [
      laughs,
      '<!ENTITY x "y"><clientConfig/>',
      '<clientConfig><?php echo 1 ?></clientConfig>',
      '<?xml-stylesheet href="x"?><clientConfig/>',
      '<clientConfig><displayName>&custom;</displayName></clientConfig>',
      '<clientConfig><displayName>&#0;</displayName></clientConfig>',
      '<clientConfig><displayName>a & b</displayName></clientConfig>',
      '<clientConfig><emailProvider></clientConfig>',
      '<clientConfig a="1" a="2"/>',
      '<clientConfig/><clientConfig/>',
      '<clientConfig/>trailing',
      '<clientConfig><!-- unterminated </clientConfig>',
      deep,
      many,
      '',
    ])
      expect(() => parseAutoconfig(xml, email), xml.slice(0, 60)).toThrow()
    expect(() => parseAutoconfig('<other/>', email)).toThrow(/autoconfig/)
  })

  it('never lets a malicious file escape discovery', async () => {
    const fake = fakeTransport({
      [autoconfigUrl]: {
        body: `<!DOCTYPE x [<!ENTITY a "${'a'.repeat(1000)}">]><clientConfig/>`,
      },
      [directory]: { body: config('directory.example.com') },
    })
    expect(hosts(await discoverAccount(email, fake.transport))).toEqual([
      'directory directory.example.com',
    ])
  })
})
