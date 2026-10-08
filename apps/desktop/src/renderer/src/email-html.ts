import type { Config } from 'dompurify'
import { plainTextHtml, type Message } from '@inlark/core'

/** Older cached JMAP messages may store the same plain-text part in both fields. */
export function emailBodyHtml(message: Pick<Message, 'html' | 'text' | 'preview'>): string {
  const html = message.html?.trim()
  if (html && html !== message.text?.trim()) return message.html!
  return plainTextHtml(
    (message.text?.trim() ? message.text : message.preview) ||
      'No readable message body is available.',
  )
}

/** HTML from mail or a signature keeps its layout, but nothing that runs, submits or restyles the app. */
export const emailSanitizeOptions: Config = {
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'frame',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'meta',
    'base',
    'link',
    'svg',
    'math',
    'video',
    'audio',
    'source',
  ],
  FORBID_ATTR: ['srcset', 'action', 'formaction', 'ping', 'autofocus', 'contenteditable'],
}
