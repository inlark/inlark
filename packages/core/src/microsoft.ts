import { ProviderError } from './errors'
import type { DiscoveryCandidate, DiscoverySource } from './model'

/*
 * Outlook.com and Microsoft 365 accept no password over IMAP or SMTP. An email app sends the
 * user to Microsoft in the browser and presents the token it gets back. These helpers recognise
 * Microsoft's servers so setup can offer that sign-in, and errors can say what Microsoft wants.
 */

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, '')

/**
 * inlark's registration with Microsoft. A desktop app can keep no secret, so it has none: this
 * ID only names the app on Microsoft's sign-in page, and is public.
 */
export const microsoftClientId = '75e89ace-e7ac-4516-9e1c-daf835270869'

/** Explains inlark to an organization's administrator and lets them approve it for everyone. */
export const microsoftAdminPage = 'https://inlark.com/microsoft/'

/** Microsoft's IMAP and SMTP servers, for Outlook.com and Microsoft 365 alike. */
export function isMicrosoftMailHost(host: string): boolean {
  return /^(outlook\.office365\.com|imap-mail\.outlook\.com|smtp-mail\.outlook\.com|smtp(-legacy)?\.office365\.com)$/.test(
    normalizeHost(host),
  )
}

/** The outgoing server for personal accounts. Work and school accounts use smtp.office365.com. */
export function isMicrosoftPersonalHost(host: string): boolean {
  return /^(imap|smtp)-mail\.outlook\.com$/.test(normalizeHost(host))
}

/**
 * A mail exchanger run by Microsoft, and whose mail it takes: `*.olc.protection.outlook.com` for
 * Outlook.com, Hotmail, Live and MSN addresses, `*.mail.protection.outlook.com` and the newer
 * `*.mx.microsoft` for Microsoft 365 domains.
 */
export function microsoftMx(host: string): 'personal' | 'work' | undefined {
  const name = normalizeHost(host)
  if (/\.olc\.protection\.outlook\.com$/.test(name)) return 'personal'
  return /\.(protection\.outlook\.com|mx\.microsoft)$/.test(name) ? 'work' : undefined
}

/**
 * Where a Microsoft 365 domain points `autodiscover.<domain>`. Microsoft asks every such domain
 * to publish it, and it stays in place when a mail filter takes over the domain's MX records.
 */
export function isMicrosoftAutodiscover(host: string): boolean {
  return /^autodiscover(-s)?\.outlook\.com$/.test(normalizeHost(host))
}

/** Microsoft's own server settings for an address whose mail Microsoft handles. */
export function microsoftCandidate(
  email: string,
  source: DiscoverySource,
  kind: 'personal' | 'work',
): DiscoveryCandidate {
  return {
    protocol: 'imap',
    source,
    provider: kind === 'personal' ? 'Outlook.com' : 'Microsoft 365',
    incoming: { host: 'outlook.office365.com', port: 993, security: 'tls', username: email },
    outgoing: {
      host: kind === 'personal' ? 'smtp-mail.outlook.com' : 'smtp.office365.com',
      port: 587,
      security: 'starttls',
      username: email,
    },
  }
}

/**
 * The largest message Microsoft Graph takes in one request. Graph receives the message as
 * base64 text, which is a third larger, and stops at 4 MB.
 */
export const microsoftGraphMessageLimit = 2_900_000

/** Shown while a mailbox can only send through Graph. */
export const microsoftSendLimit = {
  maxBytes: microsoftGraphMessageLimit,
  reason:
    'Microsoft has switched off SMTP for this mailbox, so inlark sends through another Microsoft service that takes messages up to about 3 MB.',
}

/** Outlook.com's settings page with the switch that lets email apps use IMAP. */
export const outlookImapSettings = 'https://outlook.live.com/mail/0/options/mail/forwarding'

/** Microsoft's own description of that switch and of its servers. */
export const outlookImapHelp =
  'https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com'

/**
 * Explains a sign-in that Microsoft's IMAP server refused, from the server's own response.
 * "Authenticated but not connected" means the token was fine and the mailbox has IMAP switched
 * off, which is how Outlook.com mailboxes start out. Never includes a password or token.
 */
export function microsoftImapError(response: string | undefined, signedIn: boolean): ProviderError {
  if (/authenticated but not connected/i.test(response || ''))
    return new ProviderError(
      'imapDisabled',
      'Microsoft accepted the sign-in, but IMAP is switched off for this mailbox. Turn on “Let devices and apps use IMAP” in Outlook’s settings. For a work or school account, ask your administrator.',
    )
  return new ProviderError(
    'authentication',
    signedIn
      ? 'Microsoft didn’t accept this sign-in. Sign in with Microsoft again.'
      : 'Microsoft doesn’t accept a password from email apps. Sign in with Microsoft instead.',
  )
}

/**
 * Microsoft switches SMTP off for some mailboxes, newer Outlook.com ones among them, and says so
 * when the app signs in to send. The sign-in itself was fine, so another way of sending can work.
 */
export function isMicrosoftSmtpDisabled(response: string | undefined): boolean {
  return /SmtpClientAuthentication is disabled/i.test(response || '')
}
