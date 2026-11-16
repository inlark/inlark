import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Toaster as SonnerToaster, toast as sonner } from 'sonner'
import { cn, Spinner } from '@inlark/ui'
import { AlertCircle, Check, Info, X } from '@inlark/ui/icons'
import { ShortcutHint } from './shortcuts'
import { canUndo, ToastStack, type LiveToast, type ToastControls } from './toast-stack'

const secondsUntil = (time: string) =>
  Math.max(0, Math.ceil((Date.parse(time) - Date.now()) / 1000))

/** Seconds left until `to`, ticking down on its own so the toast isn't replaced every second. */
export function Countdown({ to, className }: { to: string; className?: string }) {
  const [seconds, setSeconds] = useState(() => secondsUntil(to))
  useEffect(() => {
    const timer = setInterval(() => setSeconds(secondsUntil(to)), 250)
    return () => clearInterval(timer)
  }, [to])
  return (
    <span className={cn('shrink-0 tabular-nums text-muted', className)} aria-hidden="true">
      {seconds}s
    </span>
  )
}

function ToastCard({ toast, controls }: { toast: LiveToast; controls: ToastControls }) {
  const progress = toast.tone === 'progress'
  return (
    <div
      className={cn(
        'toast-card flex gap-3.25 items-center w-full h-full bg-raised border border-solid',
        'border-border-strong shadow-popup py-2.75 px-3.75 rounded-lg text-[12px] overflow-hidden',
        '[&>svg]:shrink-0 [&>svg]:text-primary',
        '[&_button]:border-0 [&_button]:bg-transparent [&_button]:text-primary [&_button]:text-[11px]',
        '[&_button]:p-[3px] [&_button]:shrink-0',
        toast.tone === 'error' && '[&>svg:first-child]:text-danger',
      )}
      role={toast.tone === 'error' ? 'alert' : undefined}
    >
      {toast.tone === 'error' ? (
        <AlertCircle size={15} />
      ) : toast.tone === 'info' ? (
        <Info size={15} />
      ) : progress ? (
        <Spinner />
      ) : (
        <Check size={15} />
      )}
      <span className="flex-1 min-w-0">{toast.text}</span>
      {toast.countdownTo && <Countdown to={toast.countdownTo} />}
      {toast.action && (
        <button
          className="rounded-sm py-[3px] px-2 font-medium hover:bg-primary-tint"
          onClick={toast.action.run}
        >
          {toast.action.label}
        </button>
      )}
      {canUndo(toast) && (
        <button
          className={cn(
            'inline-flex items-center gap-1.5 py-[3px] pr-1 pl-2 rounded-sm font-medium',
            'hover:bg-primary-tint [&_kbd]:h-4 [&_kbd]:min-w-4 [&_kbd]:text-[9px]',
            '[&_kbd]:text-primary [&_kbd]:border-primary/35',
          )}
          onClick={controls.undo}
        >
          Undo <ShortcutHint id="undo" />
        </button>
      )}
      {!progress && (
        <button
          className="grid place-items-center rounded-sm text-muted! hover:text-foreground! hover:bg-hover"
          aria-label="Dismiss notification"
          onClick={controls.dismiss}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

/** The app's toasts. Sonner stacks and times them; inlark draws each one. */
export const toasts = new ToastStack({
  show: (toast, duration, controls) =>
    void sonner.custom(() => <ToastCard toast={toast} controls={controls} />, {
      id: toast.id,
      duration,
      dismissible: toast.tone !== 'progress',
      // Always set both, so a toast replaced in place drops the previous version's handlers.
      onDismiss: controls.closed,
      onAutoClose: controls.closed,
    }),
  dismiss: (id) => void sonner.dismiss(id),
})

export function Toaster() {
  return (
    <SonnerToaster
      className="toaster"
      position="bottom-center"
      // Keyboard access goes through inlark's own shortcuts, which people can rebind.
      hotkey={[]}
      customAriaLabel="Notifications"
      visibleToasts={3}
      gap={8}
      offset={{ bottom: 23 }}
      style={
        {
          '--width': 'min(440px, calc(100vw - var(--rail) - 32px))',
          left: 'calc(50% + var(--rail) / 2 - 4px)',
        } as CSSProperties
      }
    />
  )
}

/** A progress toast that stays while this component is mounted, such as a Suspense fallback. */
export function ProgressToast({ text }: { text: string }) {
  const id = useRef<number>(undefined)
  useEffect(() => {
    // Reusing the id lets a quick remount (React's strict mode) update the toast instead of
    // flashing a second one.
    id.current = toasts.show({ text, tone: 'progress' }, id.current)
    return () => toasts.dismiss(id.current!)
  }, [text])
  return null
}
