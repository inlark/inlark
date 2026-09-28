import { describe, it, expect } from 'vitest'
import { composeMime, parseMime, type ComposeInput } from '../packages/imap/src/mime'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
const binary = new Uint8Array(4096).map((_, i) => (i * 37 + 11) % 256)
const input = (overrides: Partial<ComposeInput> = {}): ComposeInput => ({
  from: { name: 'Jürgen Müller', email: 'juergen@example.test' },
  to: [{ name: 'Zoë 山田', email: 'zoe@example.test' }],
  cc: [{ name: '', email: 'cc@example.test' }],
  bcc: [{ name: 'Hidden Person', email: 'hidden@example.test' }],
  subject: 'Grüße aus Köln 🌷 — a subject long enough to need folding across several header lines',
  html: '<p>Hallo <b>Zoë</b>, ein Bild: <img src="cid:logo@inlark"></p>',
  text: 'Hallo Zoë, schöne Grüße ✨\n.leading dot line\n',
  messageId: 'abc.123@example.test',
  inReplyTo: ['parent@example.test'],
  references: ['root@example.test', 'parent@example.test'],
  date: new Date('2026-09-01T10:00:00Z'),
  attachments: [
    { name: 'logo.png', type: 'image/png', cid: 'logo@inlark', content: png },
    { name: 'Übersicht März.bin', type: 'application/octet-stream', content: binary },
  ],
  ...overrides,
})
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
const headers = (bytes: Uint8Array) => decode(bytes).split(/\r\n\r\n/)[0]

describe('MIME', () => {
  it('round trips Unicode, threading headers, inline images and binary attachments', async () => {
    const mime = await composeMime(input())
    expect(mime).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer(mime)).toBe(false)
    const head = headers(mime)
    expect(head).toMatch(/^Message-ID: <abc\.123@example\.test>$/m)
    expect(head).toMatch(/^In-Reply-To: <parent@example\.test>$/m)
    expect(head).toMatch(/^References: <root@example\.test> <parent@example\.test>$/m)
    expect(head).not.toMatch(/^(X-Mailer|User-Agent|X-Originating|Bcc):/im)
    expect(decode(mime)).toContain('multipart/related')
    expect(decode(mime)).toContain('multipart/alternative')
    // Every header line is 7-bit; Unicode is encoded.
    expect(/[^\x00-\x7f]/.test(head)).toBe(false)

    const parsed = await parseMime(mime)
    expect(parsed.subject).toBe(input().subject)
    expect(parsed.from).toEqual([{ name: 'Jürgen Müller', email: 'juergen@example.test' }])
    expect(parsed.to).toEqual([{ name: 'Zoë 山田', email: 'zoe@example.test' }])
    expect(parsed.cc).toEqual([{ name: '', email: 'cc@example.test' }])
    expect(parsed.bcc).toEqual([])
    expect(parsed.messageId).toBe('abc.123@example.test')
    expect(parsed.inReplyTo).toEqual(['parent@example.test'])
    expect(parsed.references).toEqual(['root@example.test', 'parent@example.test'])
    expect(parsed.date).toBe('2026-09-01T10:00:00.000Z')
    expect(parsed.text.trim()).toBe(input().text.trim())
    // cid links are kept, not rewritten to data URLs.
    expect(parsed.html).toContain('cid:logo@inlark')
    expect(parsed.html).toContain('<b>Zoë</b>')
    const [logo, file] = parsed.attachments
    expect(logo).toMatchObject({ name: 'logo.png', type: 'image/png', cid: 'logo@inlark' })
    expect(logo.disposition).toBe('inline')
    expect(logo.content).toEqual(png)
    expect(file).toMatchObject({
      name: 'Übersicht März.bin',
      type: 'application/octet-stream',
      disposition: 'attachment',
      size: binary.byteLength,
    })
    expect(file.cid).toBeUndefined()
    expect(Buffer.isBuffer(file.content)).toBe(false)
    expect(file.content).toEqual(binary)
  })

  it('keeps Bcc only for drafts', async () => {
    const sent = await composeMime(input())
    expect(decode(sent)).not.toContain('hidden@example.test')
    const draft = await composeMime(input({ keepBcc: true }))
    expect(headers(draft)).toMatch(/^Bcc: .*hidden@example\.test/m)
    expect((await parseMime(draft)).bcc).toEqual([
      { name: 'Hidden Person', email: 'hidden@example.test' },
    ])
  })

  it('composes a text-only message and never invents HTML when parsing it', async () => {
    const mime = await composeMime(
      input({ html: '', attachments: [], bcc: [], inReplyTo: [], references: [] }),
    )
    expect(decode(mime)).not.toContain('multipart')
    expect(headers(mime)).not.toMatch(/^(In-Reply-To|References):/m)
    const parsed = await parseMime(mime)
    expect(parsed.html).toBe('')
    expect(parsed.text.trim()).toBe(input().text.trim())
    expect(parsed.inReplyTo).toEqual([])
    expect(parsed.references).toEqual([])
    expect(parsed.attachments).toEqual([])
  })

  it('parses List-Unsubscribe safely', async () => {
    const message = (unsubscribe: string, post = '') =>
      new TextEncoder().encode(
        [
          'From: News <news@example.test>',
          'To: me@example.test',
          'Subject: Weekly',
          'Message-ID: <n1@example.test>',
          `List-Unsubscribe: ${unsubscribe}`,
          ...(post ? [`List-Unsubscribe-Post: ${post}`] : []),
          '',
          'Hello',
          '',
        ].join('\r\n'),
      )
    expect(
      (
        await parseMime(
          message(
            '<mailto:leave@example.test?subject=unsubscribe>,\r\n <https://example.test/u/1>',
            'List-Unsubscribe=One-Click',
          ),
        )
      ).unsubscribe,
    ).toEqual({ url: 'https://example.test/u/1', oneClick: true })
    expect((await parseMime(message('<mailto:leave@example.test>'))).unsubscribe).toEqual({
      url: 'mailto:leave@example.test',
      oneClick: false,
    })
    expect((await parseMime(message('<javascript:alert(1)>'))).unsubscribe).toBeUndefined()
    expect(
      (await parseMime(message('<https://user:secret@example.test/u>'))).unsubscribe,
    ).toBeUndefined()
    expect((await parseMime(message('<http://example.test/u>'))).unsubscribe).toBeUndefined()
    const plain = await parseMime(message('<https://example.test/u>'))
    expect(plain.html).toBe('')
    expect(plain.text.trim()).toBe('Hello')
  })

  it('enforces a size bound', async () => {
    const mime = await composeMime(input())
    await expect(parseMime(mime, { maxBytes: mime.byteLength - 1 })).rejects.toMatchObject({
      code: 'tooLarge',
    })
    await expect(parseMime(mime, { maxBytes: mime.byteLength })).resolves.toBeTruthy()
  })
})
