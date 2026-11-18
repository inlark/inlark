import { afterAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, type Socket } from 'node:net'
import { connect as secure } from 'node:tls'
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
  },
  dialog: {},
  shell: {},
  Notification: { isSupported: () => false },
}))
import { MailService, type ProviderFactory } from '../apps/desktop/src/main/service'
import { JsonStore } from '../apps/desktop/src/main/storage'
import { MicrosoftAuth } from '../apps/desktop/src/main/microsoft-auth'
import { discover } from '../apps/desktop/src/main/discovery-transport'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import { ImapFlowPort, ImapProvider } from '../packages/imap/src'
import {
  isMicrosoftMailHost,
  type ConnectInput,
  type Draft,
  type ImapConnectionConfig,
} from '../packages/core/src'

/*
 * Runs inlark's own sign-in, sync and sending against a real Microsoft mailbox. Explicit opt-in:
 *
 *   INLARK_MICROSOFT_TEST=you@outlook.com pnpm exec vitest run tests/microsoft.integration.test.ts
 *
 * It prints a sign-in link (and writes it to INLARK_MICROSOFT_URL_FILE when set) and waits for
 * the browser to come back. It reads message headers into a throwaway index and prints counts
 * and folder names only. With INLARK_MICROSOFT_SEND=1 it also sends one message from the
 * mailbox to itself, which stays there. The sign-in it saved is deleted at the end.
 *
 * Hidden recipients take two runs. INLARK_MICROSOFT_BCC=<other mailbox> adds one to the message
 * and checks that the copy delivered to the visible recipient doesn't name it. Then, signed in to
 * that other mailbox, INLARK_MICROSOFT_FIND=<the subject the first run printed> checks that the
 * message arrived there.
 *
 * INLARK_MICROSOFT_SMTP=<minutes> is for a mailbox whose administrator allows SMTP: the run waits
 * that long for Microsoft to accept the sign-in over SMTP, which can lag behind the setting, and
 * fails if the message then goes out any other way.
 */
const address = process.env.INLARK_MICROSOFT_TEST
const sending = process.env.INLARK_MICROSOFT_SEND === '1'
const hidden = process.env.INLARK_MICROSOFT_BCC
const expected = process.env.INLARK_MICROSOFT_FIND
const smtpWithin = Number(process.env.INLARK_MICROSOFT_SMTP || 0)
const minutes = (n: number) => n * 60_000
const report = (line: string) => console.log('[microsoft] ' + line)

describe.skipIf(!address)('a real Microsoft mailbox', () => {
  const connectionId = 'microsoft-integration'
  const accountId = JSON.stringify([connectionId, 'imap'])
  let directory: string
  let service: MailService
  let auth: MicrosoftAuth
  let config: ImapConnectionConfig
  const factory: ProviderFactory = (options) =>
    new ImapProvider({
      connectionId: options.connectionId,
      name: options.name,
      config: options.config as ImapConnectionConfig,
      password: options.secrets.password,
      accessToken: options.accessToken,
      fallback: options.fallback,
      serverSentCopy: options.serverSentCopy,
      folders: options.folders,
      index: openInProcessIndex(
        options.temporary ? ':memory:' : join(directory, options.connectionId + '.sqlite'),
      ),
      readAttachment: options.readAttachment,
      // Synchronization is run by hand below, so the test decides when the server is asked.
      background: false,
    })
  const start = async () => {
    service = new MailService(new JsonStore(directory), () => {}, {
      providers: factory,
      discover,
      microsoft: (auth = new MicrosoftAuth({
        // Longer than the app waits, since the link has to be copied to a browser by hand.
        waitMs: minutes(18),
        open: async (url) => {
          report('Open this link in a browser on this computer and sign in as ' + address + ':')
          report(url)
          if (process.env.INLARK_MICROSOFT_URL_FILE)
            await writeFile(process.env.INLARK_MICROSOFT_URL_FILE, url + '\n', { mode: 0o600 })
        },
      })),
    })
    await service.init()
  }
  const provider = () => (service as any).providers.get(connectionId) as ImapProvider
  const sync = () => (provider() as any).syncPass('all') as Promise<void>
  /** The headers of every message with this subject, read straight from the server. */
  const headers = async (subject: string, folders: string[]) => {
    const session = (service as any).sessionSecrets.get(connectionId)?.microsoft
    const port = new ImapFlowPort(
      { ...config.incoming, accessToken: () => session.accessToken('mail') },
      'command',
    )
    await port.connect()
    try {
      const found: { folder: string; text: string }[] = []
      for (const folder of folders) {
        await port.select(folder)
        for (const uid of await port.search({ subject })) {
          const raw = await port.source(uid, 5_000_000)
          if (raw)
            found.push({
              folder,
              text: Buffer.from(raw)
                .toString('utf8')
                .split(/\r?\n\r?\n/)[0],
            })
        }
      }
      return found
    } finally {
      await port.close().catch(() => undefined)
    }
  }
  /**
   * What the outgoing server answers to this sign-in, word for word. inlark itself only keeps
   * what the answer means; the wording says whether a mailbox or its whole organization has SMTP
   * switched off.
   */
  const smtpSays = (token: string) =>
    new Promise<string>((resolve) => {
      const { host, port } = config.outgoing
      let socket: Socket = connect(port, host)
      let step = 0
      let buffer = ''
      const done = (text: string) => {
        clearTimeout(timer)
        socket.destroy()
        resolve(text.trim().replace(/\s+/g, ' ').slice(0, 300))
      }
      const timer = setTimeout(() => done('no answer in time'), 30_000)
      const failed = (error: Error) => done('connection failed: ' + error.message)
      const read = (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        // A reply ends with a line whose code is followed by a space.
        if (!/(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buffer)) return
        const reply = buffer
        buffer = ''
        step++
        // Greeting, EHLO, STARTTLS, EHLO again inside TLS, then the sign-in.
        if (step === 1) socket.write('EHLO inlark.test\r\n')
        else if (step === 2) socket.write('STARTTLS\r\n')
        else if (step === 3) {
          if (!/^220 /.test(reply)) return done(reply)
          socket.removeListener('data', read)
          socket = secure({ socket, servername: host }, () => socket.write('EHLO inlark.test\r\n'))
          socket.on('data', read).on('error', failed)
        } else if (step === 4)
          socket.write(
            'AUTH XOAUTH2 ' +
              Buffer.from(`user=${address}\x01auth=Bearer ${token}\x01\x01`).toString('base64') +
              '\r\n',
          )
        // A refusal can come as a challenge first, answered with an empty line.
        else if (/^334 /.test(reply)) socket.write('\r\n')
        else done(reply)
      }
      socket.on('data', read).on('error', failed)
    })
  const names = (text: string, who: string) => text.toLowerCase().includes(who.toLowerCase())
  const input = (grant?: string): ConnectInput => ({
    config,
    name: 'Integration',
    remember: true,
    connectionId,
    microsoft: grant ? { grant } : {},
  })
  afterAll(async () => {
    if (!service) return
    // Forgets the saved sign-in along with everything else the test kept.
    await service.disconnect(connectionId).catch(() => undefined)
    service.dispose()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await rm(directory, { recursive: true, force: true })
  })

  it(
    'is recognized, signs in, reads mail, sends, and stays signed in after a restart',
    async () => {
      directory = await mkdtemp(join(tmpdir(), 'inlark-microsoft-live-'))
      await start()

      const found = await service.discover(address!)
      const candidate = found.candidates[0]
      expect(candidate, 'discovery should recognize a Microsoft address').toMatchObject({
        protocol: 'imap',
      })
      if (candidate.protocol !== 'imap') throw new Error('unreachable')
      expect(isMicrosoftMailHost(candidate.incoming.host)).toBe(true)
      report(
        `recognized as ${candidate.provider} (${candidate.source}): ${candidate.outgoing.host}`,
      )
      config = {
        protocol: 'imap',
        email: address!,
        incoming: candidate.incoming,
        outgoing: candidate.outgoing,
        outgoingSameCredentials: true,
      }

      const started = await service.startMicrosoftSignIn(address!)
      const signedIn = await service.finishMicrosoftSignIn(started.id)
      if (!signedIn.ok) throw new Error(`sign-in ${signedIn.reason}: ${signedIn.message}`)
      report(
        `signed in as ${signedIn.email} (${signedIn.personal ? 'personal' : 'work or school'})`,
      )

      if (smtpWithin) {
        const deadline = Date.now() + minutes(smtpWithin)
        for (;;) {
          // Asking for the sign-in also keeps it from being forgotten while this waits.
          const said = await smtpSays(await auth.grant(signedIn.grant)!.accessToken('mail'))
          report('the outgoing server answers the sign-in: ' + said)
          if (/^235 /.test(said)) break
          if (Date.now() > deadline)
            throw new Error('Microsoft did not accept the sign-in over SMTP in time')
          await new Promise((resolve) => setTimeout(resolve, minutes(3)))
        }
      }

      const check = await service.testConnection({
        ...input(signedIn.grant),
        connectionId: undefined,
      })
      report(
        `check: incoming ${JSON.stringify(check.incoming)} outgoing ${JSON.stringify(check.outgoing)}`,
      )
      expect(check.incoming, 'incoming: ' + check.incoming.error).toEqual({ ok: true })
      expect(check.outgoing?.ok, 'outgoing: ' + check.outgoing?.error).toBe(true)
      report('folders the server marks: ' + JSON.stringify(check.folders?.mappings))

      const [account] = await service.connect(input(signedIn.grant))
      expect(account.status).toBe('connected')
      const viaGraph = !!account.limits?.send
      report(`sending goes through ${viaGraph ? 'Microsoft Graph (SMTP is switched off)' : 'SMTP'}`)
      if (smtpWithin) expect(viaGraph, 'sends over SMTP once Microsoft allows it').toBe(false)
      await sync()
      const boxes = await service.mailboxes(accountId)
      report(
        'folders: ' +
          boxes.map((b) => `${b.name}${b.role ? ` [${b.role}]` : ''} ${b.totalEmails}`).join(', '),
      )
      expect(boxes.some((b) => b.role === 'inbox')).toBe(true)
      expect(boxes.some((b) => b.role === 'sent')).toBe(true)
      const inbox = await service.query({ view: 'inbox', accountId })
      report(`inbox: ${inbox.items.length} conversations on the first page`)

      if (sending) {
        const subject = 'inlark integration ' + randomUUID().slice(0, 8)
        const draft: Draft = {
          id: randomUUID(),
          accountId,
          identityId: 'default',
          to: [{ name: '', email: address! }],
          cc: [],
          bcc: hidden ? [{ name: '', email: hidden }] : [],
          subject,
          html: '<p>Sent by inlark’s Microsoft integration test.</p>',
          text: 'Sent by inlark’s Microsoft integration test.',
          attachments: [],
          updatedAt: new Date().toISOString(),
          status: 'local',
        }
        const sentBefore = boxes.find((b) => b.role === 'sent')!.totalEmails
        const result = await service.send(draft)
        report(`send: ${JSON.stringify(result)}`)
        expect(result.status).toBe('sent')
        const journal = (service as any).journals.get(draft.id) as { messageId: string }
        const folder = (role: 'sent' | 'inbox') => boxes.find((b) => b.role === role)!.id
        // A message to oneself shares a conversation with its own Sent copy, so only messages
        // actually filed in the folder count.
        const copies = async (role: 'sent' | 'inbox') => {
          await sync()
          const page = await service.query({ view: role, accountId, subject })
          return page.items
            .flatMap((c) => c.messages)
            .filter((m) => m.subject === subject && m.mailboxIds[folder(role)])
        }
        // Microsoft files the Sent copy and delivers to the Inbox a little later.
        await vi.waitFor(async () => expect((await copies('sent')).length).toBeGreaterThan(0), {
          timeout: minutes(2),
          interval: 5000,
        })
        await vi.waitFor(async () => expect((await copies('inbox')).length).toBeGreaterThan(0), {
          timeout: minutes(2),
          interval: 5000,
        })
        report('delivered to the Inbox')
        // A second look, in case a duplicate arrives late.
        await new Promise((resolve) => setTimeout(resolve, 15_000))
        const sent = await copies('sent')
        const delivered = await copies('inbox')
        const ids = (m: (typeof sent)[number]) => JSON.stringify(m.messageId ?? [])
        report(`copies in Sent: ${sent.length}, in the Inbox: ${delivered.length}`)
        // The server's own count of the Sent folder, which had `sentBefore` messages.
        const sentAfter = (await service.mailboxes(accountId)).find((b) => b.role === 'sent')!
        report(`Sent folder: ${sentBefore} messages before, ${sentAfter.totalEmails} after`)
        expect(sentAfter.totalEmails - sentBefore, 'one message added to Sent').toBe(1)
        report(`Message-ID inlark gave the message: <${journal.messageId}>`)
        report(`Message-ID of the Sent copy: ${sent.map(ids).join(' ')}`)
        report(`Message-ID as delivered: ${delivered.map(ids).join(' ')}`)
        expect(sent, 'exactly one copy in Sent').toHaveLength(1)
        expect(delivered, 'delivered once').toHaveLength(1)
        if (hidden) {
          report(`subject, for the run in the hidden recipient's mailbox: ${subject}`)
          const copies = await headers(subject, ['INBOX', check.folders!.mappings.sent!.path])
          expect(copies, 'the Inbox and Sent copies').toHaveLength(2)
          for (const copy of copies)
            report(
              `${copy.folder} copy: ${/^bcc:/im.test(copy.text) ? 'has' : 'no'} Bcc header, ` +
                `${names(copy.text, hidden) ? 'names' : 'does not name'} the hidden recipient`,
            )
          const inbox = copies.find((copy) => copy.folder === 'INBOX')!
          expect(names(inbox.text, hidden), 'the delivered copy names the hidden recipient').toBe(
            false,
          )
        }
      }
      if (expected) {
        await vi.waitFor(
          async () => {
            await sync()
            const page = await service.query({ view: 'inbox', accountId, subject: expected })
            expect(page.items.length, 'the message for the hidden recipient').toBeGreaterThan(0)
          },
          { timeout: minutes(3), interval: 5000 },
        )
        const [copy] = await headers(expected, ['INBOX'])
        report(
          `arrived for the hidden recipient: ${/^bcc:/im.test(copy.text) ? 'has' : 'no'} Bcc header, ` +
            `${names(copy.text, address!) ? 'names' : 'does not name'} this mailbox in its headers`,
        )
      }

      // A restart has only what was saved to disk: the long-lived token.
      service.dispose()
      await start()
      await vi.waitFor(() => expect(service.accounts[0]?.status).toBe('connected'), {
        timeout: minutes(1),
        interval: 500,
      })
      report('connected again after a restart, from the saved sign-in')
      expect(await service.connectionSettings(connectionId)).toMatchObject({ microsoft: true })
    },
    minutes(30 + smtpWithin),
  )
})
