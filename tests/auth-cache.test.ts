import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../apps/desktop/node_modules/idb', () => ({ openDB: async () => ({}) }))
vi.mock('../apps/desktop/src/renderer/src/api', () => ({ isDemo: true, api: {} }))
afterEach(() => vi.unstubAllGlobals())

it('excludes derived authentication values from persisted messages, including encrypted mail', async () => {
  vi.stubGlobal('location', { search: '' })
  const { redactEncrypted } = await import('../apps/desktop/src/renderer/src/cache')
  const value = { type: 'code', value: '012345' }
  const input = {
    pages: [
      {
        items: [
          {
            messages: [
              { id: 'plain', text: 'Original message', authCandidate: value },
              {
                id: 'encrypted',
                text: 'Decrypted message',
                html: '<p>Secret</p>',
                authCandidate: value,
                security: { encrypted: true, state: 'decrypted' },
              },
            ],
          },
        ],
      },
    ],
  }
  const output = redactEncrypted(input)
  expect(output.pages[0].items[0].messages).toEqual([
    { id: 'plain', text: 'Original message' },
    {
      id: 'encrypted',
      text: undefined,
      html: undefined,
      preview: '',
      attachments: [],
      security: { encrypted: true, state: 'locked' },
    },
  ])
  expect(JSON.stringify(output)).not.toContain('012345')
  expect(input.pages[0].items[0].messages[0].authCandidate).toEqual(value)
})
