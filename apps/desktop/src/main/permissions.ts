/** The origin of the app's own page: the Vite dev server in development, else inlark://mail. */
export function appOrigin(devURL?: string) {
  return devURL ? new URL(devURL).origin : 'inlark://mail'
}

/**
 * Whether the app window may use a web permission. Copy buttons need to write text to the
 * clipboard, so the app's own top-level page may do that. Everything else stays denied, including
 * reading the clipboard and anything an email body asks for.
 */
export function allowPermission(
  permission: string,
  request: { requestingUrl?: string; isMainFrame: boolean },
  devURL?: string,
) {
  if (permission !== 'clipboard-sanitized-write' || !request.isMainFrame || !request.requestingUrl)
    return false
  try {
    // URL.origin is "null" for custom schemes like inlark://, so compare scheme and host.
    const url = new URL(request.requestingUrl)
    return url.protocol + '//' + url.host === appOrigin(devURL)
  } catch {
    return false
  }
}
