import { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestPriority } from '@inlark/core'

const lane = new AsyncLocalStorage<RequestPriority>()

/** Runs `task` so the server requests it starts, now or later, queue at `priority`. */
export const withPriority = <T>(priority: RequestPriority, task: () => Promise<T>): Promise<T> =>
  lane.run(priority, task)

export const currentPriority = (): RequestPriority => lane.getStore() ?? 'normal'
