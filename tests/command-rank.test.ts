import { describe, expect, it, vi } from 'vitest'

describe('command menu ranking', async () => {
  vi.stubGlobal('location', { search: '', protocol: 'file:' })
  vi.stubGlobal('window', {})
  const { rank } = await import('../apps/desktop/src/renderer/src/CommandPalette')
  vi.unstubAllGlobals()
  const command = (label: string, keywords?: string) => ({ label, keywords })

  it('matches word starts in the label and keywords', () => {
    expect(rank(command('Dark theme', 'appearance'), 'dark')).toBeGreaterThan(0)
    expect(rank(command('Dark theme', 'appearance'), 'appear')).toBeGreaterThan(0)
    expect(rank(command('Move to trash'), 'tra')).toBeGreaterThan(0)
  })

  it('prefers label matches that start earlier', () => {
    expect(rank(command('Archive'), 'arc')).toBeGreaterThan(rank(command('Go to archive'), 'arc'))
    expect(rank(command('Inbox'), 'in')).toBeGreaterThan(rank(command('Other', 'inbox'), 'in'))
  })

  it('does not match scattered letters, so typed searches fall through to mail search', () => {
    expect(rank(command('Mark as read'), 'mr')).toBe(0)
    expect(rank(command('Compose a message'), 'invoice')).toBe(0)
    expect(rank(command('Archive'), 'archive september')).toBe(0)
  })
})
