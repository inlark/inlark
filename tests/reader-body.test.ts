import { createElement } from '../apps/desktop/node_modules/react'
import { renderToStaticMarkup } from '../apps/desktop/node_modules/react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Message } from '../packages/core/src'
import { emailBodyHtml } from '../apps/desktop/src/renderer/src/email-html'

describe('email body fallback', () => {
  it('repairs cached messages with the plain-text body duplicated in the HTML field', () => {
    const text = readFileSync(new URL('./fixtures/plain-email.txt', import.meta.url), 'utf8')
    const html = emailBodyHtml({ text, html: text, preview: 'Hi, I’m Bartek…' })
    expect(html).toContain('white-space:pre-wrap')
    expect(html).toContain('Hi,\n\nI&#39;m Bartek')
    expect(html).toContain('     _,\n__( `)&lt;\n\\____)')
    expect(html).toContain('<a href="https://watchgoose.com/open-source/">')
  })
  it('keeps sender HTML formatting when an actual HTML body is present', () => {
    const html = '<p>Hello <strong>there</strong>.</p><p>Another paragraph.</p>'
    expect(emailBodyHtml({ html, text: 'Hello there.\n\nAnother paragraph.', preview: '' })).toBe(
      html,
    )
  })
  it('escapes literal markup and link attributes in plain text', () => {
    const html = emailBodyHtml({
      text: 'Use <br> literally & keep "quotes".\nhttps://example.test/?a=1&b=2" title="unexpected',
      preview: '',
    })
    expect(html).toContain('Use &lt;br&gt; literally &amp; keep &quot;quotes&quot;.\n')
    expect(html).toContain(
      '<a href="https://example.test/?a=1&amp;b=2">https://example.test/?a=1&amp;b=2</a>',
    )
    expect(html).not.toContain(' title="unexpected')
    expect(html).not.toContain('<br>')
  })
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
      expect(markup).toMatch(/class="[^"]*\bemail-fallback\b[^"]*"/)
      expect(markup).toContain('The message body remains readable.')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
