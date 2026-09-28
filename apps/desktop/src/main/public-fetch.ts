import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  // Permit global unicast IPv6 only; mapped, local, multicast, and transition ranges stay blocked.
  if (isIP(address) === 6)
    return (
      /^[23]/.test(address) &&
      !/^2001:(?:0:|db8:|10:|20:)/i.test(address) &&
      !/^2002:/i.test(address)
    )
  return false
}
/** Fetch untrusted message resources without cookies, credentials, redirects, or private-network access. */
export async function publicFetch(
  value: string,
  options: {
    method?: 'GET' | 'POST'
    body?: string
    maxBytes?: number
    timeoutMs?: number
    headersOnly?: boolean
    allowPartial?: boolean
    userAgent?: string
  } = {},
): Promise<{ status: number; type: string; bytes: Buffer; location?: string }> {
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('Unsupported public resource URL.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true })
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error('Private network resources are not loaded from email.')
  const chosen = addresses[0]
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => request.destroy(new Error('Resource request timed out.')),
      options.timeoutMs ?? 15000,
    )
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: options.method || 'GET',
        // Pin the validated address for this connection, including against DNS rebinding.
        lookup: (_hostname, lookupOptions, callback) =>
          lookupOptions.all
            ? callback(null, [{ address: chosen.address, family: chosen.family }])
            : callback(null, chosen.address, chosen.family),
        headers: {
          ...(options.body
            ? {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(options.body),
              }
            : {}),
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
        },
      },
      (response) => {
        const result = {
          status: response.statusCode || 500,
          type: String(response.headers['content-type'] || '')
            .split(';')[0]
            .trim(),
          bytes: Buffer.alloc(0),
          location:
            typeof response.headers.location === 'string' ? response.headers.location : undefined,
        }
        if (options.headersOnly) {
          clearTimeout(timer)
          resolve(result)
          response.destroy()
          return
        }
        const chunks: Buffer[] = []
        let length = 0
        response.on('data', (chunk: Buffer) => {
          const maxBytes = options.maxBytes || 10_000_000
          if (length + chunk.length > maxBytes) {
            if (!options.allowPartial) {
              request.destroy(new Error('Resource is too large.'))
              return
            }
            chunks.push(chunk.subarray(0, maxBytes - length))
            clearTimeout(timer)
            resolve({ ...result, bytes: Buffer.concat(chunks) })
            response.destroy()
            return
          }
          length += chunk.length
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          clearTimeout(timer)
          resolve({ ...result, bytes: Buffer.concat(chunks) })
        })
      },
    )
    request.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.end(options.body)
  })
}
