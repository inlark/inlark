import { publicFetch } from './public-fetch'
import { rasterType } from './sender-avatar'

type FetchResource = typeof publicFetch

export async function remoteImageData(
  value: string,
  fetchResource: FetchResource = publicFetch,
): Promise<string | null> {
  try {
    let url = new URL(value)
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (url.port && !['80', '443'].includes(url.port))
      )
        return null
      const response = await fetchResource(url.toString(), { userAgent: 'Mozilla/5.0' })
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
        url = new URL(response.location, url)
        continue
      }
      if (response.status !== 200) return null
      const type = rasterType(response.bytes)
      return type ? `data:${type};base64,${response.bytes.toString('base64')}` : null
    }
  } catch {
    // Broken and blocked remote resources are normal in old email.
  }
  return null
}
