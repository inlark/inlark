import type { DiscoveryCandidate, DiscoveryResult, DiscoverySource, ServerSettings } from './model'
import { serverSettingsSchema, serverUrlSchema } from './schemas'

export interface SrvRecord {
  name: string
  port: number
  priority: number
  weight: number
}
export interface DiscoveryResponse {
  status: number
  /** Lowercase header names. */
  headers: Record<string, string>
  body: string
}
/** Platform adapter for discovery. It never receives credentials, cookies, or the address itself. */
export interface DiscoveryTransport {
  /** Resolves SRV records. Resolves [] when none exist (NXDOMAIN/NODATA). */
  resolveSrv(name: string): Promise<SrvRecord[]>
  /** One unauthenticated GET. Never follows redirects, never sends credentials or cookies, and stops reading after maxBytes (reject). */
  get(url: string, options: { timeoutMs: number; maxBytes: number }): Promise<DiscoveryResponse>
}
export interface DiscoveryOptions {
  /** Discovery returns whatever it found by then. */
  deadlineMs?: number
  requestTimeoutMs?: number
}

const maxBytes = 256 * 1024
const maxRedirects = 3
const dnsName = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/
const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Finds likely server settings for an address. Only the domain leaves the device: requests are
 * unauthenticated, bounded, HTTPS-only, and the public directory is only consulted, with the
 * domain alone, when the domain publishes no settings itself.
 * Throws for a malformed address; an IP-literal domain has nothing to discover and yields no
 * candidates. Individual sources that fail, time out, or return malformed data are skipped.
 */
export async function discoverAccount(
  email: string,
  transport: DiscoveryTransport,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const address = email.trim()
  const at = address.lastIndexOf('@')
  const local = address.slice(0, at)
  const rawDomain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (at < 1 || !rawDomain || address.length > 320 || /\s/.test(local))
    throw new Error('Enter a valid email address.')
  if (rawDomain.startsWith('[') || ipv4.test(rawDomain))
    return { email: address, domain: rawDomain, candidates: [] }
  const domain = asciiDomain(rawDomain)
  if (!domain) throw new Error('Enter a valid email address.')
  if (ipv4.test(domain)) return { email: address, domain, candidates: [] }

  const timeoutMs = options.requestTimeoutMs ?? 6000
  const context: Context = { transport, timeoutMs, email: address }
  const autoconfigUrls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  ]
  // Listed in order of preference; they run concurrently and are ordered afterwards.
  const sources: (() => Promise<DiscoveryCandidate[]>)[] = [
    () => jmapSrv(context, domain),
    () => jmapWellKnown(context, domain),
    ...autoconfigUrls.map((url) => () => autoconfig(context, url, 'autoconfig')),
    () => imapSrv(context, domain),
  ]
  const deadline = Date.now() + (options.deadlineMs ?? 15000)
  const run = async (list: (() => Promise<DiscoveryCandidate[]>)[]) => {
    const found: (DiscoveryCandidate[] | undefined)[] = list.map(() => undefined)
    const all = Promise.allSettled(
      list.map(async (source, index) => {
        found[index] = await source()
      }),
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      all,
      new Promise<void>(
        (resolve) => (timer = setTimeout(resolve, Math.max(0, deadline - Date.now()))),
      ),
    ])
    clearTimeout(timer)
    return found.flatMap((c) => c || [])
  }
  let found = await run(sources)
  // The public directory learns which domain is being set up, so it is only asked when the
  // domain itself publishes nothing. Self-hosted domains are never disclosed to it.
  if (!found.length && Date.now() < deadline)
    found = await run([
      () =>
        autoconfig(
          context,
          `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`,
          'directory',
        ),
    ])
  const seen = new Set<string>()
  const candidates = found.filter((c) => {
    const key = candidateKey(c)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    email: address,
    domain,
    candidates: [
      ...candidates.filter((c) => c.protocol === 'jmap'),
      ...candidates.filter((c) => c.protocol === 'imap'),
    ],
  }
}

interface Context {
  transport: DiscoveryTransport
  timeoutMs: number
  email: string
}

function asciiDomain(value: string): string | undefined {
  if (/[/?#@:\\%\s]/.test(value)) return undefined
  try {
    // URL applies IDNA, so internationalised domains are looked up in their ASCII form.
    const host = new URL(`https://${value}/`).hostname
    return dnsName.test(host) ? host : undefined
  } catch {
    return undefined
  }
}
function candidateKey(c: DiscoveryCandidate): string {
  const server = (s: ServerSettings) => [s.host, s.port, s.security, s.username]
  return JSON.stringify(
    c.protocol === 'jmap'
      ? ['jmap', c.serverUrl, c.username]
      : ['imap', server(c.incoming), server(c.outgoing)],
  )
}
/** Guards against transports that ignore their own timeout. */
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>(
      (_, reject) => (timer = setTimeout(() => reject(new Error('Request timed out.')), ms)),
    ),
  ]).finally(() => clearTimeout(timer))
}
async function srv(context: Context, name: string): Promise<SrvRecord | undefined> {
  const records = await bounded(context.transport.resolveSrv(name), context.timeoutMs)
  // RFC 2782: a lone "." target means the service is deliberately not offered.
  return records
    .map((r) => ({ ...r, name: r.name.toLowerCase().replace(/\.$/, '') }))
    .filter((r) => dnsName.test(r.name) && Number.isInteger(r.port) && r.port > 0 && r.port < 65536)
    .sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
}
/** Follows up to three HTTPS redirects itself, so every hop is checked before it is requested. */
async function fetchFollowing(
  context: Context,
  start: string,
): Promise<{ url: URL; response: DiscoveryResponse }> {
  let url = new URL(start)
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Discovery only follows HTTPS addresses.')
    url.hash = ''
    const response = await bounded(
      context.transport.get(url.toString(), { timeoutMs: context.timeoutMs, maxBytes }),
      context.timeoutMs,
    )
    if (response.body.length > maxBytes) throw new Error('Discovery response is too large.')
    const location = response.headers.location
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return { url, response }
    if (hop >= maxRedirects) throw new Error('Too many redirects.')
    url = new URL(location, url)
  }
}
async function jmapSrv(context: Context, domain: string): Promise<DiscoveryCandidate[]> {
  const record = await srv(context, `_jmap._tcp.${domain}`)
  if (!record) return []
  const serverUrl = `https://${record.name}${record.port === 443 ? '' : `:${record.port}`}`
  return [{ protocol: 'jmap', source: 'jmap-srv', serverUrl, username: context.email }]
}
async function jmapWellKnown(context: Context, domain: string): Promise<DiscoveryCandidate[]> {
  const { url, response } = await fetchFollowing(context, `https://${domain}/.well-known/jmap`)
  const evidence =
    // RFC 8620 requires authentication here. A 403 is too often a blanket firewall answer.
    response.status === 401 || (response.status === 200 && hasCapabilities(response.body))
  if (!evidence) return []
  // The provider only authenticates to the configured origin, so show where the redirects ended.
  const serverUrl = url.pathname === '/.well-known/jmap' ? url.origin : url.toString()
  if (!serverUrlSchema.safeParse(serverUrl).success) return []
  return [{ protocol: 'jmap', source: 'jmap-well-known', serverUrl, username: context.email }]
}
function hasCapabilities(body: string): boolean {
  try {
    const session: unknown = JSON.parse(body)
    return (
      typeof session === 'object' &&
      session !== null &&
      typeof (session as { capabilities?: unknown }).capabilities === 'object' &&
      (session as { capabilities?: unknown }).capabilities !== null
    )
  } catch {
    return false
  }
}
async function autoconfig(
  context: Context,
  url: string,
  source: DiscoverySource,
): Promise<DiscoveryCandidate[]> {
  const { response } = await fetchFollowing(context, url)
  if (response.status !== 200) return []
  const config = parseAutoconfig(response.body, context.email)
  const incoming = preferTls(config.incoming)
  const outgoing = preferTls(config.outgoing)
  if (!incoming || !outgoing) return []
  return [
    {
      protocol: 'imap',
      source,
      incoming,
      outgoing,
      ...(config.provider ? { provider: config.provider } : {}),
    },
  ]
}
const preferTls = (servers: ServerSettings[]) =>
  servers.find((s) => s.security === 'tls') || servers[0]
async function imapSrv(context: Context, domain: string): Promise<DiscoveryCandidate[]> {
  const lookup = async (service: string, security: ServerSettings['security']) => {
    const record = await srv(context, `_${service}._tcp.${domain}`).catch(() => undefined)
    if (!record) return undefined
    const settings = { host: record.name, port: record.port, security, username: context.email }
    return serverSettingsSchema.safeParse(settings).success ? settings : undefined
  }
  // RFC 8314 prefers implicit TLS over STARTTLS when both are published.
  const [imaps, imap, submissions, submission] = await Promise.all([
    lookup('imaps', 'tls'),
    lookup('imap', 'starttls'),
    lookup('submissions', 'tls'),
    lookup('submission', 'starttls'),
  ])
  const incoming = imaps || imap
  const outgoing = submissions || submission
  return incoming && outgoing ? [{ protocol: 'imap', source: 'imap-srv', incoming, outgoing }] : []
}

const passwordAuth = new Set([
  'password-cleartext',
  'password-encrypted',
  // Older configuration files use these names for the same methods.
  'plain',
  'secure',
])
/**
 * Reads the IMAP and SMTP servers from a Thunderbird autoconfig file. Plaintext connections and
 * servers that only offer OAuth, Kerberos, NTLM, client certificates, or no authentication are
 * left out. Throws when the XML is malformed or uses constructs outside the tiny safe subset.
 */
export function parseAutoconfig(
  xml: string,
  email: string,
): { provider?: string; incoming: ServerSettings[]; outgoing: ServerSettings[] } {
  const root = parseXml(xml)
  if (root.name !== 'clientConfig') throw new Error('Not an autoconfig file.')
  const provider = root.children.find((c) => c.name === 'emailProvider')
  if (!provider) return { incoming: [], outgoing: [] }
  const at = email.lastIndexOf('@')
  const substitute = (value: string) =>
    value
      .replace(/%EMAILADDRESS%/g, email)
      .replace(/%EMAILLOCALPART%/g, email.slice(0, at))
      .replace(/%EMAILDOMAIN%/g, email.slice(at + 1).toLowerCase())
  const servers = (tag: string, type: string) =>
    provider.children
      .filter((c) => c.name === tag && c.attributes.type?.toLowerCase() === type)
      .flatMap((server): ServerSettings[] => {
        const text = (name: string) =>
          server.children.find((c) => c.name === name)?.text.trim() || ''
        const socket = text('socketType').toUpperCase()
        const security = socket === 'SSL' ? 'tls' : socket === 'STARTTLS' ? 'starttls' : undefined
        const auth = server.children
          .filter((c) => c.name === 'authentication')
          .map((c) => c.text.trim().toLowerCase())
        if (!security || (auth.length && !auth.some((a) => passwordAuth.has(a)))) return []
        const port = text('port')
        const settings = {
          host: substitute(text('hostname')).toLowerCase().replace(/\.$/, ''),
          port: /^\d{1,5}$/.test(port) ? Number(port) : 0,
          security,
          username: substitute(text('username')) || email,
        }
        const parsed = serverSettingsSchema.safeParse(settings)
        return parsed.success ? [parsed.data] : []
      })
  const name = ['displayName', 'displayShortName']
    .map((n) =>
      provider.children
        .find((c) => c.name === n)
        ?.text.replace(/\s+/g, ' ')
        .trim(),
    )
    .find(Boolean)
  return {
    ...(name ? { provider: name.slice(0, 100) } : {}),
    incoming: servers('incomingServer', 'imap'),
    outgoing: servers('outgoingServer', 'smtp'),
  }
}

interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  text: string
}
const xmlName = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/
const entities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
function invalid(): never {
  throw new Error('The configuration file is not valid.')
}
/**
 * A deliberately small XML reader for configuration files: no DTDs, no custom entities, no
 * processing instructions, bounded size, depth, and element count. Anything else is rejected.
 */
function parseXml(input: string): XmlElement {
  if (input.length > maxBytes) throw new Error('The configuration file is too large.')
  let xml = input.replace(/^\uFEFF/, '')
  const declaration = /^\s*<\?xml\s[^<>?]*\?>/.exec(xml)
  if (declaration) xml = xml.slice(declaration[0].length)
  const stack: XmlElement[] = []
  let root: XmlElement | undefined
  let count = 0
  let i = 0
  const addText = (value: string) => {
    const parent = stack[stack.length - 1]
    if (parent) parent.text += value
    else if (value.trim()) invalid()
  }
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) {
      addText(decode(xml.slice(i)))
      break
    }
    if (lt > i) addText(decode(xml.slice(i, lt)))
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      if (end === -1) invalid()
      i = end + 3
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      if (end === -1 || !stack.length) invalid()
      addText(xml.slice(lt + 9, end))
      i = end + 3
    } else if (xml[lt + 1] === '!' || xml[lt + 1] === '?') {
      // DOCTYPE, ENTITY, and processing instructions are where XML parsers get into trouble.
      invalid()
    } else {
      const end = xml.indexOf('>', lt)
      if (end === -1) invalid()
      i = end + 1
      if (xml[lt + 1] === '/') {
        if (stack.pop()?.name !== xml.slice(lt + 2, end).trim()) invalid()
        continue
      }
      let tag = xml.slice(lt + 1, end)
      const selfClosing = tag.endsWith('/')
      if (selfClosing) tag = tag.slice(0, -1)
      const name = /^\S*/.exec(tag)![0]
      if (!xmlName.test(name) || (root && !stack.length)) invalid()
      if (++count > 4096 || stack.length >= 32) invalid()
      const element: XmlElement = {
        name,
        attributes: parseAttributes(tag.slice(name.length)),
        children: [],
        text: '',
      }
      if (stack.length) stack[stack.length - 1].children.push(element)
      else root = element
      if (!selfClosing) stack.push(element)
    }
  }
  if (!root || stack.length) invalid()
  return root
}
function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null)
  const pattern = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y
  let index = 0
  while (source.slice(index).trim()) {
    pattern.lastIndex = index
    const match = pattern.exec(source)
    if (!match || match[1] in attributes) invalid()
    attributes[match[1]] = decode(match[2] ?? match[3])
    index = pattern.lastIndex
  }
  return attributes
}
/** Only the five predefined entities and numeric character references exist here. */
function decode(value: string): string {
  return value.replace(/&([^;&\s]{0,10});?/g, (reference, body: string) => {
    if (!reference.endsWith(';')) invalid()
    if (Object.hasOwn(entities, body)) return entities[body]
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|(\d{1,7}))$/.exec(body)
    const code = numeric ? parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10) : NaN
    if (!(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) invalid()
    return String.fromCodePoint(code)
  })
}
