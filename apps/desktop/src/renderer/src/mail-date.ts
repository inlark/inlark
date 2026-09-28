const sameYear = (d: Date) => d.getFullYear() === new Date().getFullYear()
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const currentYearFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const otherYearFormatter = new Intl.DateTimeFormat(undefined, {
  year: '2-digit',
  month: 'numeric',
  day: 'numeric',
})

export const day = (date: string) => {
  const d = new Date(date)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  today.setDate(today.getDate() - 1)
  return d.toDateString() === today.toDateString()
    ? 'Yesterday'
    : d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        ...(sameYear(d) ? {} : { year: 'numeric' }),
      })
}

export const shortDate = (date: string) => {
  const d = new Date(date)
  if (d.toDateString() === new Date().toDateString()) return timeFormatter.format(d)
  return sameYear(d) ? currentYearFormatter.format(d) : otherYearFormatter.format(d)
}

/** “Thu, Sep 25, 2026 at 10:16 AM”, as used in reply attributions and message details. */
export const longDate = (date: string) => {
  const d = new Date(date)
  return (
    d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' at ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

/** Reader timestamp: time only today, otherwise date and time. */
export const messageDate = (date: string) => {
  const d = new Date(date)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return { date: 'Today', time }
  return {
    date: d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameYear(d) ? {} : { year: 'numeric' }),
    }),
    time,
  }
}

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? bytes + ' B'
    : bytes < 1024 * 1024
      ? Math.max(1, Math.round(bytes / 1024)).toLocaleString() + ' KB'
      : (bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MB'
