import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoAccounts, demoAPI } from '../apps/desktop/src/renderer/src/demo'

afterEach(() => vi.unstubAllGlobals())

describe('demo sender pictures', () => {
  it('uses the initials fallback for Medium instead of an invisible icon', async () => {
    expect(await demoAPI.senderAvatar('digest@medium.com')).toBeNull()
  })

  it('uses real sender domains throughout the sample catalog', async () => {
    for (let index = 0; index < 21; index++) {
      const [message] = await demoAPI.conversation(demoAccounts[0].id, `thread-${index}`)
      const domain = message.from[0].email.split('@')[1]
      expect(domain).toMatch(/\.[a-z]{2,}$/)
      expect(domain.endsWith('.example')).toBe(false)
    }
  })

  it('loads pictures from the local resolver in the browser demo', async () => {
    const image = 'data:image/png;base64,aWNvbg=='
    const fetch = vi.fn(async () => new Response(JSON.stringify({ image })))
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', fetch)

    expect(await demoAPI.senderAvatar('updates@tm.openai.com')).toBe(image)
    expect(fetch).toHaveBeenCalledWith('/__demo/avatar?email=updates%40tm.openai.com', {
      credentials: 'omit',
    })
  })

  it('uses the desktop resolver in the native demo', async () => {
    const senderAvatar = vi.fn(async () => 'data:image/png;base64,aWNvbg==')
    vi.stubGlobal('window', { mail: { senderAvatar } })

    expect(await demoAPI.senderAvatar('notifications@github.com')).toBe(
      'data:image/png;base64,aWNvbg==',
    )
    expect(senderAvatar).toHaveBeenCalledWith('notifications@github.com')
  })
})
