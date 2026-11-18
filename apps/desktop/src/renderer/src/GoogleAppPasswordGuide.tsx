import { useId, useState, type ReactNode } from 'react'
import { Button, cn } from '@inlark/ui'
import { ArrowUpRight, ChevronDown, Info, Key } from '@inlark/ui/icons'
import { friendlyError, googleAccountLinks, googleAppPasswordHelp } from '@inlark/core'
import { api } from './api'
import { toasts } from './Toasts'
import type { SetupMode } from './AccountSetup'

const open = (url: string) =>
  void api
    .openExternal(url)
    .catch((error) => toasts.show({ text: friendlyError(error), tone: 'error' }))

function Step({
  number,
  title,
  children,
  url,
}: {
  number: number
  title: string
  children?: ReactNode
  url?: string
}) {
  const id = useId()
  return (
    <li className="grid grid-cols-[18px_minmax(0,_1fr)_auto] gap-x-2.5 items-start py-2 [&+li]:border-t [&+li]:border-solid [&+li]:border-t-border">
      <span
        className="flex items-center justify-center w-4.5 h-4.5 mt-px rounded-full border border-solid border-border-strong text-[10px] font-medium text-muted tabular-nums"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0">
        <div id={id} className="text-[12px] font-medium text-strong leading-[1.5]">
          {title}
        </div>
        {children && (
          <p className="mt-0.5 mb-0 mx-0 text-[11px] text-muted leading-[1.6]">{children}</p>
        )}
      </div>
      {url && (
        <Button
          size="small"
          className="shrink-0 self-center"
          title="Opens myaccount.google.com in your browser"
          aria-describedby={id}
          onClick={() => open(url)}
        >
          Open
          <ArrowUpRight size={12} />
        </Button>
      )}
    </li>
  )
}

/**
 * Gmail and Google Workspace only accept an app password from email apps, and Google hides it
 * behind 2-Step Verification. This walks through both, with links to the exact pages.
 */
export function GoogleAppPasswordGuide({
  account,
  workspace,
  mode,
}: {
  /** The Google account the pages should open for. */
  account: string
  /** A Google Workspace account, whose organization decides whether app passwords exist. */
  workspace: boolean
  mode: SetupMode
}) {
  // Someone editing a working connection already has an app password.
  const [expanded, setExpanded] = useState(mode !== 'edit')
  const stepsId = useId()
  const links = googleAccountLinks(account)
  return (
    <div
      className={cn(
        'google-guide mt-3 pt-3 px-3.5 border border-solid border-border-strong rounded-lg bg-field',
        // The last step brings its own spacing.
        expanded ? 'pb-1' : 'pb-3',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Key size={14} className="shrink-0 mt-0.5 text-primary" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 min-h-5">
            <strong className="text-[12px] font-medium text-strong">
              Gmail needs an app password
            </strong>
            {mode === 'edit' && (
              <Button
                variant="ghost"
                size="small"
                className="-my-1 -mr-2 text-muted"
                aria-expanded={expanded}
                aria-controls={stepsId}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? 'Hide steps' : 'Show steps'}
                <ChevronDown
                  size={12}
                  className={cn('transition-transform duration-120', expanded && 'rotate-180')}
                />
              </Button>
            )}
          </div>
          <p className="mt-1 mb-0 mx-0 text-[11px] text-secondary leading-[1.6]">
            {mode === 'signIn'
              ? 'Google doesn’t let email apps use your regular password. Changing your Google password cancels app passwords, so you may need to create a new one.'
              : 'Google doesn’t let email apps use your regular password. Instead, you create a separate password just for inlark.'}
          </p>
        </div>
      </div>
      {expanded && (
        <div id={stepsId}>
          <ol className="list-none mt-2 mb-0 mx-0 p-0">
            <Step number={1} title="Turn on 2-Step Verification" url={links.twoStepVerification}>
              Skip this if it’s already on.
            </Step>
            <Step number={2} title="Create an app password" url={links.appPasswords}>
              Name it “inlark” and copy the 16 letters Google shows.
            </Step>
            <Step number={3} title="Paste it under App password below" />
          </ol>
          <div className="flex gap-2 mt-0.5 mb-2.5 pt-2.5 border-t border-solid border-t-border text-[11px] text-muted leading-[1.6] [&_svg]:shrink-0 [&_svg]:mt-[3px]">
            <Info size={13} />
            <p className="m-0">
              If Google says the setting isn’t available, check that 2-Step Verification is on.
              Google doesn’t offer app passwords with Advanced Protection or when 2-Step
              Verification uses only security keys.
              {workspace &&
                ' Your organization may also have turned them off. If so, ask your administrator.'}{' '}
              <button
                type="button"
                className="inline border-0 bg-none bg-transparent p-0 text-primary text-[11px] hover:underline"
                onClick={() => open(googleAppPasswordHelp)}
              >
                Google’s help
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
