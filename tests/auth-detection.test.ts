import { describe, expect, it } from 'vitest'
import { extractAuthCandidates, selectAuthCandidate } from '../apps/desktop/src/main/auth-detection'

describe('authentication value extraction adapted from AuthFill', () => {
  it.each([
    ['Your verification code is: 012345', '012345'],
    ['Your verification code is 012345.', '012345'],
    ['Your password reset code: 008821', '008821'],
    ['Your verification code:\n123 456', '123456'],
    ['Your verification code: ABC-123', 'ABC123'],
    ['Your verification code: AB12-CD34', 'AB12CD34'],
    ['Your verification code: 0-1-2-3-4-5', '012345'],
    ['Your code is: AB12C9', 'AB12C9'],
    ['Your code is: ABCDEF', 'ABCDEF'],
    ['Your security code is 5291', '5291'],
    ['Ihr Bestätigungscode lautet: 012345', '012345'],
    ['Dein Anmeldecode ist: 001234', '001234'],
    ['Passwort zurücksetzen\nIhr Code: 089123', '089123'],
    ['Your verification code: 123\u00a0456', '123456'],
    ['Your verification code: 123\u202f456', '123456'],
  ])('extracts %s', (text, value) => {
    expect(selectAuthCandidate({ text })).toMatchObject({ type: 'code', value })
  })

  it('handles subject-only codes, including a value before its label', () => {
    expect(selectAuthCandidate({ subject: '012345 is your verification code' })).toMatchObject({
      value: '012345',
    })
  })
  it('parses HTML and entities without loading images or executing scripts', () => {
    expect(
      selectAuthCandidate({
        html: '<script>fetch("https://bad.example")</script><img src="https://bad.example/img"><p>Your verification code:</p><strong>012&#51;45</strong>',
      }),
    ).toMatchObject({ value: '012345' })
  })
  it('considers both MIME alternatives and deduplicates normalized values', () => {
    const input = { text: 'Your code is: 123 456', html: '<p>Your code is: 123456</p>' }
    expect(extractAuthCandidates(input).filter((c) => c.type === 'code')).toHaveLength(1)
    expect(selectAuthCandidate(input)?.value).toBe('123456')
    expect(
      selectAuthCandidate({ text: 'Your code is: 012345', html: '<p>View in browser</p>' })?.value,
    ).toBe('012345')
  })
  it.each([
    'Verify your email: https://example.com/verify?token=abc',
    'Reset your password: https://example.com/?token=abc',
    'Bestätigen Sie Ihre E-Mail: https://example.com/?token=abc',
    'Your magic link: https://example.com/signin/abc',
    'Sign in: https://example.com/login/abc',
  ])('recognizes authentication links: %s', (text) => {
    expect(selectAuthCandidate({ text })).toMatchObject({
      type: 'link',
      value: text.split(' ').at(-1),
    })
  })
  it('extracts an opaque HTML button URL with query entities intact', () => {
    expect(
      selectAuthCandidate({
        html: '<a href="https://example.com/?token=abc&amp;user=1">Reset your password</a>',
      }),
    ).toMatchObject({ type: 'link', value: 'https://example.com/?token=abc&user=1' })
  })
  it('ignores malformed URLs without aborting other extraction', () => {
    expect(
      selectAuthCandidate({ text: 'https://[broken\nYour verification code is: 012345' })?.value,
    ).toBe('012345')
  })
  it.each([
    'Your order number: 123456',
    'Your discount code is: SUMMER24',
    'Your promo code is: 123456',
    'Dein Gutschein Code ist: 123456',
    'Verify your order\nOrder: 123456',
    'Security update\nPhone: 123 456 7890',
    'Security update\nIP: 192.168.100.100',
    'Your verification code expires at 12:3456',
    'Your code expires on 2026-10-24',
    'Your code expires on 24.10.2026',
    'Security update\n2026',
    'Your verification code expires in 1234 seconds',
    'Read our security policy: https://example.com/privacy',
    'Verify your email at https://example.com/',
    'Your order: https://example.com/orders/123456',
    'Your order: https://example.com/?token=abcdef',
    'Read the OAuth documentation: https://example.com/oauth/docs',
    'Verify your email: https://user:pass@example.com/verify?token=abc',
    'Verify your email: https://example.com/unsubscribe?token=abc',
    'Verify your email: https://example.com/image.png?token=abc',
    'Verify your email\nAccount',
  ])('does not automatically select unrelated values: %s', (text) => {
    expect(selectAuthCandidate({ text })).toBeUndefined()
  })
  it('declines competing codes even when both have strong authentication context', () => {
    expect(
      selectAuthCandidate({
        text: 'Your verification code: 123456\nYour verification code: 654321',
      }),
    ).toBeUndefined()
  })
  it('does not add confidence when a code or context is repeated', () => {
    const input = { text: 'Your verification code: 123456' }
    expect(selectAuthCandidate({ text: Array(100).fill(input.text).join('\n') })?.score).toBe(
      selectAuthCandidate(input)?.score,
    )
  })
  it('ignores quoted codes and forwarded messages', () => {
    expect(
      selectAuthCandidate({
        html: '<p>Thanks</p><blockquote>Your verification code: 012345</blockquote>',
      }),
    ).toBeUndefined()
    expect(
      selectAuthCandidate({ text: 'Thanks\n> Your verification code: 012345' }),
    ).toBeUndefined()
    expect(
      selectAuthCandidate({
        text: 'Thanks\nOn Tuesday someone wrote:\nYour verification code: 012345',
      }),
    ).toBeUndefined()
  })
})
