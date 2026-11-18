import { useId, type ReactNode } from 'react'
import { Button, cn } from '@inlark/ui'
import { ArrowUpRight } from '@inlark/ui/icons'
import { friendlyError } from '@inlark/core'
import { api } from './api'
import { toasts } from './Toasts'

/** Opens a provider's page in the browser, saying so if that fails. */
export const openPage = (url: string) =>
  void api
    .openExternal(url)
    .catch((error) => toasts.show({ text: friendlyError(error), tone: 'error' }))

/** The framed card that setup guides share. */
export function GuideCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mt-3 pt-3 px-3.5 border border-solid border-border-strong rounded-lg bg-field',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** One numbered step of a setup guide, with a button when it happens on a provider's page. */
export function GuideStep({
  number,
  title,
  children,
  url,
  opens,
}: {
  number: number
  title: string
  children?: ReactNode
  url?: string
  /** The site the button opens, such as "myaccount.google.com". */
  opens?: string
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
          title={opens ? `Opens ${opens} in your browser` : 'Opens in your browser'}
          aria-describedby={id}
          onClick={() => openPage(url)}
        >
          Open
          <ArrowUpRight size={12} />
        </Button>
      )}
    </li>
  )
}
