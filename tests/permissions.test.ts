import { describe, expect, it } from 'vitest'
import { allowPermission, appOrigin } from '../apps/desktop/src/main/permissions'

const app = { requestingUrl: 'inlark://mail/index.html', isMainFrame: true }
const dev = 'http://127.0.0.1:5173'

describe('window permissions', () => {
  it('lets the app page write copied text to the clipboard', () => {
    expect(allowPermission('clipboard-sanitized-write', app)).toBe(true)
    expect(
      allowPermission(
        'clipboard-sanitized-write',
        { requestingUrl: 'inlark://mail/index.html?demo=1#/inbox', isMainFrame: true },
        undefined,
      ),
    ).toBe(true)
  })

  it('allows the Vite page in development, and only that page', () => {
    const page = { requestingUrl: dev + '/?demo=1', isMainFrame: true }
    expect(allowPermission('clipboard-sanitized-write', page, dev)).toBe(true)
    expect(allowPermission('clipboard-sanitized-write', app, dev)).toBe(false)
    expect(allowPermission('clipboard-sanitized-write', page)).toBe(false)
    expect(
      allowPermission(
        'clipboard-sanitized-write',
        { requestingUrl: 'http://127.0.0.1:5174/', isMainFrame: true },
        dev,
      ),
    ).toBe(false)
  })

  it('keeps every other permission denied', () => {
    for (const permission of [
      'clipboard-read',
      'deprecated-sync-clipboard-read',
      'notifications',
      'media',
      'geolocation',
      'openExternal',
      'fullscreen',
      'unknown',
    ])
      expect(allowPermission(permission, app)).toBe(false)
  })

  it('denies frames inside the page, such as email bodies', () => {
    expect(allowPermission('clipboard-sanitized-write', { ...app, isMainFrame: false })).toBe(false)
    expect(
      allowPermission('clipboard-sanitized-write', {
        requestingUrl: 'about:srcdoc',
        isMainFrame: false,
      }),
    ).toBe(false)
  })

  it('denies other pages and unknown requesters', () => {
    for (const requestingUrl of [
      'https://example.com/',
      'inlark://mail.example.com/',
      'inlark://other/index.html',
      'file:///home/user/index.html',
      'about:blank',
      'not a url',
      '',
      undefined,
    ])
      expect(
        allowPermission('clipboard-sanitized-write', { requestingUrl, isMainFrame: true }),
      ).toBe(false)
  })

  it('denies everything when the dev address is invalid', () => {
    expect(allowPermission('clipboard-sanitized-write', app, 'not a url')).toBe(false)
  })

  it('names the app origin the window trusts', () => {
    expect(appOrigin()).toBe('inlark://mail')
    expect(appOrigin(dev + '/index.html')).toBe(dev)
  })
})
