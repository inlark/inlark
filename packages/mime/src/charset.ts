/**
 * Text in the charset its bytes are really in. Mail that declares a legacy charset reads as
 * declared, but mail from older software often declares none, or claims UTF-8 or ASCII for
 * Latin-1 bytes. Every accented letter of such text is invalid UTF-8, so reading it as UTF-8
 * leaves a replacement character in place of each one. Browsers and other mail clients read
 * this mail as written, and inlark should too.
 */

export interface TextOptions {
  /** The charset the part declares, if any. */
  charset?: string
  /** Whether the part is HTML, which may declare its charset in a meta tag. */
  html?: boolean
  /** Whether the bytes are only the start of the part, possibly cut inside a character. */
  partial?: boolean
}

/** Labels mailparser and ImapFlow treat as needing no conversion, so they read the bytes as UTF-8. */
const utf8Labels = new Set(['', 'ascii', 'usascii', 'utf8'])
const claimsUtf8 = (charset = '') => utf8Labels.has(charset.toLowerCase().replace(/[^a-z0-9]/g, ''))

/** The WHATWG name for a charset label, or undefined if this runtime can't decode it. */
function encodingFor(label: string): string | undefined {
  try {
    const { encoding } = new TextDecoder(label.trim())
    return encoding === 'replacement' ? undefined : encoding
  } catch {
    return undefined
  }
}

function byteOrderMark(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return undefined
}

/**
 * Whether bytes read as UTF-8: they are valid, or their invalid sequences are fewer than their
 * valid multi-byte ones. A UTF-8 message with a stray byte keeps its text, while Latin-1 text,
 * where an accented letter followed by punctuation can form a valid sequence by chance, does not
 * turn into UTF-8 because of one. A sequence cut off by the end of a partial download is ignored.
 */
function readsAsUtf8(bytes: Uint8Array, partial: boolean): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: partial })
    return true
  } catch {
    // Count below.
  }
  let valid = 0
  let invalid = 0
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i]
    if (lead < 0x80) {
      i++
      continue
    }
    const length =
      lead >= 0xc2 && lead <= 0xdf
        ? 2
        : lead >= 0xe0 && lead <= 0xef
          ? 3
          : lead >= 0xf0 && lead <= 0xf4
            ? 4
            : 1
    // The second byte's range excludes overlong forms, surrogates and code points past U+10FFFF.
    const low = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80
    const high = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf
    let read = 1
    while (read < length && i + read < bytes.length) {
      const next = bytes[i + read]
      if (next < (read === 1 ? low : 0x80) || next > (read === 1 ? high : 0xbf)) break
      read++
    }
    if (read === length && length > 1) valid++
    else if (partial && length > 1 && i + read === bytes.length) break
    else invalid++
    i += read
  }
  return invalid <= valid
}

/** The charset an HTML document declares in a meta tag before its body, as a browser finds it. */
function metaEncoding(bytes: Uint8Array): string | undefined {
  const start = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 8192))
  const text = start.toString('latin1')
  const body = text.search(/<body[\s>]/i)
  const match = /<meta\b[^<>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(
    body < 0 ? text : text.slice(0, body),
  )
  const encoding = match ? encodingFor(match[1]) : undefined
  // Browsers ignore a UTF-16 declaration in a document that was readable enough to declare it.
  return encoding?.startsWith('utf-') ? undefined : encoding
}

/**
 * The encoding to read a text part with: its byte order mark, then a declared legacy charset,
 * then UTF-8 if the bytes read as UTF-8, then an HTML meta declaration, then Windows-1252, which
 * is what a declared ISO-8859-1 means in practice and what browsers assume in Western Europe.
 */
export function textEncoding(bytes: Uint8Array, options: TextOptions = {}): string {
  const bom = byteOrderMark(bytes)
  if (bom) return bom
  const declared = claimsUtf8(options.charset) ? undefined : encodingFor(options.charset!)
  if (declared) return declared
  if (readsAsUtf8(bytes, !!options.partial)) return 'utf-8'
  return (options.html && metaEncoding(bytes)) || 'windows-1252'
}

/** Decodes a text part's bytes, after their transfer encoding is undone. */
export function decodeText(bytes: Uint8Array, options: TextOptions = {}): string {
  // Streaming leaves out a character cut off by the end of a partial download.
  return new TextDecoder(textEncoding(bytes, options)).decode(bytes, {
    stream: !!options.partial,
  })
}

interface Field {
  name: string
  /** Unfolded, after the colon. */
  value: string
  start: number
  /** Where the value starts in the source, after the colon. */
  valueStart: number
  /** Where the field's last line ends, before its line break. */
  end: number
}
interface Parameter {
  /** Lowercase. */
  name: string
  /** Unquoted. */
  value: string
  /** Where the value, quotes included, starts and ends in the header value. */
  start: number
  end: number
}
interface Edit {
  at: number
  remove: number
  insert: string
}

/**
 * A structured header value split at the semicolons outside quoted strings: its lowercase value
 * and its parameters. `unterminated` says a quoted string ran to the end.
 */
function structured(header = '') {
  // Each segment with the position of its first equals sign, found in the same single pass.
  const segments: [start: number, end: number, equals: number][] = []
  let segmentStart = 0
  let equals = -1
  let quoted = false
  for (let i = 0; i < header.length; i++) {
    const c = header[i]
    if (quoted && c === '\\') i++
    else if (c === '"') quoted = !quoted
    else if (c === '=' && !quoted && equals < 0) equals = i
    else if (c === ';' && !quoted) {
      segments.push([segmentStart, i, equals])
      segmentStart = i + 1
      equals = -1
    }
  }
  segments.push([segmentStart, header.length, equals])
  const params: Parameter[] = []
  for (const [start, end, equals] of segments.slice(1)) {
    if (equals < 0) continue
    let valueStart = equals + 1
    let valueEnd = end
    while (valueStart < valueEnd && /\s/.test(header[valueStart])) valueStart++
    while (valueEnd > valueStart && /\s/.test(header[valueEnd - 1])) valueEnd--
    const raw = header.slice(valueStart, valueEnd)
    params.push({
      name: header.slice(start, equals).trim().toLowerCase(),
      value: raw.startsWith('"') ? raw.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1') : raw,
      start: valueStart,
      end: valueEnd,
    })
  }
  const [first] = segments
  return {
    value: header.slice(first[0], first[1]).trim().toLowerCase(),
    params,
    unterminated: quoted,
  }
}
/** A parameter by lowercase name; the last one counts, as for mailparser. */
function parameter(params: Parameter[], name: string): Parameter | undefined {
  let found: Parameter | undefined
  for (const param of params) if (param.name === name) found = param
  return found
}

function headerFields(text: string, start: number, end: number): Field[] {
  const fields: Field[] = []
  for (let position = start; position < end;) {
    let next = text.indexOf('\n', position)
    if (next < 0 || next >= end) next = end
    const lineEnd = next > position && text[next - 1] === '\r' ? next - 1 : next
    const line = text.slice(position, lineEnd)
    const last = fields[fields.length - 1]
    if (/^[ \t]/.test(line) && last) {
      last.value += line
      last.end = lineEnd
    } else {
      const colon = line.indexOf(':')
      if (colon > 0)
        fields.push({
          name: line.slice(0, colon).trim().toLowerCase(),
          value: line.slice(colon + 1),
          start: position,
          valueStart: position + colon + 1,
          end: lineEnd,
        })
    }
    position = next + 1
  }
  return fields
}

/** Where an entity's header ends and its body begins, at the first empty line as mailparser finds it. */
function headerEnd(text: string, start: number, end: number): [number, number] {
  for (let line = start; line < end;) {
    if (text.startsWith('\r\n', line)) return [line, Math.min(line + 2, end)]
    if (text[line] === '\n') return [line, line + 1]
    const next = text.indexOf('\n', line)
    if (next < 0 || next >= end) break
    line = next + 1
  }
  return [end, end]
}

/**
 * The ranges of a multipart body's parts, each without the line break before its delimiter. A
 * delimiter line is the boundary at the start of a line, followed by its line break or by the two
 * dashes that close the multipart. One pass, however often the boundary appears elsewhere.
 */
function multipartChildren(text: string, start: number, end: number, boundary: string) {
  const delimiter = '--' + boundary
  /** Where the next line starts if a line ends at `i`, else -1. */
  const nextLine = (i: number) =>
    i >= end
      ? end
      : text[i] === '\n'
        ? i + 1
        : text[i] === '\r' && (i + 1 >= end || text[i + 1] === '\n')
          ? Math.min(i + 2, end)
          : -1
  const parts: [number, number][] = []
  let partStart = -1
  for (
    let at = text.indexOf(delimiter, start);
    at >= 0 && at + delimiter.length <= end;
    // A line break can't be inside a delimiter, so the next one can't overlap this one.
    at = text.indexOf(delimiter, at + delimiter.length)
  ) {
    if (at !== start && text[at - 1] !== '\n') continue
    const after = at + delimiter.length
    let next = nextLine(after)
    const closing = next < 0 && text.startsWith('--', after) && (next = nextLine(after + 2)) >= 0
    if (next < 0) continue
    if (partStart >= 0)
      parts.push([partStart, Math.max(partStart, text[at - 2] === '\r' ? at - 2 : at - 1)])
    if (closing) return parts
    partStart = next
  }
  if (partStart >= 0) parts.push([partStart, end])
  return parts
}

/**
 * The value without what mailsplit's `/\(.*\)/g` removes from it, from the first `(` to the last
 * `)` after it, found without that regex's retry from every unmatched `(`.
 */
function withoutComment(value: string): string {
  const open = value.indexOf('(')
  const close = value.lastIndexOf(')')
  return open >= 0 && close > open ? value.slice(0, open) + value.slice(close + 1) : value
}

function transferDecoded(body: string, encoding: string): Uint8Array {
  if (encoding === 'base64') return Buffer.from(body, 'base64')
  if (encoding === 'quoted-printable')
    body = body.replace(/=(?:[ \t]*\r?\n|([0-9a-fA-F]{2}))/g, (_, hex?: string) =>
      hex ? String.fromCharCode(parseInt(hex, 16)) : '',
    )
  return Buffer.from(body, 'latin1')
}

/** Collects a charset edit for each inline text part, mirroring how mailparser walks the message. */
function visit(text: string, start: number, end: number, edits: Edit[], depth: number) {
  if (depth > 50) return
  const [headEnd, bodyStart] = headerEnd(text, start, end)
  const fields = headerFields(text, start, headEnd)
  const field = (name: string) => fields.find((f) => f.name === name)
  const typeField = field('content-type')
  const contentType = structured(typeField?.value)
  const disposition = structured(field('content-disposition')?.value)
  const encoding = withoutComment(field('content-transfer-encoding')?.value || '')
    .trim()
    .toLowerCase()
  const type =
    contentType.value ||
    (disposition.value === 'attachment' || parameter(disposition.params, 'filename')
      ? ''
      : 'text/plain')

  if (type.startsWith('multipart/')) {
    const boundary = parameter(contentType.params, 'boundary')?.value
    if (boundary)
      for (const [childStart, childEnd] of multipartChildren(text, bodyStart, end, boundary))
        visit(text, childStart, childEnd, edits, depth + 1)
    return
  }
  // Like mailparser, read into a forwarded message only when it is shown inline.
  if (type === 'message/rfc822') {
    if (disposition.value === 'inline' && ['', '7bit', '8bit', 'binary'].includes(encoding))
      visit(text, bodyStart, end, edits, depth + 1)
    return
  }
  if (type !== 'text/plain' && type !== 'text/html') return
  if (disposition.value && disposition.value !== 'inline') return
  if (contentType.params.some((param) => param.name.startsWith('charset*'))) return
  const declared = parameter(contentType.params, 'charset')?.value
  if (!claimsUtf8(declared)) return

  const bytes = transferDecoded(text.slice(bodyStart, end), encoding)
  const charset = textEncoding(bytes, { charset: declared, html: type === 'text/html' })
  if (charset === 'utf-8') return
  if (!typeField) {
    edits.push({
      at: start,
      remove: 0,
      insert: 'Content-Type: text/plain; charset=' + charset + '\r\n',
    })
    return
  }
  // Offsets into the field as written, folded lines included, rather than its unfolded value.
  const raw = text.slice(typeField.valueStart, typeField.end)
  const written = structured(raw)
  if (written.unterminated) return
  const existing = parameter(written.params, 'charset')
  edits.push(
    existing
      ? {
          at: typeField.valueStart + existing.start,
          remove: existing.end - existing.start,
          insert: charset,
        }
      : {
          at: typeField.end,
          remove: 0,
          insert: (/;\s*$/.test(raw) ? ' ' : '; ') + 'charset=' + charset,
        },
  )
}

/**
 * The message with the charset its inline text parts are really in written into their
 * Content-Type, for each part mailparser would otherwise read as UTF-8 although it isn't.
 * Undefined when every part is fine as it is. Attachments and every other byte stay unchanged.
 */
export function labelTextCharsets(source: Uint8Array): Buffer | undefined {
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength)
  // One character per byte, so string offsets are byte offsets.
  const text = bytes.toString('latin1')
  const edits: Edit[] = []
  visit(text, 0, text.length, edits, 0)
  if (!edits.length) return undefined
  const pieces: Buffer[] = []
  let position = 0
  for (const edit of edits.sort((a, b) => a.at - b.at)) {
    pieces.push(bytes.subarray(position, edit.at), Buffer.from(edit.insert, 'latin1'))
    position = edit.at + edit.remove
  }
  pieces.push(bytes.subarray(position))
  return Buffer.concat(pieces)
}
