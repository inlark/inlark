import { describe, expect, it, vi } from 'vitest'
import { remoteImageData } from '../apps/desktop/src/main/remote-image'
import { publicFetch } from '../apps/desktop/src/main/public-fetch'

type FetchResource = typeof publicFetch
const png = Buffer.from('89504e470d0a1a0a', 'hex')

describe('remote message images', () => {
  it('follows public image redirects and identifies raster bytes despite a generic MIME type', async () => {
    const fetch = vi
      .fn<FetchResource>()
      .mockResolvedValueOnce({
        status: 302,
        type: 'text/html',
        bytes: Buffer.alloc(0),
        location: '/images/logo',
      })
      .mockResolvedValueOnce({ status: 200, type: 'application/octet-stream', bytes: png })
    expect(await remoteImageData('https://images.example/redirect', fetch)).toBe(
      `data:image/png;base64,${png.toString('base64')}`,
    )
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://images.example/redirect',
      'https://images.example/images/logo',
    ])
  })

  it('returns no image for unavailable content or unsafe redirect URLs', async () => {
    const failed = vi.fn<FetchResource>().mockRejectedValue(new Error('Network failure'))
    expect(await remoteImageData('https://images.example/missing', failed)).toBeNull()
    const html = vi
      .fn<FetchResource>()
      .mockResolvedValue({ status: 200, type: 'text/html', bytes: Buffer.from('<html>') })
    expect(await remoteImageData('https://images.example/not-image', html)).toBeNull()
    const redirect = vi.fn<FetchResource>().mockResolvedValue({
      status: 302,
      type: 'text/html',
      bytes: Buffer.alloc(0),
      location: 'file:///etc/passwd',
    })
    expect(await remoteImageData('https://images.example/redirect', redirect)).toBeNull()
    expect(redirect).toHaveBeenCalledTimes(1)
  })
})
