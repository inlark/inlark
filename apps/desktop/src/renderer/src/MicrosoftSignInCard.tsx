import { useState, type ReactNode } from 'react'
import { Button, Spinner } from '@inlark/ui'
import { AlertCircle, ArrowUpRight, Check, Copy, Info } from '@inlark/ui/icons'
import {
  microsoftAdminPage,
  outlookImapHelp,
  outlookImapSettings,
  type ConnectionFix,
  type MicrosoftSignInResult,
} from '@inlark/core'
import type { SetupMode } from './AccountSetup'
import { GuideCard, GuideStep, openPage } from './SetupGuide'

/** Where a Microsoft sign-in stands. A sign-in kept with the connection has no `grant`. */
export type MicrosoftSignInState =
  | { phase: 'idle' }
  | { phase: 'waiting'; id: string; url: string }
  | { phase: 'signedIn'; grant?: string; email?: string; personal: boolean }

export type MicrosoftProblem = Extract<MicrosoftSignInResult, { ok: false }>

/** Microsoft's mark, which its sign-in guidelines ask apps to show beside the offer. */
function MicrosoftMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 21 21"
      className="shrink-0 mt-0.5"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="10" height="10" fill="#f25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
      <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
      <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
    </svg>
  )
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <MicrosoftMark />
      <div className="flex-1 min-w-0">
        <strong className="block text-[12px] font-medium text-strong leading-[1.65]">
          {title}
        </strong>
        {children && (
          <p className="mt-1 mb-0 mx-0 text-[11px] text-secondary leading-[1.6]">{children}</p>
        )}
      </div>
    </div>
  )
}
const Actions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap gap-2 mt-3 ml-6">{children}</div>
)
const Note = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2 mt-3 pt-2.5 border-t border-solid border-t-border text-[11px] text-muted leading-[1.6] [&_svg]:shrink-0 [&_svg]:mt-[3px]">
    <Info size={13} />
    <p className="m-0">{children}</p>
  </div>
)
const TextLink = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    className="inline border-0 bg-none bg-transparent p-0 text-primary text-[11px] hover:underline"
    onClick={onClick}
  >
    {children}
  </button>
)

/** Copies the page an administrator needs, confirming on the button itself. */
function CopyAdminLink() {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="small"
      onClick={() =>
        void navigator.clipboard.writeText(microsoftAdminPage).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          },
          () => openPage(microsoftAdminPage),
        )
      }
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy link for your administrator'}
    </Button>
  )
}
const adminPageName = microsoftAdminPage.replace(/^https:\/\//, '').replace(/\/$/, '')

/**
 * Outlook.com and Microsoft 365 take no password from email apps. This offers Microsoft's own
 * sign-in in the browser in place of the password field, and walks through what Microsoft may
 * still want afterwards: IMAP switched on, or an administrator's approval.
 */
export function MicrosoftSignInCard({
  account,
  personal,
  state,
  problem,
  fix,
  other,
  busy,
  mode,
  onOpenAgain,
  onCancel,
  onUseOther,
  onDifferentAccount,
}: {
  /** The address being set up. */
  account: string
  /** An Outlook.com, Hotmail, Live or MSN account, as far as is known. */
  personal: boolean
  state: MicrosoftSignInState
  /** Why the last sign-in didn't finish. */
  problem?: MicrosoftProblem
  /** What the connection check asks for, once signed in. */
  fix?: ConnectionFix
  /** The account Microsoft signed in when it isn't the one being set up. */
  other?: string
  busy: boolean
  mode: SetupMode
  onOpenAgain: () => void
  onCancel: () => void
  /** Absent for a connection that already exists, which stays with its own mailbox. */
  onUseOther?: (email: string) => void
  onDifferentAccount: () => void
}) {
  const signedInAs = state.phase === 'signedIn' ? state.email || account : account
  if (state.phase === 'waiting')
    return (
      <GuideCard className="pb-3">
        <Heading title="Finish signing in in your browser">
          Microsoft’s page opened in your browser. inlark carries on by itself as soon as Microsoft
          sends you back.
        </Heading>
        <Actions>
          <Button size="small" onClick={onOpenAgain}>
            Open the page again
            <ArrowUpRight size={12} />
          </Button>
          <Button size="small" variant="ghost" className="text-muted" onClick={onCancel}>
            Cancel sign-in
          </Button>
        </Actions>
        {!personal && (
          <Note>
            If Microsoft says an administrator has to approve inlark, cancel here and send them{' '}
            <TextLink onClick={() => openPage(microsoftAdminPage)}>{adminPageName}</TextLink>. It
            explains inlark and lets them approve it for your organization.
          </Note>
        )}
      </GuideCard>
    )
  if (state.phase === 'signedIn' && fix === 'outlookImap')
    return (
      <GuideCard className="pb-1">
        <Heading title="Turn on IMAP in Outlook">
          Microsoft signed you in, but Outlook keeps IMAP switched off until you turn it on. Email
          apps need it to read your mail.
        </Heading>
        <ol className="list-none mt-2 mb-0 mx-0 p-0">
          <GuideStep
            number={1}
            title="Open Outlook’s Forwarding and IMAP settings"
            url={outlookImapSettings}
            opens="outlook.live.com"
          >
            Sign in as {signedInAs} if Outlook asks.
          </GuideStep>
          <GuideStep number={2} title="Switch on “Let devices and apps use IMAP”">
            It’s under POP and IMAP. Then select Save.
          </GuideStep>
          <GuideStep number={3} title="Select Check again below">
            Outlook can take a minute to apply the change.
          </GuideStep>
        </ol>
        <div className="flex gap-2 mt-0.5 mb-2.5 pt-2.5 border-t border-solid border-t-border text-[11px] text-muted leading-[1.6] [&_svg]:shrink-0 [&_svg]:mt-[3px]">
          <Info size={13} />
          <p className="m-0">
            Nothing else needs to change, and you don’t have to sign in again.{' '}
            <TextLink onClick={() => openPage(outlookImapHelp)}>Microsoft’s help</TextLink>
          </p>
        </div>
      </GuideCard>
    )
  if (state.phase === 'signedIn' && fix === 'microsoftImapAdmin')
    return (
      <GuideCard className="pb-3">
        <Heading title="IMAP is switched off for this mailbox">
          Microsoft signed you in, but your organization has turned off IMAP for {signedInAs}. Only
          an administrator can turn it on. Ask them to enable IMAP for your mailbox, then select
          Check again below.
        </Heading>
      </GuideCard>
    )
  if (state.phase === 'signedIn' && other)
    return (
      <GuideCard className="pb-3">
        <Heading title={`Microsoft signed you in as ${other}`}>
          {onUseOther
            ? `You entered ${account}. If that’s another name for the same mailbox, connect ${other} and add ${account} under Email addresses afterwards. Otherwise, sign in with the account you meant.`
            : `This connection is for ${account}. Sign in with that account to keep using it.`}
        </Heading>
        <Actions>
          {onUseOther && (
            <Button size="small" disabled={busy} onClick={() => onUseOther(other)}>
              Connect {other}
            </Button>
          )}
          <Button size="small" disabled={busy} onClick={onDifferentAccount}>
            Sign in with another account
          </Button>
        </Actions>
      </GuideCard>
    )
  if (state.phase === 'signedIn')
    return (
      <GuideCard className="pb-3">
        <div className="flex items-start gap-2.5">
          <MicrosoftMark />
          <div className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-3">
            <strong className="text-[12px] font-medium text-strong leading-[1.65] [overflow-wrap:anywhere]">
              Signed in with Microsoft as {signedInAs}
            </strong>
            <TextLink onClick={onDifferentAccount}>
              {state.grant ? 'Use another account' : 'Sign in again'}
            </TextLink>
          </div>
        </div>
      </GuideCard>
    )
  // Microsoft's own pages send a work or school account back without saying whether an
  // administrator has to approve inlark, so that case is offered rather than asserted.
  if (problem?.reason === 'adminApproval' || (problem?.reason === 'sentBack' && !personal)) {
    const certain = problem.reason === 'adminApproval'
    return (
      <GuideCard className="pb-3">
        <Heading
          title={
            certain
              ? 'Your organization has to approve inlark first'
              : 'Your organization may need to approve inlark'
          }
        >
          {certain
            ? 'Microsoft only lets people in your organization use apps an administrator has approved. Send your administrator the page below.'
            : 'Microsoft sent you back without signing in. If it asked for an administrator’s approval, send your administrator the page below.'}{' '}
          It explains what inlark is and what it can access, and lets them approve it once for
          everyone.
        </Heading>
        <Actions>
          <CopyAdminLink />
          <Button size="small" onClick={() => openPage(microsoftAdminPage)}>
            Open the page
            <ArrowUpRight size={12} />
          </Button>
        </Actions>
        <Note>
          {certain
            ? 'Once it’s approved, sign in with Microsoft again below.'
            : 'Once it’s approved, or if you only went back, sign in with Microsoft again below.'}
        </Note>
      </GuideCard>
    )
  }
  return (
    <GuideCard className="pb-3">
      <Heading title={personal ? 'Outlook signs you in with Microsoft' : 'Sign in with Microsoft'}>
        {mode === 'signIn'
          ? 'Your sign-in ended or was withdrawn. Microsoft asks for your password in your browser, so inlark never sees it.'
          : 'Microsoft asks for your password in your browser, so inlark never sees it. It then asks you to let inlark read and send your mail.'}
      </Heading>
      {busy && (
        <div className="flex items-center gap-2 mt-3 ml-6 text-[11px] text-muted" role="status">
          <Spinner size={12} />
          Opening Microsoft’s sign-in page…
        </div>
      )}
      {problem && !busy && (
        <div
          role="alert"
          className="flex gap-2 mt-3 ml-6 text-[11px] leading-[1.6] text-danger [&_svg]:shrink-0 [&_svg]:mt-[3px]"
        >
          <AlertCircle size={13} />
          <span>{problem.message}</span>
        </div>
      )}
      {!personal && !busy && (
        <Note>
          Work and school accounts often need an administrator’s approval first. If Microsoft asks
          for it, send them{' '}
          <TextLink onClick={() => openPage(microsoftAdminPage)}>{adminPageName}</TextLink>.
        </Note>
      )}
    </GuideCard>
  )
}
