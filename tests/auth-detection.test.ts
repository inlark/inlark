import { describe, expect, it } from 'vitest'
import {
  detectAuth,
  extractAuthCandidates,
  selectAuthCandidate,
} from '../apps/desktop/src/main/auth-detection'

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

describe('opening text shown in the conversation list', () => {
  it('finds a code in the subject or a cut-off preview', () => {
    expect(
      detectAuth({
        subject: '813718 is your verification code',
        text: 'Enter this code to finish signing in. It expires in',
        partial: true,
      }),
    ).toEqual({ type: 'code', value: '813718' })
    expect(
      detectAuth({
        subject: 'Sign in to Example',
        text: 'Your verification code is 482913. It expires in 10 minutes. If you didn’t',
        partial: true,
      }),
    ).toEqual({ type: 'code', value: '482913' })
  })
  it.each([
    ['Your verification code is 4829', 'a code'],
    ['Your verification code is 4829…', 'a code before an ellipsis'],
    ['Your verification code is 4829...', 'a code before dots'],
    ['Verify your email: https://example.com/verify?token=ab', 'a link'],
  ])('never offers %s reaching the end of a cut-off excerpt (%s)', (text) => {
    expect(detectAuth({ subject: 'Your account', text, partial: true })).toBeUndefined()
  })
  it('keeps a value ending complete text, and in the subject of an empty excerpt', () => {
    expect(detectAuth({ text: 'Your verification code is 482913' })?.value).toBe('482913')
    expect(
      detectAuth({ subject: 'Your verification code: 482913', text: '', partial: true })?.value,
    ).toBe('482913')
  })
  it.each([
    ['Your verification code is 731904. Thanks for signing up.', '731904'],
    ['Your verification code is 731904 Thanks for signing up', '731904'],
    ['Your security code 4829', '4829'],
    ['Your verification code: 123 456 Thanks', '123456'],
  ])('does not join a code and a neighboring word: %s', (text, value) => {
    expect(detectAuth({ text })).toEqual({ type: 'code', value })
  })
  it('never reads encrypted text', () => {
    expect(
      detectAuth({
        subject: 'Your verification code: 482913',
        text: '-----BEGIN PGP MESSAGE-----\nabc',
      }),
    ).toBeUndefined()
  })
})

describe('link actions', () => {
  const action = (input: Parameters<typeof detectAuth>[0]) => {
    const found = detectAuth(input)
    expect(found?.type).toBe('link')
    return found?.action
  }
  it.each([
    ['Reset your password: https://example.com/e?token=9f8e7d', 'resetPassword'],
    ['Forgot your password? Choose a new one: https://example.com/e?token=9f8e7d', 'resetPassword'],
    ['Passwort zurücksetzen: https://example.com/e?token=9f8e7d', 'resetPassword'],
    ['Click the link below to sign in:\n\nhttps://example.com/e?token=9f8e7d', 'signIn'],
    ['Your magic link: https://example.com/e?token=9f8e7d', 'signIn'],
    ['Dein Anmeldelink: https://example.com/e?token=9f8e7d', 'signIn'],
    ['Verify your email address: https://example.com/e?token=9f8e7d', 'verifyEmail'],
    ['Bestätigen Sie Ihre E-Mail-Adresse: https://example.com/e?token=9f8e7d', 'verifyEmail'],
    ['Confirm your sign-in from a new device: https://example.com/e?token=9f8e7d', 'verify'],
    ['Activate your account: https://example.com/e?token=9f8e7d', 'verify'],
  ])('names %s', (text, expected) => {
    expect(action({ text })).toBe(expected)
  })
  it('prefers the button label to the surrounding text', () => {
    expect(
      action({
        html: '<p>Thanks for signing up. Please confirm your email.</p><a href="https://example.com/e?token=9f8e7d">Sign in to Example</a>',
      }),
    ).toBe('signIn')
  })
  it('reads the URL when the label says nothing', () => {
    expect(
      action({
        subject: 'Your account',
        html: '<p>Use this link to continue your login.</p><a href="https://example.com/password/reset?token=9f8e7d">Continue</a>',
      }),
    ).toBe('resetPassword')
  })
  it('falls back to the subject, and to no action at all', () => {
    expect(
      action({
        subject: 'Reset your password',
        text: 'Use this link to continue your login request: https://example.com/e?token=9f8e7d',
      }),
    ).toBe('signIn')
    expect(
      action({
        subject: 'Reset your password',
        text: 'Your requested link to proceed (security): https://example.com/e?token=9f8e7d',
      }),
    ).toBe('resetPassword')
    expect(
      detectAuth({ text: 'Your security link: https://example.com/e?token=9f8e7d' })?.action,
    ).toBeUndefined()
  })
})
