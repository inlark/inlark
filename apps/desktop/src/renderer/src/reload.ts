import type { QueryClient } from '@tanstack/react-query'
import { coalesce } from './coalesce'

/**
 * Reloads what the window shows from the server. A burst of requests, like the change events of
 * one action, shares a single reload.
 */
export function reloader(client: QueryClient): () => Promise<void> {
  return coalesce(async () => {
    // A conversation already loading may have been read before this change. Rather than discard
    // it, it's shown when it arrives and then loaded once more.
    const loading = client
      .getQueryCache()
      .findAll({ queryKey: ['thread'], fetchStatus: 'fetching' })
    await Promise.all([
      ...['mail', 'mailboxes', 'drafts', 'submissions'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
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
