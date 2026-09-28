import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
}))
vi.mock('node:https', () => ({ request }))

import { publicFetch } from '../apps/desktop/src/main/public-fetch'

describe('public resource requests', () => {
  it('accepts response headers without downloading a large unsubscribe confirmation page', async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      destroy: vi.fn(),
    })
    const outgoing = Object.assign(new EventEmitter(), { end: vi.fn() })
    request.mockImplementation((_url, _options, onResponse) => {
      queueMicrotask(() => {
        onResponse(response)
        response.emit('data', Buffer.alloc(200_000))
        response.emit('end')
      })
      return outgoing
    })

    const result = await publicFetch('https://list.example/unsubscribe', {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
      headersOnly: true,
    })

    expect(result).toMatchObject({ status: 200, type: 'text/html', bytes: Buffer.alloc(0) })
    expect(outgoing.end).toHaveBeenCalledWith('List-Unsubscribe=One-Click')
    expect(response.destroy).toHaveBeenCalledOnce()
  })

  it('returns a bounded prefix when fetching icon metadata from a large page', async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      destroy: vi.fn(),
    })
    const outgoing = Object.assign(new EventEmitter(), { end: vi.fn() })
    request.mockImplementation((_url, _options, onResponse) => {
      queueMicrotask(() => {
        onResponse(response)
        response.emit('data', Buffer.from('icon'))
        response.emit('data', Buffer.from(' and the rest of a large page'))
      })
      return outgoing
    })

    const result = await publicFetch('https://large.example/', {
      maxBytes: 8,
      allowPartial: true,
      userAgent: 'Mozilla/5.0',
    })

    expect(result.bytes.toString()).toBe('icon and')
    expect(response.destroy).toHaveBeenCalledOnce()
    expect(request.mock.calls.at(-1)?.[1].headers).toMatchObject({ 'User-Agent': 'Mozilla/5.0' })
  })
})
