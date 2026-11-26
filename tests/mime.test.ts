import { describe, it, expect } from 'vitest'
import { composeMime, decodeText, parseMime, type ComposeInput } from '../packages/imap/src/mime'
import { labelTextCharsets } from '../packages/mime/src/charset'

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

describe('Text in legacy charsets', () => {
  const french = 'la référence est citée, le retourner dûment tamponné'
  const latin1 = (value: string) => Buffer.from(value, 'latin1')
  const message = (headers: string, body: Uint8Array | string) =>
    Buffer.concat([
      Buffer.from(
        'From: a@example.test\r\nTo: b@example.test\r\nSubject: Ordre de service\r\n' +
          'MIME-Version: 1.0\r\n' +
          headers +
          '\r\n\r\n',
      ),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
    ])
  const qp = (value: string) =>
    [...latin1(value)]
      .map((b) =>
        b > 126 || b === 61 ? '=' + b.toString(16).toUpperCase() : String.fromCharCode(b),
      )
      .join('')
  // As Outlook writes it: ’ is outside ISO-8859-1, so it becomes an entity, and é stays a byte.
  const outlook =
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">' +
    '</head><body><p>l&#8217;ordre de service dont ' +
    french +
    '</p></body></html>'

  it('reads Latin-1 HTML that declares its charset only in a meta tag', async () => {
    const parsed = await parseMime(
      message(
        'Content-Type: text/html\r\nContent-Transfer-Encoding: quoted-printable',
        qp(outlook),
      ),
    )
    expect(parsed.html).toContain('l&#8217;ordre de service dont ' + french)
    expect(parsed.text).toContain('l’ordre de service dont ' + french)
  })

  it('reads Latin-1 text that declares no charset, or claims UTF-8 or ASCII', async () => {
    for (const type of [
      'text/plain',
      'text/plain; charset=utf-8',
      'text/plain; charset="us-ascii"',
    ])
      for (const encoding of ['8bit', 'quoted-printable', 'base64']) {
        const body =
          encoding === 'base64'
            ? latin1(french).toString('base64')
            : encoding === 'quoted-printable'
              ? qp(french)
              : latin1(french)
        const parsed = await parseMime(
          message('Content-Type: ' + type + '\r\nContent-Transfer-Encoding: ' + encoding, body),
        )
        expect(parsed.text.trim(), type + ', ' + encoding).toBe(french)
      }
    // A message without any MIME headers is plain text too.
    const bare = Buffer.concat([Buffer.from('Subject: Ordre\r\n\r\n'), latin1(french)])
    expect((await parseMime(bare)).text.trim()).toBe(french)
  })

  it('reads Windows-1252 punctuation the way browsers do', async () => {
    const parsed = await parseMime(
      message('Content-Type: text/plain', latin1('Prix\xa0: 20\x80 \x96 \x93merci\x94')),
    )
    expect(parsed.text.trim()).toBe('Prix\u00a0: 20€ – “merci”')
  })

  it('fixes only the parts that need it and leaves attachments byte for byte', async () => {
    const attachment = new Uint8Array(256).map((_, i) => i)
    const parsed = await parseMime(
      message(
        'Content-Type: multipart/mixed; boundary="outer"',
        Buffer.concat([
          Buffer.from(
            'Preamble\r\n--outer\r\nContent-Type: multipart/alternative; boundary=inner\r\n\r\n' +
              '--inner\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCafé crème\r\n' +
              '--inner\r\nContent-Type: text/html; format=flowed\r\n\r\n',
          ),
          latin1('<p>' + french + '</p>'),
          Buffer.from(
            '\r\n--inner--\r\n--outer\r\nContent-Type: application/octet-stream\r\n' +
              'Content-Disposition: attachment; filename="data.bin"\r\n' +
              'Content-Transfer-Encoding: 8bit\r\n\r\n',
          ),
          attachment,
          Buffer.from('\r\n--outer--\r\n'),
        ]),
      ),
    )
    expect(parsed.text.trim()).toBe('Café crème')
    expect(parsed.html).toContain('<p>' + french + '</p>')
    expect(parsed.attachments).toHaveLength(1)
    expect([...parsed.attachments[0].content]).toEqual([...attachment])
  })

  it('writes the charset into the parameter itself, never into a quoted value', async () => {
    const parsed = await parseMime(
      message(
        'Content-Type: text/plain; name="a; charset=utf-8";\r\n charset=utf-8; format=flowed',
        latin1('café'),
      ),
    )
    expect(parsed.text.trim()).toBe('café')
  })

  it('finds parts in linear time, however often the boundary appears mid-line', async () => {
    // Searching for the line end at every mid-line boundary once took 11 s for this.
    const started = performance.now()
    const parsed = await parseMime(
      message(
        'Content-Type: multipart/mixed; boundary=b',
        '--b\r\nContent-Type: text/plain\r\n\r\n' + '--b'.repeat(800_000) + ' é\r\n--b--\r\n',
      ),
    )
    expect(parsed.text.endsWith(' é')).toBe(true)
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('reads a header with many parameters in linear time', async () => {
    // Searching each parameter for its equals sign to the end of the header once took 4 s.
    const started = performance.now()
    const parsed = await parseMime(
      message('Content-Type: text/plain;' + 'x;'.repeat(500_000), latin1('café')),
    )
    expect(parsed.text.trim()).toBe('café')
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('strips a comment from the transfer encoding in linear time', () => {
    // mailparser accepts this header; removing its comments with a regex once took 3 s here.
    const source = message(
      'Content-Type: text/plain\r\nContent-Transfer-Encoding: ' + '('.repeat(100_000),
      latin1('café'),
    )
    const started = performance.now()
    const labelled = labelTextCharsets(source)
    expect(performance.now() - started).toBeLessThan(500)
    expect(labelled?.toString('latin1')).toContain('Content-Type: text/plain; charset=windows-1252')
    const encoded = message(
      'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64 (Latin-1 inside)',
      latin1('café').toString('base64'),
    )
    expect(labelTextCharsets(encoded)?.toString('latin1')).toContain('charset=windows-1252')
  })

  it('keeps UTF-8 with a stray byte as UTF-8', async () => {
    const parsed = await parseMime(
      message(
        'Content-Type: text/plain; charset=utf-8',
        Buffer.concat([Buffer.from('Grüße aus Köln, ça va ? '), Buffer.from([0xff])]),
      ),
    )
    expect(parsed.text.trim()).toBe('Grüße aus Köln, ça va ? \uFFFD')
  })

  it('decodes a part with its byte order mark, declared charset, meta tag or UTF-8', () => {
    const cyrillic = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    expect(decodeText(cyrillic, { charset: 'windows-1251' })).toBe('Привет')
    expect(
      decodeText(Buffer.concat([Buffer.from('<meta charset="windows-1251"><body>'), cyrillic]), {
        html: true,
      }),
    ).toBe('<meta charset="windows-1251"><body>Привет')
    // A meta tag in the body, such as in quoted mail, doesn't count.
    expect(
      decodeText(Buffer.concat([Buffer.from('<body><meta charset="windows-1251">'), latin1('é')]), {
        html: true,
      }),
    ).toBe('<body><meta charset="windows-1251">é')
    expect(decodeText(Buffer.from('\ufeffHello'), { charset: 'iso-8859-1' })).toBe('Hello')
    expect(decodeText(Buffer.from('référence'), { charset: 'us-ascii' })).toBe('référence')
    // Latin-1 where “é »” with a no-break space happens to form one valid UTF-8 sequence.
    expect(decodeText(latin1('« Il est allé\xa0» à côté'))).toBe('« Il est allé\xa0» à côté')
    expect(decodeText(Buffer.from('x', 'latin1'), { charset: 'x-unknown' })).toBe('x')
  })

  it('drops a character cut off by the end of a partial download', () => {
    const cut = Buffer.from('Grüß').subarray(0, -1)
    expect(decodeText(cut, { charset: 'utf-8', partial: true })).toBe('Grü')
    expect(decodeText(Buffer.from('Ça'), { partial: true })).toBe('Ça')
  })
})
