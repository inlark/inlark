/*
 * inlark's registration with Microsoft, as an organization's administrator sees it. The same
 * values live in the desktop app (`packages/core/src/microsoft.ts` and
 * `apps/desktop/src/main/microsoft-auth.ts`); `tests/marketing-microsoft.test.ts` keeps them equal.
 */

/** Public: it only names the app on Microsoft's pages. A desktop app has no secret. */
export const clientId = '75e89ace-e7ac-4516-9e1c-daf835270869'

/** Where Microsoft sends an administrator after they decide. Registered with Microsoft as is. */
export const adminPage = 'https://inlark.com/microsoft/'

export const permissions = [
  {
    name: 'IMAP.AccessAsUser.All',
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All',
    microsoft: 'Read and write access to your mail',
    use: 'Shows a person their own mail and files, flags, moves and deletes it as they ask.',
  },
  {
    name: 'SMTP.Send',
    scope: 'https://outlook.office.com/SMTP.Send',
    microsoft: 'Access to sending emails from your mailbox',
    use: 'Sends the messages a person writes, from their own address.',
  },
  {
    name: 'Mail.Send',
    scope: 'https://graph.microsoft.com/Mail.Send',
    microsoft: 'Send mail as you',
    use: 'Sends through Microsoft Graph instead, for mailboxes where SMTP is switched off.',
  },
  {
    name: 'offline_access',
    scope: 'offline_access',
    microsoft: 'Maintain access to data you have given it access to',
    use: 'Keeps a person signed in, so they aren’t sent to Microsoft every hour.',
  },
  {
    name: 'openid, email',
    scope: 'openid email',
    microsoft: 'View your email address',
    use: 'Tells inlark which account signed in, so it opens the right mailbox.',
  },
]

/**
 * Microsoft's page where an administrator approves inlark for everyone in their organization.
 * It asks for exactly the permissions above and returns to this site afterwards.
 */
export const approveUrl =
  'https://login.microsoftonline.com/organizations/v2.0/adminconsent?' +
  new URLSearchParams({
    client_id: clientId,
    scope: permissions.map((p) => p.scope).join(' '),
    redirect_uri: adminPage,
  })
