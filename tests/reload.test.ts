import { describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '../apps/desktop/node_modules/@tanstack/react-query'
import { reloader } from '../apps/desktop/src/renderer/src/reload'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('window reloads', () => {
  it('loads an open conversation once more when it changed while loading', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    })
    const loads: ((value: string) => void)[] = []
    const observer = new QueryObserver(client, {
      queryKey: ['thread', 'account', 'thread'],
      queryFn: () => new Promise<string>((resolve) => loads.push(resolve)),
    })
    const unsubscribe = observer.subscribe(() => {})
    await expect.poll(() => loads.length).toBe(1)
    loads[0]('cached')
    await expect.poll(() => observer.getCurrentResult().data).toBe('cached')
    // The open conversation is loading again when a reply arrives on the server.
    void observer.refetch()
    await expect.poll(() => loads.length).toBe(2)
    const reload = reloader(client)()
    await tick(100)
    // The reload neither cancels that load nor starts a second one alongside it.
    expect(loads).toHaveLength(2)
    loads[1]('before the reply')
    await expect.poll(() => observer.getCurrentResult().data).toBe('before the reply')
    await expect.poll(() => loads.length).toBe(3)
    loads[2]('with the reply')
    await reload
    expect(observer.getCurrentResult().data).toBe('with the reply')
    unsubscribe()
  })

  it('loads a list once more when its first load set out before the change', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    })
    const loads: ((value: string) => void)[] = []
    const observer = new QueryObserver(client, {
      queryKey: ['mail', { view: 'trash' }],
      queryFn: () => new Promise<string>((resolve) => loads.push(resolve)),
    })
    // A list opened while a conversation was being deleted.
    const unsubscribe = observer.subscribe(() => {})
    await expect.poll(() => loads.length).toBe(1)
    const reload = reloader(client)()
    await tick(100)
    // A first load can only be joined, so the reload waits for it rather than replacing it.
    expect(loads).toHaveLength(1)
    loads[0]('before the deletion')
    await expect.poll(() => loads.length).toBe(2)
    loads[1]('after the deletion')
    await reload
    expect(observer.getCurrentResult().data).toBe('after the deletion')
    unsubscribe()
  })

  it('reloads a list that has loaded by replacing a load under way', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    })
    const loads: ((value: string) => void)[] = []
    const observer = new QueryObserver(client, {
      queryKey: ['mail', { view: 'inbox' }],
      queryFn: () => new Promise<string>((resolve) => loads.push(resolve)),
    })
    const unsubscribe = observer.subscribe(() => {})
    await expect.poll(() => loads.length).toBe(1)
    loads[0]('cached')
    await expect.poll(() => observer.getCurrentResult().data).toBe('cached')
    void observer.refetch()
    await expect.poll(() => loads.length).toBe(2)
    const reload = reloader(client)()
    await expect.poll(() => loads.length).toBe(3)
    loads[1]('before the deletion')
    loads[2]('after the deletion')
    await reload
    expect(observer.getCurrentResult().data).toBe('after the deletion')
    // The replaced load counts for nothing, so nothing loads a fourth time.
    await tick(100)
    expect(loads).toHaveLength(3)
    unsubscribe()
  })
})
