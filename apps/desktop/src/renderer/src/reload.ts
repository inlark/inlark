import type { QueryClient } from '@tanstack/react-query'
import { coalesce } from './coalesce'

const reloaded = ['mail', 'mailboxes', 'drafts', 'submissions']

/**
 * Reloads what the window shows from the server. A burst of requests, like the change events of
 * one action, shares a single reload.
 */
export function reloader(client: QueryClient): () => Promise<void> {
  return coalesce(async () => {
    // A load already under way may have been answered before this change. A conversation is shown
    // when it arrives rather than discarded, and a first load can't be restarted, only joined;
    // either is loaded once more afterwards.
    const loading = client.getQueryCache().findAll({
      fetchStatus: 'fetching',
      predicate: (query) =>
        query.queryKey[0] === 'thread' ||
        (reloaded.includes(String(query.queryKey[0])) && query.state.data === undefined),
    })
    await Promise.all([
      ...reloaded.map((key) => client.invalidateQueries({ queryKey: [key] })),
      client.invalidateQueries({ queryKey: ['thread'] }, { cancelRefetch: false }),
    ])
    await Promise.all(
      loading.map(async (query) => {
        await query.promise?.catch(() => {})
        await client.invalidateQueries({ queryKey: query.queryKey, exact: true })
      }),
    )
  }, 50)
}
