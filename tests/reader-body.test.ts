import { createElement } from '../apps/desktop/node_modules/react'
import { renderToStaticMarkup } from '../apps/desktop/node_modules/react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../packages/core/src'

describe('email body fallback', () => {
  it('shows plain text outside the HTML frame until the frame has readable content', async () => {
    vi.stubGlobal('location', { search: '', protocol: 'file:' })
    vi.stubGlobal('window', {})
    try {
      const { EmailBody } = await import('../apps/desktop/src/renderer/src/Reader')
      const message = {
        id: 'message',
        accountId: 'account',
        from: [],
        text: 'The message body remains readable.',
      } as Message
      const markup = renderToStaticMarkup(
        createElement(EmailBody, { message, remoteImages: false }),
      )
      expect(markup).toContain('class="email-fallback"')
      expect(markup).toContain('The message body remains readable.')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
