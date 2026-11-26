import { describe, expect, it } from 'vitest'
import { serial } from '../apps/desktop/src/renderer/src/serial'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('actions sent in order', () => {
  it('starts each task only once the one before has settled', async () => {
    const inOrder = serial()
    const events: string[] = []
    let finishFirst!: () => void
    const first = inOrder(async () => {
      events.push('star both accounts')
      await new Promise<void>((resolve) => (finishFirst = resolve))
      events.push('both starred')
    })
    // Taken while the first is still under way, on one of the same conversations.
    const second = inOrder(async () => {
      events.push('unstar one')
      return 'unstarred'
    })
    await tick(20)
    expect(events).toEqual(['star both accounts'])
    finishFirst()
    await first
    expect(await second).toBe('unstarred')
    expect(events).toEqual(['star both accounts', 'both starred', 'unstar one'])
  })

  it('carries on after a task fails, and reports the failure to its caller', async () => {
    const inOrder = serial()
    const failed = inOrder(async () => {
      throw new Error('offline')
    })
    const next = inOrder(async () => 'archived')
    await expect(failed).rejects.toThrow('offline')
    expect(await next).toBe('archived')
  })
})
