import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { microsoftAdminPage, microsoftClientId } from '@inlark/core'
import { adminPage, approveUrl, clientId, permissions } from '../apps/marketing/src/data/microsoft'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('the page an administrator approves inlark from', () => {
  it('names the same registration as the app', () => {
    expect(clientId).toBe(microsoftClientId)
    expect(adminPage).toBe(microsoftAdminPage)
  })

  it('asks Microsoft for exactly what the app asks for when someone signs in', () => {
    const auth = read('../apps/desktop/src/main/microsoft-auth.ts')
    const requested = [
      ...auth.matchAll(/'(https:\/\/[a-z.]+\/[A-Za-z.]+|openid|email|offline_access)'/g),
    ]
      .map((m) => m[1])
      .filter((scope) => !scope.includes('login.microsoftonline.com'))
    const shown = permissions.flatMap((p) => p.scope.split(' '))
    expect([...new Set(shown)].sort()).toEqual([...new Set(requested)].sort())
    expect(shown).toHaveLength(6)
  })

  it('sends the administrator to Microsoft and back to this page, and nowhere else', () => {
    const url = new URL(approveUrl)
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/organizations/v2.0/adminconsent',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: microsoftClientId,
      redirect_uri: 'https://inlark.com/microsoft/',
      scope: permissions.map((p) => p.scope).join(' '),
    })
  })
})
