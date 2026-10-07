import { describe, expect, it } from 'vitest'
import type { Account } from '../packages/core/src'
import { newMessageAccount } from '../apps/desktop/src/renderer/src/compose-account'

describe('new message sending account', () => {
  const accounts: Account[] = ['personal', 'work'].map((id) => ({
    id,
    connectionId: id,
    remoteId: id,
    name: id,
    email: id + '@example.com',
    color: '#aaa',
    status: 'connected',
  }))

  it('prefers the selected account over the default sending account', () => {
    expect(newMessageAccount(accounts, 'work', 'personal')).toBe(accounts[1])
  })

  it('uses the default sending account in the unified inbox', () => {
    expect(newMessageAccount(accounts, undefined, 'work')).toBe(accounts[1])
  })

  it('uses the default when the remembered location names a removed account', () => {
    expect(newMessageAccount(accounts, 'removed', 'work')).toBe(accounts[1])
  })

  it('uses the first account when the default sending account was removed', () => {
    expect(newMessageAccount(accounts, undefined, 'removed')).toBe(accounts[0])
  })

  it('uses the first account when both remembered accounts were removed', () => {
    expect(newMessageAccount(accounts, 'removed', 'also-removed')).toBe(accounts[0])
  })

  it('keeps an existing selected account even when it needs reconnecting', () => {
    const offline: Account = { ...accounts[1], status: 'offline' }
    expect(newMessageAccount([accounts[0], offline], 'work', 'personal')).toBe(offline)
  })

  it('returns no account when setup is needed, even with stale preferences', () => {
    expect(newMessageAccount([], 'removed', 'also-removed')).toBeUndefined()
  })
})
