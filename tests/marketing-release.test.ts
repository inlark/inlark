import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  builds,
  buildById,
  downloadFor,
  fetchCurrentRelease,
  fetchLatestRelease,
} from '../apps/marketing/src/data/release'

const githubRelease = (version: string) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/inlark/inlark/releases/tag/v${version}`,
  published_at: '2026-10-07T12:00:00Z',
  assets: [
    {
      name: `Inlark-${version}-amd64.deb`,
      size: 12345,
      browser_download_url: `https://github.com/inlark/inlark/releases/download/v${version}/Inlark-${version}-amd64.deb`,
      digest: 'sha256:abc123',
    },
  ],
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('website release version', () => {
  it('uses the published tag and its assets rather than the source version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(githubRelease('1.2.3'))),
    )
    const release = await fetchLatestRelease()

    expect(release?.version).toBe('1.2.3')
    const download = downloadFor(release!, buildById('deb'))
    expect(download.confirmed).toBe(true)
    expect(download.file).toBe('Inlark-1.2.3-amd64.deb')
    expect(download.url).toContain('/v1.2.3/Inlark-1.2.3-amd64.deb')
    expect(download.digest).toBe('abc123')
  })

  it('refreshes the homepage and download page through the same cached endpoint', async () => {
    const release = {
      version: '1.3.0',
      url: 'https://github.com/inlark/inlark/releases/tag/v1.3.0',
      publishedAt: '2026-10-07T12:00:00Z',
      assets: [],
    }
    const fetch = vi.fn(async () => Response.json(release))
    vi.stubGlobal('fetch', fetch)

    expect(await fetchCurrentRelease()).toEqual(release)
    expect(fetch).toHaveBeenCalledWith('/api/release', { signal: expect.any(AbortSignal) })
  })

  it.each([404, 502])(
    'keeps the initial version when the release endpoint returns %s',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status })),
      )
      expect(await fetchCurrentRelease()).toBeNull()
    },
  )

  it('keeps the initial version when the release request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')))
    expect(await fetchCurrentRelease()).toBeNull()
  })

  it('keeps the initial version when the release response cannot be decoded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Unavailable</html>')),
    )
    expect(await fetchCurrentRelease()).toBeNull()
  })
})

describe('download filename compatibility', () => {
  const version = '1.3.0'
  const releaseUrl = `https://github.com/inlark/inlark/releases/tag/v${version}`
  const asset = (name: string) => ({
    name,
    size: 12345,
    url: `https://github.com/inlark/inlark/releases/download/v${version}/${name}`,
    digest: 'abc123',
  })
  const release = (assets: ReturnType<typeof asset>[]) => ({
    version,
    url: releaseUrl,
    publishedAt: null,
    assets,
  })

  it.each(builds.filter((build) => build.file))(
    'downloads both lowercase and legacy filenames for $id with matching install instructions',
    (build) => {
      const lowercase = build.file!(version)
      expect(lowercase.startsWith('inlark-')).toBe(true)
      for (const file of [lowercase, lowercase.replace(/^inlark-/, 'Inlark-')]) {
        const published = asset(file)
        expect(downloadFor(release([published]), build)).toMatchObject({
          confirmed: true,
          file,
          url: published.url,
          size: published.size,
          digest: published.digest,
        })
      }
      const legacy = asset(lowercase.replace(/^inlark-/, 'Inlark-'))
      const current = asset(lowercase)
      expect(downloadFor(release([legacy, current]), build).file).toBe(current.name)
    },
  )

  it('uses the release page when the requested architecture or format is missing', () => {
    const published = asset('inlark-1.3.0-x64.dmg')
    expect(downloadFor(release([published]), buildById('mac-arm64'))).toMatchObject({
      confirmed: false,
      file: 'inlark-1.3.0-arm64.dmg',
      url: releaseUrl,
      size: null,
      digest: null,
    })
    expect(downloadFor(release([published]), buildById('nix'))).toMatchObject({
      confirmed: false,
      file: null,
      url: releaseUrl,
    })
  })
})

describe('cached release endpoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
  })

  it('picks up a new release after the cache expires without a website deploy', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(githubRelease('1.2.3')))
      .mockResolvedValueOnce(Response.json(githubRelease('1.3.0')))
    vi.stubGlobal('fetch', fetch)
    const { handle } = await import('../apps/marketing/worker/routes')
    const request = new Request('https://inlark.com/api/release')
    const current = await handle(request)
    expect(await current!.json()).toMatchObject({ version: '1.2.3' })

    const cached = await handle(request)
    expect(await cached!.json()).toMatchObject({ version: '1.2.3' })
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-10-07T12:06:00Z'))
    const updated = await handle(request)
    expect(await updated!.json()).toMatchObject({ version: '1.3.0' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retains the last confirmed version during a GitHub outage', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(githubRelease('1.2.3')))
      .mockRejectedValueOnce(new TypeError('Network failure'))
    vi.stubGlobal('fetch', fetch)
    const { handle } = await import('../apps/marketing/worker/routes')
    const request = new Request('https://inlark.com/api/release')
    await handle(request)

    vi.setSystemTime(new Date('2026-10-07T12:06:00Z'))
    const stale = await handle(request)
    expect(stale?.status).toBe(200)
    expect(await stale!.json()).toMatchObject({ version: '1.2.3' })
  })
})
