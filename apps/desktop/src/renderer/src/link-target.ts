/**
 * The address a typed link should point to, or nothing if it can't be a web or email link.
 * People paste `example.com` or `name@example.com` far more often than a full URL, so those
 * become `https://…` and `mailto:…` links instead of being refused.
 */
export function linkTarget(value: string): string | undefined {
  const text = value.trim()
  if (!text || /\s/.test(text)) return undefined
  const candidate = /^(https?:\/\/|mailto:)/i.test(text)
    ? text
    : /^[^@/:]+@[^@/:]+\.[^@/:]+$/.test(text)
      ? 'mailto:' + text
      : /^[^@/:]+\.[^@/:]+/.test(text)
        ? 'https://' + text
        : undefined
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol === 'mailto:')
      return /^[^@]+@[^@]+\.[^@]+$/.test(decodeURIComponent(url.pathname)) ? candidate : undefined
    return url.hostname ? candidate : undefined
  } catch {
    return undefined
  }
}
