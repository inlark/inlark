import { useLayoutEffect, useRef, useState } from 'react'
import { Button, cn } from '@inlark/ui'
import {
  ArrowUpRight,
  Laptop,
  LockKeyhole,
  ShieldCheck,
  type IconComponent,
} from '@inlark/ui/icons'
import type { Bootstrap, Settings } from '@inlark/core'
import appIcon from '../../../resources/icon.svg?no-inline'
import { AccountSetup, type SetupPhase } from './AccountSetup'
import { SegmentedControl } from './SegmentedControl'
import { openPage } from './SetupGuide'
import { ShortcutHint } from './shortcuts'

const privacyUrl = 'https://inlark.com/privacy'
const themes = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const
/** Each part of the screen settles into place a moment after the one above it. */
const rise =
  'animate-[rise-in_520ms_cubic-bezier(0.2,0.8,0.2,1)_both] motion-reduce:[animation-delay:0ms]'

/**
 * What someone sees before any account is connected. Connecting one is the only thing inlark
 * needs from them, so the screen is that step and nothing else: no tour and no questions. The
 * theme is within reach for whoever opened a dark window in a bright room, and asks nothing.
 */
export function Welcome({
  bootstrap,
  onTheme,
  onSettings,
}: {
  bootstrap: Bootstrap
  onTheme: (theme: Settings['theme']) => void
  onSettings: () => void
}) {
  const [phase, setPhase] = useState<SetupPhase>('email')
  const scroller = useRef<HTMLElement>(null)
  // A step starts at its top. Focusing its first field would otherwise scroll past whatever
  // comes before it, such as the server that was found or a provider's instructions.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [phase])
  // What the privacy page promises, said where a password is about to be asked for.
  const promises: [IconComponent, string][] = [
    [Laptop, 'Your mail goes between this computer and your mail provider, and nowhere else.'],
    [
      LockKeyhole,
      bootstrap.secureStorage
        ? 'A login you save is encrypted by your system’s keyring.'
        : 'You decide whether this computer remembers your login.',
    ],
    [ShieldCheck, 'No telemetry, analytics or crash reports.'],
  ]
  return (
    <div className="welcome relative flex-1 min-w-0 flex flex-col pt-(--titlebar-height) overflow-hidden">
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 pointer-events-none',
          'bg-[radial-gradient(62%_46%_at_50%_0%,color-mix(in_srgb,var(--accent-solid)_13%,transparent),transparent)]',
        )}
      />
      <main
        ref={scroller}
        className="relative flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
      >
        <div
          className={cn(
            'mx-auto w-[min(460px,calc(100%_-_48px))]',
            // The first step has room to breathe; the ones after it need the height.
            phase === 'email' ? 'pt-[clamp(28px,14vh,140px)] pb-10' : 'pt-[clamp(24px,7vh,64px)]',
          )}
        >
          {phase === 'email' && (
            <header className="mb-7">
              <img
                src={appIcon}
                alt=""
                draggable={false}
                className={cn('block w-13 h-13 mb-6 drop-shadow-[0_6px_18px_#1b1a5c55]', rise)}
              />
              <h1
                className={cn(
                  'm-0 text-[28px] font-[600] tracking-[-0.9px] leading-[1.2] text-strong',
                  rise,
                  '[animation-delay:50ms]',
                )}
              >
                Welcome to inlark
              </h1>
              <p
                className={cn(
                  'mt-2.5 mb-0 mx-0 text-[14px] leading-[1.6] text-secondary text-pretty',
                  rise,
                  '[animation-delay:100ms]',
                )}
              >
                Enter your email address and inlark finds your server settings. You’ll see them
                before your password is sent anywhere.
              </p>
            </header>
          )}
          <div
            className={cn(
              phase === 'email' && rise,
              phase === 'email' && '[animation-delay:150ms]',
            )}
          >
            <AccountSetup
              welcome
              bootstrap={bootstrap}
              // The window changes as soon as an account exists; there is nothing left to say here.
              onDone={() => {}}
              onPhaseChange={setPhase}
            />
          </div>
          {phase === 'email' && (
            <div
              className={cn(
                'mt-9 pt-5 border-t border-solid border-t-border',
                rise,
                '[animation-delay:230ms]',
              )}
            >
              <ul className="list-none m-0 p-0 grid gap-2.5">
                {promises.map(([Icon, text]) => (
                  <li
                    key={text}
                    className="flex items-start gap-2.5 text-[12px] leading-[1.55] text-muted"
                  >
                    <Icon size={14} className="shrink-0 mt-[2px] text-faint" />
                    {text}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 mt-3 ml-6 p-0 border-0 bg-transparent text-[12px] text-secondary',
                  'transition-[color] duration-120 ease-[ease] hover:text-strong',
                )}
                title="Opens inlark.com in your browser"
                onClick={() => openPage(privacyUrl)}
              >
                How inlark handles your data
                <ArrowUpRight size={12} />
              </button>
            </div>
          )}
        </div>
      </main>
      <footer className="relative shrink-0 flex items-center justify-between gap-4 h-13 px-4">
        <SegmentedControl
          label="Theme"
          size="small"
          value={bootstrap.settings.theme}
          options={themes}
          onChange={onTheme}
        />
        <Button variant="ghost" size="small" className="gap-2 text-muted" onClick={onSettings}>
          Settings
          <ShortcutHint id="settings" />
        </Button>
      </footer>
    </div>
  )
}
