import { describe, expect, it } from 'vitest'
import {
  compactAppPassword,
  passwordFor,
  googleAccountLinks,
  googleLoginError,
  isGmailAddress,
  isGoogleMailHost,
  isGoogleMx,
} from '@inlark/core'
import { connectionError } from '../packages/imap/src/imapflow-port'

describe('Google account recognition', () => {
  it('knows Google’s IMAP and SMTP servers and nothing that merely resembles them', () => {
    for (const host of ['imap.gmail.com', 'SMTP.Gmail.com.', ' imap.googlemail.com '])
      expect(isGoogleMailHost(host)).toBe(true)
    for (const host of ['gmail.com', 'imap.gmail.com.evil.example', 'mail.example.com', ''])
      expect(isGoogleMailHost(host)).toBe(false)
  })

  it('tells consumer Gmail addresses from Workspace ones', () => {
    expect(isGmailAddress('Someone@Gmail.com')).toBe(true)
    expect(isGmailAddress('someone@googlemail.com')).toBe(true)
    expect(isGmailAddress('someone@company.com')).toBe(false)
    expect(isGmailAddress('someone@gmail.com.example')).toBe(false)
  })

  it('recognizes Google’s mail exchangers', () => {
    for (const host of [
      'aspmx.l.google.com',
      'alt4.aspmx.l.google.com.',
      'smtp.google.com',
      'gmail-smtp-in.l.google.com',
      'aspmx3.googlemail.com',
    ])
      expect(isGoogleMx(host)).toBe(true)
    for (const host of ['notgoogle.com', 'google.com.example', 'mx.example.net'])
      expect(isGoogleMx(host)).toBe(false)
  })
})

describe('Google account pages', () => {
  it('opens them for the account being set up', () => {
    expect(googleAccountLinks('someone+tag@company.com')).toEqual({
      twoStepVerification:
        'https://myaccount.google.com/signinoptions/two-step-verification?authuser=someone%2Btag%40company.com',
      appPasswords:
        'https://myaccount.google.com/apppasswords?authuser=someone%2Btag%40company.com',
    })
    expect(googleAccountLinks('someone').appPasswords).toBe(
      'https://myaccount.google.com/apppasswords',
    )
  })
})

describe('app passwords', () => {
  it('joins up the groups Google shows, however they were pasted', () => {
    expect(compactAppPassword('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop')
    expect(compactAppPassword(' abcd efgh ijkl mnop\n')).toBe('abcdefghijklmnop')
    expect(compactAppPassword('abcdefghijklmnop')).toBe('abcdefghijklmnop')
  })

  it('leaves anything else exactly as typed', () => {
    for (const value of [
      'correct horse battery staple',
      'abcd efgh ijkl',
      ' p4ss word ',
      'abcd efgh ijkl mn0p',
    ])
      expect(compactAppPassword(value)).toBe(value)
  })
})

describe('passwords for each server', () => {
  const pasted = 'abcd efgh ijkl mnop'

  it('joins up an app password only for Google’s servers', () => {
    expect(passwordFor('imap.gmail.com', pasted)).toBe('abcdefghijklmnop')
    expect(passwordFor('smtp.gmail.com', pasted)).toBe('abcdefghijklmnop')
  })

  it('sends a separate login for another provider exactly as typed', () => {
    // Gmail incoming with another provider's outgoing server, and the reverse.
    expect(passwordFor('smtp.example.com', pasted)).toBe(pasted)
    expect(passwordFor('imap.example.com', pasted)).toBe(pasted)
  })
})

describe('Google login errors', () => {
  it('says when Google wants an app password instead of the regular one', () => {
    const imap =
      'A1 NO [ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)'
    const smtp =
      '534-5.7.9 Application-specific password required. For more information, go to https://support.google.com/mail/?p=InvalidSecondFactor'
    for (const response of [imap, smtp])
      expect(googleLoginError(response)).toBe(
        'Google needs an app password for this account, not the regular Google password.',
      )
  })

  it('says when Google stopped a sign-in as unusual', () => {
    expect(googleLoginError('A1 NO [ALERT] Please log in via your web browser (Failure)')).toMatch(
      /^Google stopped this sign-in as unusual/,
    )
    expect(
      googleLoginError('534-5.7.14 Please log in with your web browser and then try again.', true),
    ).toMatch(/^Google stopped this sign-in as unusual/)
  })

  it('explains any other refusal in terms of app passwords', () => {
    expect(googleLoginError('A1 NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)')).toBe(
      'Google didn’t accept this password. Gmail needs an app password, and changing the Google password cancels existing ones.',
    )
    expect(googleLoginError(undefined, true)).toBe(
      'Google didn’t accept this password for sending mail. Gmail needs an app password, and changing the Google password cancels existing ones.',
    )
  })

  it('applies to Google’s IMAP server only', () => {
    const refusal = {
      authenticationFailed: true,
      response: 'A1 NO [ALERT] Application-specific password required (Failure)',
    }
    const gmail = connectionError(refusal, { host: 'imap.gmail.com' })
    expect(gmail.code).toBe('authentication')
    expect(gmail.message).toMatch(/^Google needs an app password/)
    const other = connectionError(refusal, { host: 'mail.example.com' })
    expect(other.code).toBe('authentication')
    expect(other.message).toBe(
      'The incoming server rejected this login. Check the username and password, or create an app password.',
    )
    expect(
      connectionError({ authenticationFailed: true, response: false }, { host: 'imap.gmail.com' })
        .message,
    ).toMatch(/^Google didn’t accept this password\./)
  })
})
