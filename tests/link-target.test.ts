import { describe, expect, it } from 'vitest'
import { linkTarget } from '../apps/desktop/src/renderer/src/link-target'

describe('composer link addresses', () => {
  it('keeps full web and email links', () => {
    expect(linkTarget('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(linkTarget('http://localhost:3000')).toBe('http://localhost:3000')
    expect(linkTarget('mailto:jane@example.com?subject=Hi')).toBe(
      'mailto:jane@example.com?subject=Hi',
    )
  })

  it('completes bare domains and email addresses', () => {
    expect(linkTarget('  example.com ')).toBe('https://example.com')
    expect(linkTarget('docs.example.com/guide#setup')).toBe('https://docs.example.com/guide#setup')
    expect(linkTarget('jane@example.com')).toBe('mailto:jane@example.com')
  })

  it('refuses text that cannot be a link', () => {
    for (const text of [
      '',
      'not a link',
      'example',
      'javascript:alert(1)',
      'mailto:nobody',
      'https://',
    ])
      expect(linkTarget(text)).toBeUndefined()
  })
})
