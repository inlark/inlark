import { resolveSrv } from 'node:dns/promises'
import { discoverAccount, type DiscoveryTransport } from '@inlark/core'

const missing = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME'])

/** Anonymous, bounded requests for account discovery: no cookies, credentials, or redirects. */
export const nodeDiscoveryTransport: DiscoveryTransport = {
  async resolveSrv(name) {
    try {
      return await resolveSrv(name)
    } catch (error) {
      if (missing.has((error as NodeJS.ErrnoException).code || '')) return []
      throw error
    }
  },
  async get(value, { timeoutMs, maxBytes }) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Discovery only uses HTTPS.')
    const response = await fetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const headers = Object.fromEntries(
      [...response.headers].map(([key, header]) => [key.toLowerCase(), header]),
    )
    if (Number(headers['content-length']) > maxBytes) {
      await response.body?.cancel()
      throw new Error('Discovery response is too large.')
    }
    const decoder = new TextDecoder()
    let body = ''
    let size = 0
    const reader = response.body?.getReader()
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('Discovery response is too large.')
      }
      body += decoder.decode(value, { stream: true })
    }
    return { status: response.status, headers, body: body + decoder.decode() }
  },
}
export const discover = (email: string) => discoverAccount(email, nodeDiscoveryTransport)
