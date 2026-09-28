import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { publicFetch } from './public-fetch'

type Resource = Awaited<ReturnType<typeof publicFetch>>
type FetchResource = (
  url: string,
  options?: { maxBytes?: number; timeoutMs?: number; allowPartial?: boolean; userAgent?: string },
) => Promise<Resource>

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG = Buffer.from('ffd8ff', 'hex')
const ICO = Buffer.from('00000100', 'hex')

export function rasterType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(PNG)) return 'image/png'
  if (bytes.subarray(0, 3).equals(JPEG)) return 'image/jpeg'
  if (/^(GIF87a|GIF89a)$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  if (
    bytes.toString('ascii', 4, 8) === 'ftyp' &&
    /^(avif|avis)$/.test(bytes.toString('ascii', 8, 12))
  )
    return 'image/avif'
  if (bytes.subarray(0, 4).equals(ICO)) return 'image/x-icon'
  return null
}

function imageData(resource: Resource): string | null {
  if (resource.status !== 200 || !resource.bytes.length) return null
  const type = rasterType(resource.bytes)
  if (!type) return null
  return `data:${type};base64,${resource.bytes.toString('base64')}`
}

export function parentBrandDomain(domain: string): string | null {
  const labels = domain.split('.')
  if (labels.length < 3) return null
  const parent = labels.slice(1)
  // Do not request a registry or public suffix such as co.uk.
  if (
    parent.length === 2 &&
    parent[1].length === 2 &&
    /^(?:ac|co|com|edu|gov|net|org)$/.test(parent[0])
  )
    return null
  return parent.join('.')
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4]
  return result
}

export function advertisedIcons(html: string, pageUrl: string): string[] {
  const logos: string[] = []
  const icons: string[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const { rel = '', href } = attributes(match[0])
    if (!href) continue
    const destination = /(?:^|\s)apple-touch-icon(?:-precomposed)?(?:\s|$)/i.test(rel)
      ? logos
      : /(?:^|\s)icon(?:\s|$)/i.test(rel)
        ? icons
        : null
    if (!destination) continue
    try {
      const url = new URL(href.replace(/&amp;/gi, '&'), pageUrl)
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        (!url.port || url.port === '443') &&
        !url.pathname.toLowerCase().endsWith('.svg')
      )
        destination.push(url.toString())
    } catch {
      // A malformed icon hint should not prevent the remaining fallbacks.
    }
  }
  return [...new Set([...logos, ...icons])].slice(0, 5)
}

export class SenderAvatarResolver {
  private cache = new Map<string, { image: string | null; expires: number }>()
  private pending = new Map<string, Promise<string | null>>()
  private brandCache = new Map<string, { image: string | null; expires: number }>()
  private brandPending = new Map<string, Promise<string | null>>()
  private providerCache = new Map<string, { image: string | null; expires: number }>()
  private providerPending = new Map<string, Promise<string | null>>()
  private active = 0
  private waiting: (() => void)[] = []

  constructor(private fetchResource: FetchResource = publicFetch) {}

  async get(email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase()
    const domain = normalized.split('@')[1]
    if (
      !domain ||
      !domain.includes('.') ||
      !/^[a-z0-9.-]+$/.test(domain) ||
      domain.startsWith('.') ||
      domain.endsWith('.') ||
      isIP(domain) ||
      /\.(?:example|invalid|localhost|local|test|onion)$/.test(domain)
    )
      return null
    const cached = this.cache.get(normalized)
    if (cached && cached.expires > Date.now()) return cached.image
    const pending = this.pending.get(normalized)
    if (pending) return pending
    const job = this.limit(() => this.lookup(normalized, domain))
      .catch(() => null)
      .then((image) => {
        this.cache.delete(normalized)
        this.cache.set(normalized, {
          image,
          expires: Date.now() + (image ? 7 * 24 * 60 : 15) * 60_000,
        })
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!)
        return image
      })
      .finally(() => this.pending.delete(normalized))
    this.pending.set(normalized, job)
    return job
  }

  clear() {
    this.cache.clear()
    this.pending.clear()
    this.brandCache.clear()
    this.brandPending.clear()
    this.providerCache.clear()
    this.providerPending.clear()
  }

  private async limit<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve))
    else this.active++
    try {
      return await run()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }

  private async tryImage(url: string): Promise<string | null> {
    try {
      const { resource } = await this.fetchAvatarResource(url, 512_000)
      return imageData(resource)
    } catch {
      return null
    }
  }

  private async fetchAvatarResource(
    value: string,
    maxBytes: number,
    allowPartial = false,
  ): Promise<{ resource: Resource; url: string }> {
    let url = new URL(value)
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443')
      )
        throw new Error('Unsupported sender image URL.')
      const resource = await this.fetchResource(url.toString(), {
        maxBytes,
        timeoutMs: 5000,
        allowPartial,
        userAgent: 'Mozilla/5.0',
      })
      if (![301, 302, 303, 307, 308].includes(resource.status) || !resource.location)
        return { resource, url: url.toString() }
      url = new URL(resource.location, url)
    }
    throw new Error('Too many sender image redirects.')
  }

  private async lookup(email: string, domain: string): Promise<string | null> {
    // Gravatar returns 404 when an address has no published portrait.
    const hash = createHash('sha256').update(email).digest('hex')
    const portrait = await this.tryImage(`https://gravatar.com/avatar/${hash}?s=96&d=404`)
    if (portrait) return portrait

    let brandDomain = domain
    for (let depth = 0; depth < 5; depth++) {
      const image = await this.brand(brandDomain)
      if (image) return image
      const parent = parentBrandDomain(brandDomain)
      if (!parent) break
      brandDomain = parent
    }
    return this.providerBrand(brandDomain)
  }

  private async providerBrand(domain: string): Promise<string | null> {
    const cached = this.providerCache.get(domain)
    if (cached && cached.expires > Date.now()) return cached.image
    const pending = this.providerPending.get(domain)
    if (pending) return pending
    const job = (async () =>
      (await this.tryImage(`https://twenty-icons.com/${domain}`)) ||
      this.tryImage(`https://icons.duckduckgo.com/ip3/${domain}.ico`))()
      .then((image) => {
        this.providerCache.delete(domain)
        this.providerCache.set(domain, {
          image,
          expires: Date.now() + (image ? 7 * 24 * 60 : 15) * 60_000,
        })
        if (this.providerCache.size > 100)
          this.providerCache.delete(this.providerCache.keys().next().value!)
        return image
      })
      .finally(() => this.providerPending.delete(domain))
    this.providerPending.set(domain, job)
    return job
  }

  private async brand(domain: string): Promise<string | null> {
    const cached = this.brandCache.get(domain)
    if (cached && cached.expires > Date.now()) return cached.image
    const pending = this.brandPending.get(domain)
    if (pending) return pending
    const job = this.lookupBrand(domain)
      .then((image) => {
        this.brandCache.delete(domain)
        this.brandCache.set(domain, {
          image,
          expires: Date.now() + (image ? 7 * 24 * 60 : 15) * 60_000,
        })
        if (this.brandCache.size > 100) this.brandCache.delete(this.brandCache.keys().next().value!)
        return image
      })
      .finally(() => this.brandPending.delete(domain))
    this.brandPending.set(domain, job)
    return job
  }

  private async lookupBrand(domain: string): Promise<string | null> {
    const origin = `https://${domain}`
    // Apple touch icons are normally large brand marks, suitable for an avatar.
    const touchIcon = await this.tryImage(`${origin}/apple-touch-icon.png`)
    if (touchIcon) return touchIcon

    try {
      const { resource: page, url: pageUrl } = await this.fetchAvatarResource(
        `${origin}/`,
        512_000,
        true,
      )
      if (page.status === 200 && page.type.toLowerCase() === 'text/html') {
        for (const url of advertisedIcons(page.bytes.toString('utf8'), pageUrl)) {
          const image = await this.tryImage(url)
          if (image) return image
        }
      }
    } catch {
      // Sites without a homepage can still have a conventional favicon.
    }
    return (
      (await this.tryImage(`${origin}/favicon.ico`)) ||
      (await this.tryImage(`${origin}/favicon.png`)) ||
      this.tryImage(`${origin}/favicon-32x32.png`)
    )
  }
}
