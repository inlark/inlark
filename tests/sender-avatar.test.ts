import { describe, expect, it, vi } from 'vitest'
import {
  advertisedIcons,
  parentBrandDomain,
  SenderAvatarResolver,
} from '../apps/desktop/src/main/sender-avatar'

const pixels = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64',
)
const image = (label: string, type = 'image/png') => ({
  status: 200,
  type,
  bytes: pixels,
  label,
})
const missing = { status: 404, type: 'text/plain', bytes: Buffer.alloc(0) }

describe('sender avatars', () => {
  it('uses a personal picture before a brand mark', async () => {
    const fetch = vi.fn(async () => image('portrait'))
    const resolver = new SenderAvatarResolver(fetch)
    expect(await resolver.get(' Maya@Studio.com ')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toMatch(
      /^https:\/\/gravatar\.com\/avatar\/[a-f0-9]{64}\?s=96&d=404$/,
    )
  })

  it('uses an advertised brand icon and shares it across senders on the same domain', async () => {
    const requested: string[] = []
    const fetch = vi.fn(async (url: string) => {
      requested.push(url)
      if (url === 'https://brand.com/')
        return {
          status: 200,
          type: 'text/html',
          bytes: Buffer.from(
            '<link rel="icon" href="/small.ico"><link href="/brand.png" rel="apple-touch-icon">',
          ),
        }
      if (url === 'https://brand.com/brand.png') return image('brand')
      return missing
    })
    const resolver = new SenderAvatarResolver(fetch)
    const result = await Promise.all([resolver.get('one@brand.com'), resolver.get('two@brand.com')])
    expect(result).toEqual([
      `data:image/png;base64,${pixels.toString('base64')}`,
      `data:image/png;base64,${pixels.toString('base64')}`,
    ])
    expect(requested.filter((url) => url === 'https://brand.com/')).toHaveLength(1)
    expect(requested).not.toContain('https://brand.com/small.ico')
  })

  it('falls back to the conventional favicon and then initials when no image exists', async () => {
    const resolver = new SenderAvatarResolver(async (url) =>
      url === 'https://brand.com/favicon.ico' ? image('icon', 'image/x-icon') : missing,
    )
    expect(await resolver.get('hello@brand.com')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    const absent = new SenderAvatarResolver(async () => missing)
    expect(await absent.get('hello@brand.com')).toBeNull()
    expect(await absent.get('hello@brand.com')).toBeNull()
    expect(await absent.get('hello@localhost')).toBeNull()
  })

  it('accepts HTTPS icons from a site CDN and ignores insecure icons', () => {
    expect(
      advertisedIcons(
        '<link rel="icon" href="https://cdn.brand.com/icon.png"><link rel="icon" href="http://brand.com/insecure.png"><link rel="apple-touch-icon" href="/logo.png">',
        'https://brand.com',
      ),
    ).toEqual(['https://brand.com/logo.png', 'https://cdn.brand.com/icon.png'])
  })

  it('follows bounded HTTPS redirects for homepages and icon assets', async () => {
    const requested: string[] = []
    const fetch = vi.fn(async (url: string) => {
      requested.push(url)
      if (url === 'https://brand.com/')
        return { ...missing, status: 301, location: 'https://www.brand.com/' }
      if (url === 'https://www.brand.com/')
        return {
          status: 200,
          type: 'text/html',
          bytes: Buffer.from('<link rel="icon" href="/icon.png">'),
        }
      if (url === 'https://www.brand.com/icon.png')
        return { ...missing, status: 302, location: 'https://cdn.brand.com/icon.png' }
      if (url === 'https://cdn.brand.com/icon.png') return image('icon', 'application/octet-stream')
      return missing
    })
    const resolver = new SenderAvatarResolver(fetch)
    expect(await resolver.get('mail@brand.com')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    expect(requested).toContain('https://cdn.brand.com/icon.png')
  })

  it('tries the parent domain for mail subdomains without requesting public suffixes', async () => {
    const requested: string[] = []
    const resolver = new SenderAvatarResolver(async (url) => {
      requested.push(url)
      return url === 'https://openai.com/favicon.ico' ? image('icon') : missing
    })
    expect(await resolver.get('hello@mail.openai.com')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    expect(requested).toContain('https://openai.com/favicon.ico')
    expect(parentBrandDomain('mail.google.co.uk')).toBe('google.co.uk')
    expect(parentBrandDomain('mail.co.uk')).toBeNull()
  })

  it('reaches the root domain through deeper mail subdomains', async () => {
    const requested: string[] = []
    const resolver = new SenderAvatarResolver(async (url) => {
      requested.push(url)
      return url === 'https://openai.com/favicon.ico' ? image('icon') : missing
    })
    expect(await resolver.get('hello@news.tm.openai.com')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    expect(requested).toContain('https://tm.openai.com/favicon.ico')
    expect(requested).toContain('https://openai.com/favicon.ico')
    expect(requested).not.toContain('https://icons.duckduckgo.com/ip3/openai.com.ico')
  })

  it('uses a cached favicon lookup when the root site refuses direct requests', async () => {
    const requested: string[] = []
    const resolver = new SenderAvatarResolver(async (url) => {
      requested.push(url)
      return url === 'https://icons.duckduckgo.com/ip3/openai.com.ico' ? image('icon') : missing
    })
    expect(await resolver.get('hello@tm.openai.com')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    expect(requested).toContain('https://openai.com/favicon.ico')
    expect(requested).toContain('https://twenty-icons.com/openai.com')
    expect(requested.at(-1)).toBe('https://icons.duckduckgo.com/ip3/openai.com.ico')
  })

  it('uses Twenty Icons before DuckDuckGo and shares the result across senders', async () => {
    const requested: string[] = []
    const fetch = vi.fn(async (url: string) => {
      requested.push(url)
      return url === 'https://twenty-icons.com/company.com' ? image('icon') : missing
    })
    const resolver = new SenderAvatarResolver(fetch)
    const results = await Promise.all([
      resolver.get('first@mail.company.com'),
      resolver.get('second@mail.company.com'),
    ])

    expect(results).toEqual([
      `data:image/png;base64,${pixels.toString('base64')}`,
      `data:image/png;base64,${pixels.toString('base64')}`,
    ])
    expect(requested.filter((url) => url === 'https://twenty-icons.com/company.com')).toHaveLength(
      1,
    )
    expect(requested).not.toContain('https://twenty-icons.com/mail.company.com')
    expect(requested).not.toContain('https://icons.duckduckgo.com/ip3/company.com.ico')
  })

  it('rejects redirects that downgrade to HTTP', async () => {
    const requested: string[] = []
    const resolver = new SenderAvatarResolver(async (url) => {
      requested.push(url)
      if (url === 'https://brand.com/apple-touch-icon.png')
        return { ...missing, status: 301, location: 'http://brand.com/icon.png' }
      return missing
    })
    await resolver.get('hello@brand.com')
    expect(requested).not.toContain('http://brand.com/icon.png')
  })

  it('finds a Snocks-style icon in the prefix of a large homepage', async () => {
    const page = Buffer.from(
      `<head><link rel="icon" href="/cdn/shop/files/brand.png?width=128"></head>${'x'.repeat(600_000)}`,
    )
    const fetch = vi.fn(
      async (url: string, options?: { maxBytes?: number; allowPartial?: boolean }) => {
        if (url === 'https://snocks.com/') {
          if (!options?.allowPartial) throw new Error('Resource is too large.')
          return { status: 200, type: 'text/html', bytes: page.subarray(0, options.maxBytes) }
        }
        if (url === 'https://snocks.com/cdn/shop/files/brand.png?width=128') return image('brand')
        return missing
      },
    )
    const resolver = new SenderAvatarResolver(fetch)
    expect(await resolver.get('hello@snocks.com')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
    expect(fetch).toHaveBeenCalledWith('https://snocks.com/', {
      maxBytes: 512_000,
      timeoutMs: 5000,
      allowPartial: true,
      userAgent: 'Mozilla/5.0',
    })
  })

  it('follows DPD-style four redirects to an advertised favicon', async () => {
    const redirects = new Map([
      ['https://dpd.at/', 'https://www.dpd.com/at'],
      ['https://www.dpd.com/at', 'https://www.dpd.com/at/'],
      ['https://www.dpd.com/at/', 'https://www.dpd.com/at/de'],
      ['https://www.dpd.com/at/de', 'https://www.dpd.com/at/de/'],
    ])
    const fetch = vi.fn(async (url: string) => {
      const location = redirects.get(url)
      if (location) return { ...missing, status: 301, location }
      if (url === 'https://www.dpd.com/at/de/')
        return {
          status: 200,
          type: 'text/html',
          bytes: Buffer.from('<link rel="icon" href="/wp-content/favicon.png">'),
        }
      if (url === 'https://www.dpd.com/wp-content/favicon.png') return image('dpd')
      return missing
    })
    expect(await new SenderAvatarResolver(fetch).get('hello@dpd.at')).toBe(
      `data:image/png;base64,${pixels.toString('base64')}`,
    )
  })

  it('accepts a Trade Republic-style favicon larger than 128 KB', async () => {
    const favicon = Buffer.concat([Buffer.from('00000100', 'hex'), Buffer.alloc(285_474)])
    const fetch = vi.fn(async (url: string, options?: { maxBytes?: number }) => {
      if (url === 'https://traderepublic.com/favicon.ico') {
        if ((options?.maxBytes ?? 0) < favicon.length) throw new Error('Resource is too large.')
        return { status: 200, type: 'image/vnd.microsoft.icon', bytes: favicon }
      }
      return missing
    })
    const result = await new SenderAvatarResolver(fetch).get('hello@traderepublic.com')
    expect(result).toBe(`data:image/x-icon;base64,${favicon.toString('base64')}`)
  })
})
