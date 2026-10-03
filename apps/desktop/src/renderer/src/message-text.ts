import DOMPurify from 'dompurify'
import type { Message } from '@inlark/core'

/** The readable text of an HTML fragment, keeping its line and block breaks. */
export function htmlText(html: string): string {
  const separated = html.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)>/gi, '$&\n')
  const text = DOMPurify.sanitize(separated, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
  const decoded = document.createElement('textarea')
  decoded.innerHTML = text
  return decoded.value.trim()
}

/** Preserve an HTML-only message's complete text when quoting it in the basic editor. */
export function messageText(message: Message): string {
  if (message.text) return message.text
  if (!message.html) return message.preview
  return htmlText(message.html) || message.preview
}
