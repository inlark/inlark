import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { Button, IconButton, cn } from '@inlark/ui'
import { Coffee, X } from '@inlark/ui/icons'
import { friendlyError } from '@inlark/core'
import { api } from './api'
import { toasts } from './Toasts'
import {
  localDay,
  markSupported,
  recordActiveDay,
  shouldShowSupportPrompt,
  snoozeSupportPrompt,
  subscribeSupportPrompt,
  supportPromptSnapshot,
  supportUrl,
  updateSupportPrompt,
} from './support-prompt'

/**
 * Opens the support page in the browser, explaining any failure. Whoever opens it isn't asked
 * again in the sidebar. Resolves to whether the page opened.
 */
export function openSupportPage(): Promise<boolean> {
  return api.openExternal(supportUrl).then(
    () => {
      markSupported()
      return true
    },
    (error) => {
      toasts.show({ text: friendlyError(error), tone: 'error' })
      return false
    },
  )
}

/**
 * A small, dismissible request for support above Settings. It appears once an account is
 * connected, never while the sidebar is reporting a problem, and never in a collapsed sidebar.
 */
export function SupportCard({ connected, quiet }: { connected: boolean; quiet: boolean }) {
  const state = useSyncExternalStore(subscribeSupportPrompt, supportPromptSnapshot)
  const [today, setToday] = useState(localDay)
  const [thanked, setThanked] = useState(false)
  const titleId = useId()
  // A day counts when the window is in use with a connected account: focused, not just open in
  // the tray or visible behind another app.
  useEffect(() => {
    if (!connected) return
    const record = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      const day = localDay()
      setToday(day)
      updateSupportPrompt((current) => recordActiveDay(current, day))
    }
    record()
    window.addEventListener('focus', record)
    document.addEventListener('visibilitychange', record)
    // A window left open past midnight starts a new day without any focus change.
    const rollover = window.setInterval(record, 15 * 60_000)
    return () => {
      window.removeEventListener('focus', record)
      document.removeEventListener('visibilitychange', record)
      window.clearInterval(rollover)
    }
  }, [connected])
  // The thanks stays until the person is back from the browser long enough to read it: the
  // countdown only runs while inlark is focused and starts over each time they return.
  useEffect(() => {
    if (!thanked) return
    let timer: number | undefined
    const stop = () => window.clearTimeout(timer)
    const start = () => {
      stop()
      if (document.hasFocus() && document.visibilityState === 'visible')
        timer = window.setTimeout(() => setThanked(false), 6000)
    }
    start()
    window.addEventListener('focus', start)
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', start)
    return () => {
      stop()
      window.removeEventListener('focus', start)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', start)
    }
  }, [thanked])
  if (quiet || (!thanked && (!connected || !shouldShowSupportPrompt(state, today)))) return null
  return (
    <section
      className={cn(
        'support-card relative mb-2 mx-0.5 rounded-lg border border-solid border-border-strong bg-surface',
        'pt-2.5 pb-3 pl-3 pr-2.5 text-[12px] leading-[1.45] shadow-[0_1px_2px_#0000000f]',
        '[@media(max-height:620px)]:hidden',
      )}
      aria-labelledby={titleId}
    >
      <div className="flex items-center gap-2 min-h-5.5">
        <Coffee size={15} strokeWidth={1.65} className="text-muted shrink-0" aria-hidden="true" />
        <strong id={titleId} className="flex-1 min-w-0 font-medium text-strong">
          {thanked ? 'Thank you!' : 'Enjoying inlark?'}
        </strong>
        <IconButton
          className="w-5.5 h-5.5 min-h-5.5 p-0 -mr-1 text-faint"
          label={thanked ? 'Close' : 'Don’t show again'}
          onClick={() => {
            if (thanked) setThanked(false)
            else updateSupportPrompt((current) => ({ ...current, done: 'dismissed' }))
          }}
        >
          <X size={12} />
        </IconButton>
      </div>
      <p className="mt-1 mb-0 text-muted">
        {thanked
          ? 'It means a lot, and it helps keep inlark going.'
          : 'It’s free and made by one person. A coffee would make my day.'}
      </p>
      {!thanked && (
        <div className="flex items-center gap-1 mt-2.5">
          <Button
            size="small"
            className="min-w-0"
            onClick={() => {
              // Thank first, so the card doesn't blink out while the browser opens.
              setThanked(true)
              void openSupportPage().then((opened) => {
                if (!opened) setThanked(false)
              })
            }}
          >
            Buy me a coffee
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={() =>
              updateSupportPrompt((current) => snoozeSupportPrompt(current, localDay()))
            }
          >
            Later
          </Button>
        </div>
      )}
    </section>
  )
}
