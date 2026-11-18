import { fetchLatestRelease } from '../src/data/release'

/** Keeps GitHub's answer for a few minutes so visitors never run into its rate limit. */
let latest: { expires: number; status: number; body: string } | null = null

async function release(token?: string) {
  if (!latest || latest.expires < Date.now()) {
    try {
      const release = await fetchLatestRelease(token)
      latest = release
        ? { expires: Date.now() + 5 * 60_000, status: 200, body: JSON.stringify(release) }
        : { expires: Date.now() + 60_000, status: 404, body: '{"error":"No release yet"}' }
    } catch {
      // A stale answer beats none while GitHub is unreachable.
      if (!latest) return json('{"error":"GitHub is unavailable"}', 502, 'no-store')
      latest.expires = Date.now() + 60_000
    }
  }
  return json(latest.body, latest.status, 'public, max-age=120')
}

/**
 * Where inlark.com/support leads. The app links here rather than to the platform directly, so the
 * destination can change without an app update. One-time support there needs no account.
 */
export const supportPage = 'https://buymeacoffee.com/poeck'

/**
 * Where inlark.com/uninstall leads. The Windows uninstaller opens this page after someone removes
 * inlark, so the survey can change without waiting for a new uninstaller to reach everyone.
 */
export const uninstallSurvey = 'https://tally.so/r/8NLEEO'

// Temporary, so browsers ask again rather than remember the destination for good.
const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'public, max-age=300' },
  })

/** Passes on the version the uninstaller reports, so answers show which release they're about. */
function uninstall(url: URL) {
  const version = url.searchParams.get('version')
  const survey = new URL(uninstallSurvey)
  if (version && version.length <= 64 && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    survey.searchParams.set('version', version)
  }
  return redirect(survey.href)
}

const json = (body: string, status: number, cache: string) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  })

/** A short calendar reminder to download inlark, for visitors who found it on their phone. */
function reminder(url: URL) {
  const start = new Date(url.searchParams.get('start') ?? '')
  const soon = Date.now() - 86_400_000 < start.getTime() && start.getTime() < Date.now() + 4e10
  if (!soon) return new Response('Expected a start time in the near future', { status: 400 })

  const stamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const link = url.origin + '/download'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//inlark//Download reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${stamp(start)}-download@inlark`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime() + 15 * 60_000))}`,
    'SUMMARY:Download inlark',
    `DESCRIPTION:Install inlark on your computer: ${link}`,
    `URL:${link}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Download inlark',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="download-inlark.ics"',
      'Cache-Control': 'no-store',
    },
  })
}

/** Routes the static site can't answer. Shared by the Worker and the dev server. */
export function handle(request: Request, token?: string): Promise<Response> | Response | null {
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  if (url.pathname === '/api/release') return release(token)
  if (url.pathname === '/api/reminder.ics') return reminder(url)
  if (url.pathname === '/support' || url.pathname === '/support/') return redirect(supportPage)
  if (url.pathname === '/uninstall' || url.pathname === '/uninstall/') return uninstall(url)
  return null
}
