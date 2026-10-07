import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

describe('release version validation', () => {
  const script = fileURLToPath(new URL('../scripts/validate-release-version.mjs', import.meta.url))

  it('accepts a tag matching the committed desktop manifest', () => {
    const result = spawnSync(process.execPath, [script, `v${version}`], { encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
  })

  it.each(['v99.0.0', version, undefined])('rejects a mismatched or missing tag: %s', (tag) => {
    const result = spawnSync(process.execPath, [script, ...(tag ? [tag] : [])], {
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Commit the desktop package version before tagging a release.')
  })
})
