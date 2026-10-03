import type { Config } from 'dompurify'

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
