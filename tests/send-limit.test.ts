import { describe, expect, it } from 'vitest'
import { microsoftSendLimit } from '@inlark/core'
import {
  estimatedMessageBytes,
  sendLimitWarning,
} from '../apps/desktop/src/renderer/src/send-limit'

const draft = (size: number, encryption?: 'encrypt') => ({
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: size
    ? [{ id: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17', name: 'a.pdf', type: 'application/pdf', size }]
    : [],
  ...(encryption ? { encryption } : {}),
})
const limited = { limits: { send: microsoftSendLimit } }

describe('warning about a message too large for its account', () => {
  it('says nothing for accounts without a limit, whatever the size', () => {
    expect(sendLimitWarning({}, draft(50_000_000))).toBeUndefined()
    expect(sendLimitWarning(undefined, draft(50_000_000))).toBeUndefined()
    expect(sendLimitWarning({ limits: { move: 'No MOVE.' } }, draft(50_000_000))).toBeUndefined()
  })

  it('counts attachments as they travel, a third larger than the files', () => {
    expect(estimatedMessageBytes(draft(0))).toBeLessThan(3000)
    expect(estimatedMessageBytes(draft(1_000_000))).toBeGreaterThan(1_350_000)
    // Encryption wraps the encoded message once more.
    expect(estimatedMessageBytes(draft(1_000_000, 'encrypt'))).toBeGreaterThan(1_850_000)
  })

  it('warns once the finished message would exceed what the account can send', () => {
    expect(sendLimitWarning(limited, draft(2_000_000))).toBeUndefined()
    const warning = sendLimitWarning(limited, draft(2_300_000))
    expect(warning).toMatch(/about 3\.2 MB, more than the 2\.9 MB this account can send/)
    expect(warning).toContain(microsoftSendLimit.reason)
    // The same files fit unencrypted but not encrypted.
    expect(sendLimitWarning(limited, draft(1_800_000))).toBeUndefined()
    expect(sendLimitWarning(limited, draft(1_800_000, 'encrypt'))).toBeDefined()
  })
})
