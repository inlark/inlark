import { describe, it, expect } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { accountSchema, hostSchema, ipcSchemas } from '../packages/core/src'

const imap = {
  password: 'disposable',
  name: '',
  remember: false,
  config: {
    protocol: 'imap',
    email: 'me@example.com',
    incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: 'me' },
    outgoing: { host: 'smtp.example.com', port: 465, security: 'tls', username: 'me' },
    outgoingSameCredentials: true,
  },
} as const

describe('connection configuration validation', () => {
  it('accepts server names and addresses, never URLs or embedded ports', () => {
    for (const host of ['imap.example.com', 'mail.inlark.test', '127.0.0.1', '::1', 'localhost'])
      expect(hostSchema.safeParse(host).success, host).toBe(true)
    for (const host of ['https://example.com', 'example.com:993', 'a b', '-a.com', 'x.com/p', ''])
      expect(hostSchema.safeParse(host).success, host).toBe(false)
  })
  it('offers only TLS and required STARTTLS, with no plaintext option', () => {
    expect(accountSchema.safeParse(imap).success).toBe(true)
    for (const security of ['none', 'plain', 'opportunistic'])
      expect(
        accountSchema.safeParse({
          ...imap,
          config: { ...imap.config, incoming: { ...imap.config.incoming, security } },
        }).success,
      ).toBe(false)
  })
  it('accepts a trusted certificate only as a fingerprint and a single PEM certificate', () => {
    const pem = readFileSync(new URL('./fixtures/tls/untrusted.crt', import.meta.url), 'utf8')
    const sha256 = new X509Certificate(pem).fingerprint256
    const trusting = (certificate: unknown) =>
      accountSchema.safeParse({
        ...imap,
        config: { ...imap.config, incoming: { ...imap.config.incoming, certificate } },
      }).success
    expect(trusting({ sha256, pem })).toBe(true)
    expect(trusting({ sha256: sha256.toLowerCase(), pem })).toBe(false)
    expect(trusting({ sha256: sha256.slice(3), pem })).toBe(false)
    expect(trusting({ sha256, pem: pem.replace('CERTIFICATE', 'PRIVATE KEY') })).toBe(false)
    expect(trusting({ sha256, pem: pem + pem })).toBe(false)
  })
  it('requires a separate outgoing password only when credentials differ', () => {
    const separate = { ...imap, config: { ...imap.config, outgoingSameCredentials: false } }
    expect(accountSchema.safeParse(separate).success).toBe(false)
    expect(accountSchema.safeParse({ ...separate, outgoingPassword: 'other' }).success).toBe(true)
  })
  it('keeps legacy JMAP input shape out of the connect contract', () => {
    const legacy = {
      serverUrl: 'https://mail.example',
      username: 'me',
      password: 'x',
      name: '',
      remember: false,
    }
    expect(ipcSchemas.connect.safeParse([legacy]).success).toBe(false)
    expect(
      ipcSchemas.connect.safeParse([
        {
          ...legacy,
          config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'me' },
        },
      ]).success,
    ).toBe(true)
  })
  it('validates discovery input as an address only', () => {
    expect(ipcSchemas.discover.safeParse([' Me@Example.com ']).data).toEqual(['me@example.com'])
    expect(ipcSchemas.discover.safeParse(['https://example.com']).success).toBe(false)
  })
})
