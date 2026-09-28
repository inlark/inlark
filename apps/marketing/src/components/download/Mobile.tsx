import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Calendar, CalendarAdd, Check, ChevronRight, Copy, Mail, Share, X } from '@inlark/ui/icons'
import { accounts } from '../../data/mail'
import { AppTile } from './icons'
import { useCopied } from './CodeBlock'

const shareText = 'Inlark, a calm and fast email client. Download it on your computer:'

/** Tomorrow at nine, when most people are back at their desk. */
function reminderStart() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date
}

function calendars(url: string) {
  const start = reminderStart()
  const end = new Date(start.getTime() + 15 * 60_000)
  const compact = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const details = `Install Inlark on your computer: ${url}`
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'Download Inlark',
    dates: `${compact(start)}/${compact(end)}`,
    details,
  })
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: 'Download Inlark',
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: details,
  })
  return {
    start,
    options: [
      {
        label: 'Apple Calendar',
        detail: 'Or any app that opens .ics files',
        href: '/api/reminder.ics?start=' + encodeURIComponent(start.toISOString()),
        external: false,
      },
      {
        label: 'Google Calendar',
        detail: 'calendar.google.com',
        href: 'https://calendar.google.com/calendar/render?' + google,
        external: true,
      },
      {
        label: 'Outlook',
        detail: 'outlook.com',
        href: 'https://outlook.live.com/calendar/0/action/compose?' + outlook,
        external: true,
      },
    ],
  }
}

/** Phones get a way to take the download to a computer, since there's nothing to install here. */
export function Mobile() {
  const [url, setUrl] = useState('')
  const [canShare, setCanShare] = useState(false)
  const [android, setAndroid] = useState(false)
  const [copied, copy] = useCopied()
  const [calendar, setCalendar] = useState<ReturnType<typeof calendars> | null>(null)
  const sheet = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const link = location.origin + '/download'
    setUrl(link)
    setCanShare(typeof navigator.share === 'function')
    setAndroid(/Android/i.test(navigator.userAgent))
  }, [])

  const share = async () => {
    try {
      await navigator.share({ title: 'Inlark', text: shareText, url })
    } catch {
      // Closing the share sheet rejects too, and needs no feedback.
    }
  }
  const openCalendar = () => {
    setCalendar(calendars(url))
    sheet.current?.showModal()
  }
  const closeCalendar = () => sheet.current?.close()

  // Android phones rarely open .ics files, so Google Calendar goes first there.
  const options = calendar
    ? android
      ? [calendar.options[1], calendar.options[0], calendar.options[2]]
      : calendar.options
    : []
  const time = calendar
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
        calendar.start,
      )
    : ''

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 text-center">
      <LaptopVisual />

      <p className="eyebrow rise mt-12" style={{ '--delay': '.1s' } as CSSProperties}>
        Linux · Windows · macOS
      </p>
      <h1
        className="display rise mt-5 text-[clamp(2.6rem,12vw,3.6rem)]"
        style={{ '--delay': '.16s' } as CSSProperties}
      >
        Made for your <em className="dawn-text pr-[0.06em]">desktop.</em>
      </h1>
      <p
        className="rise mt-5 text-[1.05rem] leading-relaxed text-ink-2"
        style={{ '--delay': '.22s' } as CSSProperties}
      >
        Inlark is a desktop app, and there’s no phone version yet. Send yourself the link and pick
        it up on your computer.
      </p>

      <div
        className="rise mt-9 grid w-full grid-cols-2 gap-2.5"
        style={{ '--delay': '.28s' } as CSSProperties}
      >
        {canShare ? (
          <button type="button" onClick={share} className="btn btn-primary col-span-2 h-12">
            <Share size={17} /> Share link
          </button>
        ) : (
          <a
            href={`mailto:?subject=${encodeURIComponent('Download Inlark')}&body=${encodeURIComponent(shareText + '\n' + url)}`}
            className="btn btn-primary col-span-2 h-12"
          >
            <Mail size={17} /> Email me the link
          </a>
        )}
        <button type="button" onClick={openCalendar} className="btn btn-ghost h-12 px-3">
          <CalendarAdd size={17} /> Remind me
        </button>
        <button
          type="button"
          onClick={() => copy(url)}
          className="btn btn-ghost h-12 px-3"
          aria-label={copied ? 'Link copied' : 'Copy link'}
        >
          {copied ? (
            <>
              <Check size={17} className="text-leaf" /> Copied
            </>
          ) : (
            <>
              <Copy size={17} /> Copy link
            </>
          )}
        </button>
      </div>
      <span className="sr-only" role="status">
        {copied ? 'Link copied' : ''}
      </span>
      <p
        className="rise mt-4 font-mono text-[0.72rem] tracking-wide text-ink-3"
        style={{ '--delay': '.32s' } as CSSProperties}
      >
        {url.replace(/^https?:\/\//, '') || ' '}
      </p>

      <dialog
        ref={sheet}
        className="sheet"
        aria-labelledby="reminder-title"
        onClick={(event) => event.target === sheet.current && closeCalendar()}
      >
        <div className="p-2">
          <div className="flex items-start gap-3 px-3 pt-3 pb-4 text-left">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-lavender/12 text-lavender">
              <Calendar size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p id="reminder-title" className="font-medium text-ink">
                Add a reminder
              </p>
              <p className="mt-0.5 text-sm text-ink-3">Tomorrow at {time} · 15 minutes</p>
            </div>
            <button
              type="button"
              onClick={closeCalendar}
              className="-mt-1 -mr-1 grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-white/[0.06] hover:text-ink"
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </div>
          <ul className="space-y-1">
            {options.map((option) => (
              <li key={option.label}>
                <a
                  href={option.href}
                  target={option.external ? '_blank' : undefined}
                  rel={option.external ? 'noreferrer' : undefined}
                  onClick={() => window.setTimeout(closeCalendar, 300)}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.035] px-4 py-3.5 text-left transition-colors active:bg-white/[0.07]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.95rem] text-ink">{option.label}</span>
                    <span className="block text-[0.8rem] text-ink-3">{option.detail}</span>
                  </span>
                  <ChevronRight size={16} className="text-ink-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </div>
  )
}

/** A laptop showing the unified inbox, so the message reads at a glance. */
function LaptopVisual() {
  const rows = [
    { account: 0, width: 72, unread: true },
    { account: 1, width: 58, unread: true, focused: true },
    { account: 2, width: 80 },
    { account: 3, width: 48 },
    { account: 1, width: 66 },
  ]
  return (
    <div className="laptop rise relative w-[min(19rem,82vw)]" aria-hidden="true">
      <div className="laptop-glow" />
      <div className="laptop-lid">
        <div
          className="app flex h-full overflow-hidden rounded-[7px] bg-(--sidebar)"
          data-theme="dark"
        >
          <div className="flex w-[26%] flex-col gap-1.5 px-2 pt-3">
            <span className="mb-1 flex items-center gap-1.5 px-1">
              <AppTile size={11} className="!shadow-none" />
              <span className="h-1 w-7 rounded-full bg-white/25" />
            </span>
            {accounts.map((a, i) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-[3px] px-1 py-[3px]"
                style={i === 0 ? { background: 'var(--selected)' } : undefined}
              >
                <span
                  className="account-mark"
                  style={{ '--a': a.mark[0], '--b': a.mark[1], '--size': '6px' } as CSSProperties}
                />
                <span className="h-[3px] flex-1 rounded-full bg-white/15" />
              </span>
            ))}
          </div>
          <div className="my-1.5 mr-1.5 flex-1 overflow-hidden rounded-[5px] border border-(--border) bg-(--bg)">
            <div className="h-5 border-b border-(--border)" />
            {rows.map((row, i) => {
              const a = accounts[row.account]
              return (
                <div
                  key={i}
                  className="laptop-row flex h-[21px] items-center gap-1.5 border-b border-(--border) px-2"
                  style={
                    {
                      '--i': i,
                      background: row.focused ? 'var(--selected)' : undefined,
                      boxShadow: row.focused ? 'inset 1.5px 0 var(--accent)' : undefined,
                    } as CSSProperties
                  }
                >
                  <span
                    className="size-[3px] rounded-full"
                    style={{ background: row.unread ? 'var(--accent)' : 'transparent' }}
                  />
                  <span
                    className="account-mark"
                    style={{ '--a': a.mark[0], '--b': a.mark[1], '--size': '7px' } as CSSProperties}
                  />
                  <span
                    className="h-[3px] w-[22%] rounded-full"
                    style={{
                      background: row.unread ? 'rgb(255 255 255 / .55)' : 'rgb(255 255 255 / .25)',
                    }}
                  />
                  <span
                    className="h-[3px] rounded-full bg-white/12"
                    style={{ width: row.width * 0.6 + '%' }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="laptop-base" />
    </div>
  )
}
