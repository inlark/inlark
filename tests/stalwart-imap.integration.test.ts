import {
  CryptoEngine,
  mimeContent,
  replaceContent,
  encryptedMime,
  armoredPayload,
  autocryptHeader,
} from '../packages/crypto/src'
import { composeMime, parseMime } from '../packages/mime/src'
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { JmapProvider } from '../packages/jmap/src'
import { ImapProvider, submitSmtp, verifySmtp } from '../packages/imap/src'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import type { Draft, ImapConnectionConfig } from '../packages/core/src'

const env = process.env
const ready =
  env.STALWART_TEST_URL &&
  env.STALWART_TEST_USERNAME &&
  env.STALWART_TEST_PASSWORD &&
  env.STALWART_TEST_IMAPS_PORT &&
  env.STALWART_TEST_CA
// Explicit opt-in. Only ever point this at a disposable server: creates and deletes test mail.
describe.skipIf(!ready)('disposable Stalwart IMAP/SMTP integration', () => {
  const username = env.STALWART_TEST_USERNAME!
  const password = env.STALWART_TEST_PASSWORD!
  const ca = ready ? readFileSync(env.STALWART_TEST_CA!, 'utf8') : ''
  const config = (security: 'tls' | 'starttls'): ImapConnectionConfig => ({
    protocol: 'imap',
    email: username,
    incoming: {
      host: '127.0.0.1',
      port: Number(security === 'tls' ? env.STALWART_TEST_IMAPS_PORT : env.STALWART_TEST_IMAP_PORT),
      security,
      username,
    },
    outgoing: {
      host: '127.0.0.1',
      port: Number(
        security === 'tls' ? env.STALWART_TEST_SUBMISSIONS_PORT : env.STALWART_TEST_SUBMISSION_PORT,
      ),
      security,
      username,
    },
    outgoingSameCredentials: true,
  })
  const imap = (
    security: 'tls' | 'starttls' = 'tls',
    overrides: Partial<ConstructorParameters<typeof ImapProvider>[0]> = {},
  ) =>
    new ImapProvider({
      connectionId: 'integration-' + security,
      name: 'Integration',
      config: config(security),
      password,
      index: openInProcessIndex(':memory:'),
      readAttachment: async () => new TextEncoder().encode('Attachment fixture'),
      background: false,
      tls: { ca },
      timing: { sentCopyGraceMs: 3000 },
      ...overrides,
    })
  const sync = (p: ImapProvider) => (p as any).syncPass('all') as Promise<void>

  it('enforces TLS verification, credentials and both security modes', async () => {
    const untrusted = imap('tls', { tls: undefined })
    await expect(untrusted.connect()).rejects.toMatchObject({ code: 'certificate' })
    await untrusted.close()
    // Without the test CA, the server's certificate can still be reviewed and trusted by itself.
    for (const security of ['tls', 'starttls'] as const) {
      const reviewing = imap(security, { tls: undefined })
      const certificate = await reviewing.inspectCertificate('incoming')
      expect(certificate).toMatchObject({ problem: 'unknownIssuer', issuer: 'Inlark Test CA' })
      expect(await reviewing.inspectCertificate('outgoing')).toMatchObject({
        sha256: certificate!.sha256,
      })
      const trusted = { sha256: certificate!.sha256, pem: certificate!.pem }
      const base = config(security)
      const p = imap(security, {
        tls: undefined,
        config: {
          ...base,
          incoming: { ...base.incoming, certificate: trusted },
          outgoing: { ...base.outgoing, certificate: trusted },
        },
      })
      expect(await p.connect()).toHaveLength(1)
      await p.verifyOutgoing()
      await p.close()
    }
    const wrong = imap('tls', { password: 'wrong-' + randomUUID() })
    await expect(wrong.connect()).rejects.toMatchObject({ code: 'authentication' })
    await wrong.close()
    for (const security of ['tls', 'starttls'] as const) {
      const p = imap(security)
      expect(await p.connect()).toHaveLength(1)
      await p.verifyOutgoing()
      await p.close()
    }
    await expect(
      verifySmtp({ ...config('tls').outgoing, password: 'wrong', tls: { ca } }),
    ).rejects.toMatchObject({ code: 'outgoingAuthentication' })
  }, 60000)

  it('indexes, searches, organizes, drafts and sends, with changes visible over JMAP', async () => {
    const jmap = new JmapProvider({
      serverUrl: env.STALWART_TEST_URL!,
      authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
      connectionId: 'integration-jmap',
      name: 'Integration',
    })
    const [jmapAccount] = await jmap.connect()
    const p = imap()
    const [account] = await p.connect()
    const tag = 'Inlark-imap-' + randomUUID()
    let folderId = ''
    try {
      await p.folder(account, 'create', undefined, tag)
      const jmapFolder = (await jmap.mailboxes(jmapAccount)).find((b) => b.name === tag)!
      const [set] = await jmap.call([
        [
          'Email/set',
          {
            accountId: jmapAccount.remoteId,
            create: Object.fromEntries(
              Array.from({ length: 61 }, (_, i) => [
                'e' + i,
                {
                  mailboxIds: { [jmapFolder.id]: true },
                  from: [{ name: 'Fixture', email: username }],
                  to: [{ name: 'Test', email: username }],
                  subject: tag + ' ' + i,
                  messageId: [tag + '-' + i + '@inlark.test'],
                  ...(i > 0
                    ? {
                        references: [tag + '-0@inlark.test'],
                        inReplyTo: [tag + '-0@inlark.test'],
                      }
                    : {}),
                  receivedAt: new Date(Date.UTC(2026, 8, 20, 0, i)).toISOString(),
                  textBody: [{ partId: 'text', type: 'text/plain' }],
                  bodyValues: { text: { value: 'Unicode: Grüße aus Wien. Needle ' + i } },
                },
              ]),
            ),
          },
          'seed',
        ],
      ])
      expect(set.notCreated).toBeUndefined()
      await sync(p)
      folderId = (await p.mailboxes(account)).find((b) => b.name === tag)!.id
      // All 61 share References, so they are one conversation of 61 messages.
      const page = await p.query(account, { view: 'all', mailboxId: folderId })
      expect(page.items).toHaveLength(1)
      expect(page.items[0].count).toBe(61)
      const messages = await p.conversation(account, page.items[0].id)
      expect(messages).toHaveLength(61)
      expect(messages[0].text).toContain('Grüße')
      // Server search, polled because indexing happens asynchronously on the server.
      await expect
        .poll(
          async () =>
            (await p.query(account, { view: 'all', mailboxId: folderId, subject: tag + ' 60' }))
              .items.length,
          {
            timeout: 15000,
            interval: 500,
          },
        )
        .toBe(1)
      // Flag over IMAP, observe over JMAP.
      const first = messages[0]
      expect(
        (await p.update(account, { [first.id]: { keywords: { $flagged: true } } })).failures,
      ).toEqual([])
      const jmapFirst = (
        await jmap.query(jmapAccount, {
          view: 'all',
          mailboxId: jmapFolder.id,
          subject: tag + ' 0',
        })
      ).items[0].messages.find((m) => m.subject === tag + ' 0')!
      expect((await jmap.messages(jmapAccount, [jmapFirst.id]))[0].keywords.$flagged).toBe(true)
      // Move over IMAP; the message keeps its ID and JMAP sees the new folder.
      const boxes = await p.mailboxes(account)
      const trash = boxes.find((b) => b.role === 'trash')!
      const moved = await p.update(account, {
        [first.id]: { mailboxes: { [folderId]: false, [trash.id]: true } },
      })
      expect(moved).toEqual({ updated: [first.id], failures: [] })
      expect((await p.messages(account, [first.id]))[0].mailboxIds).toEqual({ [trash.id]: true })
      const jmapTrash = (await jmap.mailboxes(jmapAccount)).find((b) => b.role === 'trash')!
      expect((await jmap.messages(jmapAccount, [jmapFirst.id]))[0].mailboxIds).toEqual({
        [jmapTrash.id]: true,
      })
      // Permanent deletion removes exactly that message.
      expect(await p.update(account, {}, [first.id])).toEqual({ updated: [first.id], failures: [] })
      expect(await jmap.messages(jmapAccount, [jmapFirst.id])).toEqual([])

      // Drafts are appended with $draft and visible to JMAP clients.
      const draft: Draft = {
        id: randomUUID(),
        accountId: account.id,
        identityId: 'default',
        to: [{ name: 'Self', email: username }],
        cc: [],
        bcc: [{ name: 'Nobody', email: 'nobody-' + randomUUID().slice(0, 8) + '@inlark.test' }],
        subject: tag + ' submission',
        html: '<p>Grüße per SMTP</p>',
        text: 'Grüße per SMTP',
        attachments: [{ id: randomUUID(), name: 'fixture.txt', type: 'text/plain', size: 18 }],
        updatedAt: new Date().toISOString(),
        status: 'local',
      }
      const draftId = await p.createDraft(account, draft)
      const [savedDraft] = await p.messages(account, [draftId], true)
      expect(savedDraft).toMatchObject({ subject: tag + ' submission', keywords: { $draft: true } })
      expect(savedDraft.attachments).toHaveLength(1)

      // Send: the unknown Bcc recipient is refused while the real one accepts (partial).
      const messageId = randomUUID() + '@inlark.test'
      const outgoing = await p.prepareSubmission(account, draft, messageId)
      const outcome = await submitSmtp(
        { ...config('tls').outgoing, password, tls: { ca } },
        outgoing.envelope,
        outgoing.mime!,
      )
      expect(outcome.accepted).toEqual([username])
      expect(['server', 'filed']).toContain(await p.fileSentCopy(account, outgoing))
      // Filing again finds the copy by Message-ID and never appends a duplicate.
      expect(await p.fileSentCopy(account, outgoing)).toBe('server')
      await expect
        .poll(
          async () => {
            await sync(p)
            return (await p.query(account, { view: 'inbox', subject: tag + ' submission' })).items
              .length
          },
          { timeout: 20000, interval: 1000 },
        )
        .toBe(1)
      const [delivered] = (await p.query(account, { view: 'inbox', subject: tag + ' submission' }))
        .items
      const [received] = await p
        .conversation(account, delivered.id)
        .then((m) => m.filter((x) => x.messageId?.includes(messageId)))
      expect(received.text).toContain('Grüße per SMTP')
      expect(received.bcc).toEqual([])
    } finally {
      // Refresh the JMAP state before each attempt: the IMAP side changed the mailbox meanwhile.
      for (let attempt = 0; attempt < 5; attempt++) {
        const [found] = await jmap.call([
          [
            'Email/query',
            { accountId: jmapAccount.remoteId, filter: { subject: tag }, limit: 500 },
            'q',
          ],
        ])
        if (!found.ids.length) break
        await jmap.messages(jmapAccount, found.ids)
        try {
          await jmap.update(jmapAccount, {}, found.ids)
          break
        } catch (error) {
          if (attempt === 4) throw error
        }
      }
      if (folderId) await p.folder(account, 'delete', folderId).catch(() => {})
      await p.close()
      jmap.dispose()
    }
  }, 120000)
  it('APPENDs encrypted drafts, retrieves byte-preserving sources and sends the same protected bytes through SMTP', async () => {
    const provider = imap(),
      [account] = await provider.connect(),
      [identity] = await provider.identities(account),
      engine = new CryptoEngine(),
      key = await engine.generate('Integration', identity.email)
    await engine.load([key])
    const draft: Draft = {
      id: randomUUID(),
      accountId: account.id,
      identityId: identity.id,
      to: [{ name: 'Self', email: identity.email }],
      cc: [],
      bcc: [],
      subject: 'Encrypted IMAP ' + randomUUID(),
      html: '<p>SECRET IMAP MARKER</p>',
      text: 'SECRET IMAP MARKER',
      attachments: [],
      updatedAt: new Date().toISOString(),
      status: 'local',
      encryption: 'encrypt',
    }
    const id = draft.id + '@inlark.test',
      plain = await composeMime({
        from: identity,
        to: draft.to,
        cc: [],
        bcc: [],
        subject: draft.subject,
        text: draft.text,
        html: draft.html,
        messageId: id,
        attachments: [
          {
            name: 'secret.txt',
            type: 'text/plain',
            content: Buffer.from('SECRET ATTACHMENT MARKER'),
          },
        ],
      })
    const encrypted = replaceContent(
      plain,
      encryptedMime(await engine.encrypt(mimeContent(plain), [key.publicKey], key.fingerprint)),
      ['Autocrypt-Draft-State: encrypt=yes'],
    )
    let serverId: string | undefined
    try {
      serverId = await provider.createDraft(account, draft, id, encrypted)
      const raw = await provider.rawMessage(account, serverId, 64 * 1024 * 1024)
      expect(Buffer.from(raw)).toEqual(encrypted)
      expect(Buffer.from(raw).toString()).not.toContain('MARKER')
      const content = await engine.decrypt(armoredPayload(raw), [key.publicKey])
      expect((await parseMime(content.data)).text).toContain('SECRET IMAP MARKER')
      expect(content.signatures[0].valid).toBe(true)
      const outgoing = await provider.prepareSubmission(
        account,
        draft,
        id,
        replaceContent(
          plain,
          encryptedMime(await engine.encrypt(mimeContent(plain), [key.publicKey], key.fingerprint)),
          [
            autocryptHeader(
              identity.email,
              await engine.autocryptKey(key.publicKey, identity.email),
              true,
            ),
          ],
        ),
      )
      expect((await provider.submit(account, outgoing)).accepted).toEqual([identity.email])
      await provider.fileSentCopy(account, outgoing)
      await sync(provider)
      expect(
        (await provider.encryptionHints(account, identity.email)).some((hint) =>
          Buffer.from(hint.headers).toString().includes('prefer-encrypt=mutual'),
        ),
      ).toBe(true)
    } finally {
      if (serverId) await provider.update(account, {}, [serverId])
      await provider.close()
    }
  }, 60000)
})
