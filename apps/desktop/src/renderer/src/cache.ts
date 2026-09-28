import { openDB } from 'idb'
import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query'
import type { Draft } from '@inlark/core'
import { isDemo } from './api'

const database = openDB(
  'inlark-' +
    (isDemo
      ? new URLSearchParams(location.search).has('stress')
        ? 'demo-stress'
        : 'demo'
      : 'mail'),
  1,
  {
    upgrade(db) {
      db.createObjectStore('cache')
      db.createObjectStore('drafts', { keyPath: 'id' })
    },
  },
)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: 1,
      networkMode: 'always',
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: 'always', retry: false },
  },
})
let suspended = 0,
  timer: ReturnType<typeof setTimeout> | undefined
export function suspendPersistence() {
  suspended++
  if (timer) clearTimeout(timer)
}
export function resumePersistence() {
  suspended = Math.max(0, suspended - 1)
}
export async function restoreCache() {
  try {
    const value = await (await database).get('cache', 'queries-v1')
    if (value && Date.now() - value.at < 7 * 86400_000) hydrate(queryClient, value.state)
  } catch {
    /* A cache failure must not prevent the mail client starting. */
  }
  queryClient.getQueryCache().subscribe((event) => {
    if (
      suspended ||
      event.type !== 'updated' ||
      event.action.type !== 'success' ||
      event.action.manual
    )
      return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (suspended) return
      const state = dehydrate(queryClient, {
        shouldDehydrateMutation: () => false,
        shouldDehydrateQuery: (q) =>
          ['mail', 'thread', 'mailboxes', 'identities'].includes(String(q.queryKey[0])) &&
          q.state.status === 'success',
      })
      // Keep recent windows, not an ever-growing mailbox snapshot.
      state.queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      state.queries = state.queries.slice(0, 80)
      for (const q of state.queries) {
        const data = q.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined
        if (data?.pages && data.pageParams)
          q.state = {
            ...q.state,
            data: {
              ...data,
              pages: data.pages.slice(0, 3),
              pageParams: data.pageParams.slice(0, 3),
            },
          }
      }
      while (JSON.stringify(state).length > 25_000_000 && state.queries.length) state.queries.pop()
      void database
        .then((db) => db.put('cache', { at: Date.now(), state }, 'queries-v1'))
        .catch(() => {})
    }, 500)
  })
}
export async function localSaveDraft(draft: Draft) {
  await (await database).put('drafts', draft)
}
export async function localDrafts(): Promise<Draft[]> {
  return (await database).getAll('drafts')
}
export async function localDeleteDraft(id: string) {
  await (await database).delete('drafts', id)
}
export async function purgeAccountCache(ids: string[]) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'bootstrap' })
  const db = await database
  await db.clear('cache')
  for (const draft of await db.getAll('drafts'))
    if (ids.includes(draft.accountId)) await db.delete('drafts', draft.id)
}
