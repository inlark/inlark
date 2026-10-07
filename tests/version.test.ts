import { afterEach, describe, expect, it, vi } from 'vitest'
import { version } from '../apps/desktop/package.json'
import { demoAPI } from '../apps/desktop/src/renderer/src/demo'
import { unconfirmedRelease } from '../apps/marketing/src/data/release'

afterEach(() => vi.unstubAllGlobals())

describe('application version', () => {
  it('uses the desktop manifest in the browser demo and website fallback', async () => {
    vi.stubGlobal('window', {})
    expect((await demoAPI.bootstrap()).version).toBe(version)
    expect(unconfirmedRelease.version).toBe(version)
  })

  it('uses the running application version in the native demo', async () => {
    const bootstrap = vi.fn(async () => ({ version: '1.2.3-beta.1' }))
    vi.stubGlobal('window', { mail: { bootstrap } })

    const result = await demoAPI.bootstrap()
    expect(result.version).toBe('1.2.3-beta.1')
    expect(result.demo).toBe(true)
    expect(result.accounts.length).toBeGreaterThan(0)
    expect(bootstrap).toHaveBeenCalledOnce()
  })
})
