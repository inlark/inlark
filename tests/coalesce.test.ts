import { describe, expect, it } from 'vitest'
import { coalesce } from '../apps/desktop/src/renderer/src/coalesce'

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe('coalesced reloads', () => {
  it('shares one run among a burst of requests', async () => {
    let runs = 0
    const reload = coalesce(async () => {
      runs++
    }, 10)
    await Promise.all([reload(), reload(), reload()])
    expect(runs).toBe(1)
  })
  it('follows requests made during a run with exactly one more run', async () => {
    const started: number[] = []
    let finish!: () => void
    const reload = coalesce(async () => {
      started.push(Date.now())
      if (started.length === 1) await new Promise<void>((resolve) => (finish = resolve))
    })
    const first = reload()
    await tick(5)
    expect(started).toHaveLength(1)
    const later = [reload(), reload(), reload()]
    await tick(5)
    // Requests made while a run is in progress wait for it rather than starting another.
    expect(started).toHaveLength(1)
    finish()
    await Promise.all([first, ...later])
    expect(started).toHaveLength(2)
  })
  it('still runs after a failed run', async () => {
    let runs = 0
    const reload = coalesce(async () => {
      runs++
      if (runs === 1) throw new Error('offline')
    })
    await expect(reload()).rejects.toThrow('offline')
    await reload()
    expect(runs).toBe(2)
  })
})
