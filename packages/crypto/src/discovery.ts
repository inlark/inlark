import { createHash, randomInt } from 'node:crypto'
import { domainToASCII } from 'node:url'
export const canonicalEmail = (email: string) =>
  email.trim().replace(/[A-Z]/g, (c) => c.toLowerCase())
export function wkdUrls(email: string) {
  const at = email.lastIndexOf('@'),
    local = email.slice(0, at),
    domain = domainToASCII(email.slice(at + 1)).toLowerCase()
  if (at < 1 || !/^(?!-)[a-z0-9-]+(?:\.(?!-)[a-z0-9-]+)+$/.test(domain) || /[\s\r\n]/.test(local))
    throw new Error('Enter a valid email address for key discovery.')
  const digest = createHash('sha1').update(canonicalEmail(local), 'utf8').digest(),
    alphabet = 'ybndrfg8ejkmcpqxot1uwisza345h769'
  let hash = '',
    value = 0,
    bits = 0
  for (const byte of digest) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      hash += alphabet[(value >>> bits) & 31]
    }
  }
  const tail = hash + '?l=' + encodeURIComponent(local)
  return {
    advanced: `https://openpgpkey.${domain}/.well-known/openpgpkey/${domain}/hu/${tail}`,
    direct: `https://${domain}/.well-known/openpgpkey/hu/${tail}`,
    host: 'openpgpkey.' + domain,
  }
}
export interface AutocryptHeader {
  email: string
  mutual: boolean
  data: Uint8Array
}
export function parseAutocrypt(value: string, sender?: string): AutocryptHeader | undefined {
  if (value.length + 12 > 10240 || /\r(?!\n)|\n(?![ \t])/.test(value)) return
  const fields = new Map<string, string>(),
    entries = value
      .replace(/\r?\n[ \t]+/g, ' ')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i],
      equal = entry.indexOf('=')
    if (equal < 1) return
    const name = entry.slice(0, equal).trim().toLowerCase(),
      data = entry.slice(equal + 1).trim()
    if (
      fields.has(name) ||
      (!['addr', 'prefer-encrypt', 'keydata'].includes(name) && !name.startsWith('_')) ||
      (name === 'keydata' && i !== entries.length - 1)
    )
      return
    fields.set(name, data)
  }
  const email = canonicalEmail(fields.get('addr') || ''),
    encoded = (fields.get('keydata') || '').replace(/\s/g, '')
  if (
    !/^[^\s<>@]+@[^\s<>@]+$/.test(email) ||
    (sender && email !== canonicalEmail(sender)) ||
    !encoded ||
    !/^[a-z\d+/]+={0,2}$/i.test(encoded)
  )
    return
  const data = Buffer.from(encoded, 'base64')
  if (data.toString('base64') !== encoded) return
  return { email, mutual: fields.get('prefer-encrypt') === 'mutual', data }
}
export function autocryptHeader(
  email: string,
  binary: Uint8Array,
  mutual: boolean,
  gossip = false,
): string {
  if (!/^[^\s<>;@]+@[^\s<>;@]+$/.test(email)) throw new Error('Invalid Autocrypt address.')
  const value = `${gossip ? 'Autocrypt-Gossip' : 'Autocrypt'}: addr=${email}; ${mutual && !gossip ? 'prefer-encrypt=mutual; ' : ''}keydata=${Buffer.from(binary).toString('base64')}`
  if (value.length > 9000) throw new Error('This key is too large to advertise through Autocrypt.')
  // Header lines below RFC 5322's hard limit, folding only inside base64 keydata.
  const split = value.indexOf('keydata=') + 8
  return value.slice(0, split) + (value.slice(split).match(/.{1,72}/g) || []).join('\r\n ')
}
export interface PeerState {
  lastSeen?: string
  autocryptAt?: string
  gossipAt?: string
  fingerprint?: string
  gossipFingerprint?: string
  mutual?: boolean
}
export function peerUpdate(
  old: PeerState,
  receivedAt: string,
  sentAt: string | undefined,
  valid?: { fingerprint: string; mutual: boolean },
): PeerState {
  const received = Date.parse(receivedAt),
    sent = Date.parse(sentAt || ''),
    date = new Date(Number.isFinite(sent) ? Math.min(sent, received) : received).toISOString()
  if (old.autocryptAt && date < old.autocryptAt) return old
  return {
    ...old,
    lastSeen: old.lastSeen && old.lastSeen > date ? old.lastSeen : date,
    ...(valid && (!old.autocryptAt || date > old.autocryptAt)
      ? { autocryptAt: date, fingerprint: valid.fingerprint, mutual: valid.mutual }
      : {}),
  }
}
export function peerPrefersEncryption(peer?: PeerState) {
  return !!(
    peer?.mutual &&
    peer.autocryptAt &&
    peer.lastSeen &&
    Date.parse(peer.lastSeen) - Date.parse(peer.autocryptAt) <= 35 * 86400_000
  )
}
export const setupCode = () =>
  Array.from({ length: 9 }, () => String(randomInt(10000)).padStart(4, '0')).join('-')
