import { describe, expect, it } from 'vitest'
import { handle, supportPage } from '../apps/marketing/worker/routes'

describe('support redirect', () => {
  it('sends inlark.com/support to the support page, without a permanent redirect', async () => {
    for (const path of ['/support', '/support/']) {
      const response = await handle(new Request('https://inlark.com' + path))
      expect(response?.status).toBe(302)
      expect(response?.headers.get('Location')).toBe(supportPage)
    }
    expect(supportPage).toMatch(/^https:\/\//)
  })

  it('leaves other paths and methods to the static site', async () => {
    expect(await handle(new Request('https://inlark.com/supported'))).toBeNull()
    expect(await handle(new Request('https://inlark.com/support', { method: 'POST' }))).toBeNull()
  })
})
