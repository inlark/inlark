import type { DiscoveryCandidate, DiscoverySource } from './model'

/*
 * Gmail and Google Workspace accept a password over IMAP and SMTP only as an app password, which
 * Google offers once 2-Step Verification is on. These helpers recognise Google's servers so setup
 * can explain that before the first failed sign-in, and errors can say what Google wants.
 */

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, '')

/** Google's IMAP and SMTP servers, used by Gmail and Google Workspace alike. */
export function isGoogleMailHost(host: string): boolean {
  return /^(imap|smtp)\.(gmail|googlemail)\.com$/.test(normalizeHost(host))
}

/** A consumer Gmail address. Other addresses on Google's servers belong to Google Workspace. */
export function isGmailAddress(email: string): boolean {
  return /@(gmail|googlemail)\.com\.?$/.test(email.trim().toLowerCase())
}

/**
 * A mail exchanger run by Google: aspmx.l.google.com and its alternates, smtp.google.com for
 * newer Workspace domains, gmail-smtp-in.l.google.com, and the older aspmx*.googlemail.com.
 */
export function isGoogleMx(host: string): boolean {
  return /(^|\.)(google|googlemail)\.com$/.test(normalizeHost(host))
}

/** Google's own server settings for an address whose mail Google handles. */
export function googleCandidate(email: string, source: DiscoverySource): DiscoveryCandidate {
  return {
    protocol: 'imap',
    source,
    provider: isGmailAddress(email) ? 'Gmail' : 'Google Workspace',
    incoming: { host: 'imap.gmail.com', port: 993, security: 'tls', username: email },
    outgoing: { host: 'smtp.gmail.com', port: 465, security: 'tls', username: email },
  }
}

/**
 * Google Account pages for turning on 2-Step Verification and creating an app password.
 * `authuser` asks Google to open them for this account when several are signed in.
 */
export function googleAccountLinks(account: string) {
  const query = account.includes('@') ? '?authuser=' + encodeURIComponent(account.trim()) : ''
  return {
    twoStepVerification: 'https://myaccount.google.com/signinoptions/two-step-verification' + query,
    appPasswords: 'https://myaccount.google.com/apppasswords' + query,
  }
}

/**
 * Google shows an app password as four groups of four letters. The spaces aren't part of it, so
 * a pasted copy is joined up; anything else is left exactly as typed.
 */
export function compactAppPassword(value: string): string {
  const trimmed = value.trim()
  return /^[a-z]{4}(\s+[a-z]{4}){3}$/i.test(trimmed) ? trimmed.replace(/\s+/g, '') : value
}

/** The password to send to `host`: joined up for Google's servers, untouched for any other. */
export function passwordFor(host: string, value: string): string {
  return isGoogleMailHost(host) ? compactAppPassword(value) : value
}

/** Google's explanation of app passwords, including when they aren't offered. */
export const googleAppPasswordHelp = 'https://support.google.com/accounts/answer/185833'

/**
 * Explains a login that Google's IMAP or SMTP server refused, from the server's own response.
 * Never includes the password.
 */
export function googleLoginError(response: string | undefined, sending = false): string {
  const text = response || ''
  if (/application-specific password required|InvalidSecondFactor/i.test(text))
    return 'Google needs an app password for this account, not the regular Google password.'
  if (/web ?browser|WebLoginRequired/i.test(text))
    return 'Google stopped this sign-in as unusual. Sign in to Gmail in a browser to confirm it was you, then try again.'
  return (
    'Google didn’t accept this password' +
    (sending ? ' for sending mail' : '') +
    '. Gmail needs an app password, and changing the Google password cancels existing ones.'
  )
}
