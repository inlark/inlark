import { randomBytes } from 'node:crypto'

export const maxMessageBytes = 64 * 1024 * 1024
export interface MimeEntity {
  headers: Map<string, string[]>
  headerBytes: Buffer
  body: Buffer
}
/** Structural parsing only: signed bytes are never decoded, flattened, or reserialized. */
export function splitEntity(source: Uint8Array): MimeEntity {
  if (source.byteLength > maxMessageBytes) throw new Error('This message is too large to decrypt.')
  const raw = Buffer.from(source),
    end = raw.indexOf('\r\n\r\n')
  if (end < 0 || end > 128 * 1024) throw new Error('Invalid MIME headers.')
  const headerBytes = raw.subarray(0, end),
    headers = new Map<string, string[]>()
  for (const line of headerBytes
    .toString('latin1')
    .replace(/\r\n[ \t]+/g, ' ')
    .split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon < 1) throw new Error('Invalid MIME header.')
    const name = line.slice(0, colon).toLowerCase(),
      values = headers.get(name) || []
    values.push(line.slice(colon + 1).trim())
    headers.set(name, values)
  }
  return { headers, headerBytes, body: raw.subarray(end + 4) }
}
export function header(entity: MimeEntity, name: string) {
  const values = entity.headers.get(name.toLowerCase()) || []
  if (values.length > 1) throw new Error('Ambiguous MIME security headers.')
  return values[0] || ''
}
export function securityKind(source: Uint8Array): 'encrypted' | 'signed' | undefined {
  const entity = splitEntity(source),
    type = header(entity, 'content-type')
  if (/^multipart\/encrypted\b/i.test(type)) return 'encrypted'
  if (/^multipart\/signed\b/i.test(type)) return 'signed'
  const body = /^text\/|^$/i.test(type) ? decodedBody(source) : entity.body
  if (body.includes(Buffer.from('-----BEGIN PGP MESSAGE-----'))) return 'encrypted'
  if (body.includes(Buffer.from('-----BEGIN PGP SIGNED MESSAGE-----'))) return 'signed'
}
export function multipart(source: Uint8Array): Buffer[] {
  const entity = splitEntity(source),
    type = header(entity, 'content-type')
  const boundary = type.match(/\bboundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i)
  const name = boundary?.[1] || boundary?.[2]
  if (!name || name.length > 70) throw new Error('Invalid MIME boundary.')
  const body = entity.body.toString('latin1'),
    marker = '--' + name,
    parts: Buffer[] = []
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [
    ...body.matchAll(new RegExp('(?:^|\\r\\n)' + escaped + '(--)?[ \\t]*(?:\\r\\n|$)', 'g')),
  ]
  if (matches.length < 3 || !matches.at(-1)?.[1]) throw new Error('Incomplete MIME multipart.')
  for (let i = 0; i < matches.length - 1; i++) {
    if (matches[i][1]) throw new Error('Invalid MIME multipart.')
    // The CRLF introducing the next delimiter belongs to the boundary, not the signed part.
    const start = matches[i].index! + matches[i][0].length,
      end = matches[i + 1].index!
    parts.push(Buffer.from(body.slice(start, end), 'latin1'))
  }
  return parts
}
export function decodedBody(source: Uint8Array): Buffer {
  const entity = splitEntity(source),
    encoding = header(entity, 'content-transfer-encoding').toLowerCase()
  if (encoding === 'base64')
    return Buffer.from(entity.body.toString('ascii').replace(/\s/g, ''), 'base64')
  if (encoding === 'quoted-printable')
    return Buffer.from(
      entity.body
        .toString('latin1')
        .replace(/=\r\n/g, '')
        .replace(/=([\da-f]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16))),
      'latin1',
    )
  if (encoding && !['7bit', '8bit', 'binary'].includes(encoding))
    throw new Error('Unsupported MIME encoding.')
  return entity.body
}
export function armoredPayload(source: Uint8Array): string {
  const entity = splitEntity(source)
  if (/^multipart\/encrypted\b/i.test(header(entity, 'content-type'))) {
    if (!/\bprotocol\s*=\s*"?application\/pgp-encrypted"?/i.test(header(entity, 'content-type')))
      throw new Error('Unsupported encrypted message format.')
    const parts = multipart(source)
    if (
      parts.length !== 2 ||
      !/^application\/pgp-encrypted\b/i.test(header(splitEntity(parts[0]), 'content-type')) ||
      !/^application\/octet-stream\b/i.test(header(splitEntity(parts[1]), 'content-type')) ||
      !/^Version: 1\s*$/i.test(decodedBody(parts[0]).toString().trim())
    )
      throw new Error('Invalid PGP/MIME envelope.')
    return decodedBody(parts[1]).toString('utf8').trim()
  }
  const text = decodedBody(source).toString('utf8')
  const armor = text.match(/-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/)
  if (!armor) throw new Error('No encrypted content was found.')
  return armor[0]
}
export function mimeContent(source: Uint8Array): Buffer {
  const entity = splitEntity(source)
  const headers = entity.headerBytes
    .toString('latin1')
    .split(/\r\n(?=[^ \t])/)
    .filter((line) => /^content-/i.test(line))
  return Buffer.concat([Buffer.from(headers.join('\r\n') + '\r\n\r\n', 'latin1'), entity.body])
}
export function replaceContent(
  source: Uint8Array,
  content: Uint8Array,
  extra: string[] = [],
): Buffer {
  const entity = splitEntity(source)
  const headers = entity.headerBytes
    .toString('latin1')
    .split(/\r\n(?=[^ \t])/)
    .filter((line) => !/^(content-|mime-version:|bcc:)/i.test(line))
  return Buffer.concat([
    Buffer.from([...headers, 'MIME-Version: 1.0', ...extra].join('\r\n') + '\r\n', 'latin1'),
    Buffer.from(content),
  ])
}
const boundary = () => 'inlark-' + randomBytes(18).toString('hex')
export function encryptedMime(armor: string): Buffer {
  const b = boundary()
  return Buffer.from(
    `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: application/pgp-encrypted\r\n\r\nVersion: 1\r\n\r\n--${b}\r\nContent-Type: application/octet-stream; name="encrypted.asc"\r\nContent-Disposition: inline; filename="encrypted.asc"\r\n\r\n${armor.trim().replace(/\r?\n/g, '\r\n')}\r\n--${b}--\r\n`,
  )
}
export function signedMime(content: Uint8Array, signature: string): Buffer {
  const b = boundary()
  return Buffer.concat([
    Buffer.from(
      `Content-Type: multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha256; boundary="${b}"\r\n\r\n--${b}\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(
      `\r\n--${b}\r\nContent-Type: application/pgp-signature; name="signature.asc"\r\n\r\n${signature.trim().replace(/\r?\n/g, '\r\n')}\r\n--${b}--\r\n`,
    ),
  ])
}
