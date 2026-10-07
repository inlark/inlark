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
import { JmapProvider } from '../packages/jmap/src'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { Draft } from '../packages/core/src'
const serverUrl = process.env.STALWART_TEST_URL,
  username = process.env.STALWART_TEST_USERNAME,
  password = process.env.STALWART_TEST_PASSWORD
// Explicit opt-in. Only ever point this at a disposable server: creates and deletes test mail.
describe.skipIf(!serverUrl || !username || !password)('disposable Stalwart integration', () => {
  it('discovers, paginates, searches, renders, uploads, organizes, submits, and cleans up', async () => {
    const provider = new JmapProvider({
      serverUrl: serverUrl!,
      authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
      connectionId: 'integration',
      name: 'Integration',
    })
    const [account] = await provider.connect()
    expect(account).toBeTruthy()
    const identities = await provider.identities(account)
    expect(identities.length).toBeGreaterThan(0)
    const tag = 'inlark-test-' + randomUUID()
    let folderId = ''
    const created: string[] = []
    try {
      await provider.folder(account, 'create', undefined, tag)
      folderId = (await provider.mailboxes(account)).find((b) => b.name === tag)!.id
      const create = Object.fromEntries(
        Array.from({ length: 61 }, (_, i) => [
          'e' + i,
          {
            mailboxIds: { [folderId]: true },
            keywords: { $seen: true },
            from: [{ name: 'Fixture', email: identities[0].email }],
            to: [{ name: 'Test', email: identities[0].email }],
            subject: tag + ' ' + i,
            receivedAt: new Date(Date.UTC(2026, 8, 20, 0, i)).toISOString(),
            textBody: [{ partId: 'text', type: 'text/plain' }],
            bodyValues: { text: { value: 'Unicode: Grüße aus Wien. Search needle ' + i } },
          },
        ]),
      )
      const [set] = await provider.call([
        ['Email/set', { accountId: account.remoteId, create }, 'seed'],
      ])
      expect(set.notCreated).toBeUndefined()
      created.push(...Object.values<{ id: string }>(set.created).map((v) => v.id))
      // Stalwart updates search/sort indexes asynchronously after bulk Email/set.
      await expect
        .poll(
          async () =>
            (await provider.query(account, { view: 'all', mailboxId: folderId }, 0, 100)).items.map(
              (c) => c.messages[0].id,
            ),
          { timeout: 10000, interval: 100 },
        )
        .toEqual(Array.from({ length: 61 }, (_, i) => set.created['e' + (60 - i)].id))
      const first = await provider.query(account, { view: 'all', mailboxId: folderId }, 0, 50)
      const second = await provider.query(
        account,
        { view: 'all', mailboxId: folderId },
        first.next,
        50,
      )
      expect(first.items).toHaveLength(50)
      expect(second.items).toHaveLength(11)
      expect(new Set([...first.items, ...second.items].map((c) => c.key)).size).toBe(61)
      const body = await provider.conversation(account, first.items[0].id)
      expect(body[0].text).toContain('Grüße')
      const result = await provider.update(account, {
        [body[0].id]: { keywords: { $flagged: true, $seen: false } },
      })
      expect(result.failures).toEqual([])
      const flagged = await provider.query(account, { view: 'starred', mailboxId: folderId })
      expect(flagged.items).toHaveLength(1)
      expect(flagged.items[0].unread).toBe(true)
      const searched = await provider.query(account, {
        view: 'all',
        mailboxId: folderId,
        subject: tag + ' 60',
      })
      expect(searched.items).toHaveLength(1)
      const blobId = await provider.upload(
        account,
        new TextEncoder().encode('Attachment fixture'),
        'text/plain',
      )
      const bytes = await provider.download(account, {
        blobId,
        name: 'fixture.txt',
        type: 'text/plain',
        size: 18,
      })
      expect(new TextDecoder().decode(bytes)).toBe('Attachment fixture')
      const draft: Draft = {
        id: randomUUID(),
        accountId: account.id,
        identityId: identities[0].id,
        to: [{ name: 'Self', email: identities[0].email }],
        cc: [],
        bcc: [],
        subject: tag + ' submission',
        html: '<p>Local delivery test</p>',
        text: 'Local delivery test',
        attachments: [
          { id: randomUUID(), blobId, name: 'fixture.txt', size: 18, type: 'text/plain' },
        ],
        updatedAt: new Date().toISOString(),
        status: 'local',
      }
      const emailId = await provider.createDraft(account, draft, draft.id + '@inlark.test')
      created.push(emailId)
      expect((await provider.messages(account, [emailId], true))[0].attachments).toHaveLength(1)
      const outgoing = {
        messageId: draft.id + '@inlark.test',
        emailId,
        envelope: { from: identities[0].email, to: [identities[0].email] },
      }
      expect((await provider.submit(account, outgoing, draft.identityId)).rejected).toEqual([])
      expect(await provider.submissionExists(account, outgoing)).toBe(true)
      await provider.folder(account, 'rename', folderId, tag + ' renamed')
      if (process.env.STALWART_TEST_CONTAINER) {
        const restart = spawnSync(
          process.env.STALWART_TEST_RUNTIME || 'podman',
          ['restart', process.env.STALWART_TEST_CONTAINER],
          { encoding: 'utf8' },
        )
        expect(restart.status).toBe(0)
        await expect
          .poll(
            async () => {
              try {
                return (await provider.connect())[0].id
              } catch {
                return undefined
              }
            },
            { timeout: 15000, interval: 250 },
          )
          .toBe(account.id)
        expect((await provider.query(account, { view: 'all', mailboxId: folderId })).total).toBe(61)
      }
    } finally {
      if (created.length) {
        for (let attempt = 0; attempt < 5; attempt++) {
          await provider.messages(account, created)
          try {
            await provider.update(account, {}, created)
            break
          } catch (e) {
            if (attempt === 4) throw e
          }
        }
      }
      if (folderId) await provider.folder(account, 'delete', folderId)
      provider.dispose()
    }
  }, 60000)
  it('imports complete encrypted MIME, resumes ciphertext drafts and submits with an explicit Bcc envelope', async () => {
    const provider = new JmapProvider({
      serverUrl: serverUrl!,
      authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
      connectionId: 'encrypted-integration',
      name: 'Encrypted integration',
    })
    const [account] = await provider.connect(),
      [identity] = await provider.identities(account),
      engine = new CryptoEngine(),
      key = await engine.generate('Integration', identity.email)
    await engine.load([key])
    const draft: Draft = {
      id: randomUUID(),
      accountId: account.id,
      identityId: identity.id,
      to: [],
      cc: [],
      bcc: [{ name: 'Self', email: identity.email }],
      subject: 'Encrypted integration ' + randomUUID(),
      html: '<p>SECRET JMAP MARKER</p>',
      text: 'SECRET JMAP MARKER',
      attachments: [],
      updatedAt: new Date().toISOString(),
      status: 'local',
      encryption: 'encrypt',
    }
    const id = draft.id + '@inlark.test',
      plain = await composeMime({
        from: identity,
        to: [],
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
      encryptedMime(
        await engine.encrypt(mimeContent(plain), [key.publicKey], key.fingerprint, true),
      ),
      ['Autocrypt-Draft-State: encrypt=yes; _by-choice=yes'],
    )
    const created: string[] = []
    try {
      const draftId = await provider.createDraft(account, draft, undefined, encrypted)
      created.push(draftId)
      const raw = await provider.rawMessage(account, draftId, 64 * 1024 * 1024)
      expect(Buffer.from(raw)).toEqual(encrypted)
      expect(Buffer.from(raw).toString()).not.toContain('MARKER')
      expect(
        (await parseMime((await engine.decrypt(armoredPayload(raw), [key.publicKey])).data))
          .attachments,
      ).toHaveLength(1)
      const outgoingMime = replaceContent(
        plain,
        encryptedMime(
          await engine.encrypt(mimeContent(plain), [key.publicKey], key.fingerprint, true),
        ),
        [
          autocryptHeader(
            identity.email,
            await engine.autocryptKey(key.publicKey, identity.email),
            true,
          ),
        ],
      )
      const outgoing = await provider.prepareSubmission(account, draft, id, outgoingMime)
      created.push(outgoing.emailId!)
      expect(outgoing.envelope.to).toEqual([identity.email])
      expect(
        Buffer.from(
          await provider.rawMessage(account, outgoing.emailId!, 64 * 1024 * 1024),
        ).toString(),
      ).toContain('prefer-encrypt=mutual')
      expect((await provider.submit(account, outgoing, identity.id)).accepted).toEqual([
        identity.email,
      ])
      expect(await provider.submissionExists(account, outgoing)).toBe(true)
      await expect
        .poll(
          async () =>
            (await provider.encryptionHints(account, identity.email))
              .map((hint) => Buffer.from(hint.headers).toString())
              .join('\n'),
          { timeout: 10000, interval: 250 },
        )
        .toContain('prefer-encrypt=mutual')
      expect(
        Buffer.from(
          await provider.rawMessage(account, outgoing.emailId!, 64 * 1024 * 1024),
        ).toString(),
      ).not.toContain('MARKER')
    } finally {
      await provider.messages(account, created)
      await provider.update(account, {}, created)
      provider.dispose()
    }
  }, 60000)
})
