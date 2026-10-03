import {
  accountKey,
  conversationFromMessages,
  defaultSettings,
  folderRoles,
  mergePages,
  nextAccountColor,
  type Account,
  type AppEvent,
  type ConnectInput,
  type ConnectionConfig,
  type ConnectionTest,
  type DesktopMailAPI,
  type DiscoveryCandidate,
  type Draft,
  type FolderMappingReview,
  type FolderMappings,
  type Mailbox,
  type Message,
  type MailQuery,
  type MutationInput,
  type SubmissionSummary,
} from '@inlark/core'

const names = ['Personal', 'Studio', 'Projects', 'Community', 'Archive']
const emails = [
  'personal@example.com',
  'studio@example.com',
  'projects@example.com',
  'community@example.com',
  'archive@example.com',
]
const palette = ['#a69aef', '#83bba8', '#e7ae7c', '#7caee4', '#d491ac']
/**
 * The sample accounts cover the states the account settings must explain: a JMAP account, an
 * IMAP account still indexing, one whose server can't delete permanently, one whose outgoing
 * login failed, and a legacy record saved before the protocol was stored.
 */
const demoStates: Partial<Account>[] = [
  { protocol: 'jmap' },
  { protocol: 'imap', indexing: { indexed: 12_340, total: 50_000, complete: false } },
  {
    protocol: 'imap',
    limits: {
      move: 'This server can’t move messages between folders without risking duplicates.',
      destroy:
        'This server can’t delete messages permanently without affecting other messages in the folder.',
    },
  },
  { protocol: 'imap', outgoingError: 'The outgoing server rejected the username or password.' },
  {},
]
export const demoAccounts: Account[] = names.map((name, i) => ({
  id: accountKey('demo-' + i, 'mail'),
  connectionId: 'demo-' + i,
  remoteId: 'mail',
  name,
  email: emails[i],
  color: palette[i],
  status: 'connected',
  ...demoStates[i],
}))
const catalog = [
  [
    'GitHub',
    'notifications@github.com',
    'Your weekly development digest',
    'A little progress, every day. Here’s what happened in your repositories this week.',
    'notifications',
  ],
  [
    'Hetzner',
    'billing@hetzner.com',
    'Your invoice for September is ready',
    'Your monthly invoice is now available. Thank you for building with us.',
    'invoice',
  ],
  [
    'Maya Chen',
    'maya.chen@gmail.com',
    'A few thoughts on the new direction',
    'Hey Paul, I took another look at the explorations. The quieter direction feels right.',
    'personal',
  ],
  [
    'Vercel',
    'notifications@vercel.com',
    'Production deployment completed',
    'Everything is looking good. Your latest deployment is now live.',
    'deployment',
  ],
  [
    'Stripe',
    'receipts@stripe.com',
    'Your receipt from Linear',
    'Thanks for your payment. Your receipt is attached for your records.',
    'invoice',
  ],
  [
    'Figma',
    'updates@figma.com',
    'Alex left a comment in Brand explorations',
    '“Really like where this is going. Let’s try the second variation with a little more space.”',
    'personal',
  ],
  [
    'Plausible',
    'reports@plausible.io',
    'Your weekly website report',
    'A quick look at how your website did this week. 1,284 visitors, up 12% from last week.',
    'report',
  ],
  [
    'Cal.com',
    'notifications@cal.com',
    'Confirmed: Catch-up with Alex',
    'Thursday, September 24 at 10:00 AM. The details are inside.',
    'calendar',
  ],
  [
    'Resend',
    'notifications@resend.com',
    'Your domain has been verified',
    'You’re all set. You can now send emails from your custom domain.',
    'deployment',
  ],
  [
    'GitLab',
    'notifications@gitlab.com',
    'Pipeline passed · update dependencies',
    'All checks passed for your latest commit on the main branch.',
    'deployment',
  ],
  [
    'Daniel Fischer',
    'daniel.fischer@outlook.com',
    'Re: Coffee sometime next week?',
    'Tuesday works for me! There’s a new place around the corner I’ve been meaning to try.',
    'personal',
  ],
  [
    'Cloudflare',
    'notifications@cloudflare.com',
    'Monthly security overview',
    'Your sites stayed protected this month. Here’s your September overview.',
    'report',
  ],
  [
    'Medium',
    'digest@medium.com',
    'A few things worth reading',
    'This week: thoughtful interfaces, small tools, and making room for better work.',
    'newsletter',
  ],
  [
    'Lena Weber',
    'lena.weber@fastmail.com',
    'The final files are in the folder',
    'Just uploaded the final exports. Everything should be ready for tomorrow.',
    'personal',
  ],
  [
    'Proton',
    'account@proton.me',
    'Your account recovery details',
    'A reminder to keep your recovery information somewhere safe.',
    'notifications',
  ],
  [
    'Amazon',
    'orders@amazon.com',
    'Your order is on its way',
    'Good news, your package has shipped. You can follow its journey inside.',
    'invoice',
  ],
  [
    'Linear',
    'notifications@linear.app',
    'September workspace summary',
    'A look back at what your team shipped, and what’s coming next.',
    'report',
  ],
  [
    'Notion',
    'notifications@notion.so',
    'You were mentioned in Project notes',
    'A new comment is waiting for you in your shared workspace.',
    'personal',
  ],
  [
    'Buttondown',
    'news@buttondown.email',
    'Notes on building things slowly',
    'A small collection of ideas, tools, and things that caught our attention.',
    'newsletter',
  ],
  [
    'DigitalOcean',
    'billing@digitalocean.com',
    'Your account balance has been updated',
    'We’ve received your payment. No further action is needed.',
    'invoice',
  ],
  [
    'OpenAI',
    'updates@tm.openai.com',
    'New research and product updates',
    'A short roundup of the latest tools, research, and product news.',
    'newsletter',
  ],
]
const referenceTime = new Date()
referenceTime.setHours(11, 42, 0, 0)
const listeners = new Set<(event: AppEvent) => void>()
const changes = new Map<string, Message | null>()
const undoStack = new Map<string, [string, Message | null | undefined][]>()
const drafts = new Map<string, Draft>()
let settings = { ...defaultSettings }
const rights = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  mayCreateChild: true,
  mayRename: true,
  mayDelete: true,
}
const folders = new Map<string, Mailbox[]>()
const stress = typeof location !== 'undefined' && new URLSearchParams(location.search).has('stress')
const perAccount = stress ? 50_000 : 36
function body(name: string, subject: string, preview: string, type: string) {
  if (type === 'personal')
    return (
      '<p>Hey Paul,</p><p>' +
      preview +
      '</p><p>I’ve put a few notes together so we can pick this up when you have a moment. No rush — let me know what you think.</p><p>Talk soon,<br/>' +
      name.split(' ')[0] +
      '</p>'
    )
  if (type === 'invoice')
    return (
      '<div style="max-width:560px;margin:auto;padding:28px 32px;background:#fff;color:#34343a;border-radius:8px;font-family:Arial,sans-serif"><p style="color:#8a74b6;font-size:13px;font-weight:bold;letter-spacing:2px">' +
      name.toUpperCase() +
      '</p><h2 style="font-size:25px;font-weight:500;margin:36px 0 18px">' +
      subject +
      '</h2><p style="color:#73737c;line-height:1.8">Hi Paul,<br/>' +
      preview +
      '</p></div>'
    )
  return (
    '<p>Hi Paul,</p><p>' +
    preview +
    '</p><p>You can find the full details in your dashboard. If you have any questions, we’re always happy to help.</p><p>Best,<br/>The ' +
    name +
    ' team</p>'
  )
}
function message(accountIndex: number, index: number, bodies = true): Message {
  const entry = catalog[(index + accountIndex * 3) % catalog.length]
  const [name, email, subject, preview, type] = entry
  const account = demoAccounts[accountIndex]
  const date = new Date(referenceTime.getTime() - index * 47 * 60_000 - accountIndex * 13 * 60_000)
  const id = 'message-' + index
  return {
    id,
    accountId: account.id,
    threadId: 'thread-' + index,
    subject,
    from: [{ name, email }],
    to: [{ name: 'Paul', email: account.email }],
    cc: [],
    bcc: [],
    replyTo: [],
    receivedAt: date.toISOString(),
    preview,
    size: 4300,
    hasAttachment: type === 'invoice',
    keywords: {
      ...(index < 3 && accountIndex < 3 ? {} : { $seen: true }),
      ...(index === 2 || index === 10 ? { $flagged: true } : {}),
    },
    mailboxIds: { [index < (stress ? 50_000 : 28) ? 'inbox' : 'archive']: true },
    html: bodies ? body(name, subject, preview, type) : undefined,
    text: preview,
    messageId: [id + '@demo.example'],
    attachments:
      type === 'invoice'
        ? [
            {
              blobId: 'demo-pdf',
              name: 'Invoice-September.pdf',
              type: 'application/pdf',
              size: 84210,
            },
          ]
        : [],
    ...(type === 'newsletter'
      ? { unsubscribe: { url: 'https://example.com/unsubscribe', oneClick: true } }
      : {}),
  }
}
function get(accountIndex: number, index: number, bodies = true): Message | null {
  const key = accountIndex + ':' + index
  return changes.has(key) ? changes.get(key)! : message(accountIndex, index, bodies)
}
function matches(m: Message, q: MailQuery): boolean {
  if (q.mailboxId && !m.mailboxIds[q.mailboxId]) return false
  if (
    !q.mailboxId &&
    ['inbox', 'archive', 'sent', 'drafts', 'junk', 'trash'].includes(q.view) &&
    !m.mailboxIds[q.view]
  )
    return false
  if (q.unread && m.keywords.$seen) return false
  if (q.view === 'starred' && !m.keywords.$flagged) return false
  if (
    q.text &&
    !(m.subject + ' ' + m.preview + ' ' + m.from.map((a) => a.name + ' ' + a.email).join(' '))
      .toLowerCase()
      .includes(q.text.toLowerCase())
  )
    return false
  if (
    q.from &&
    !m.from.some((a) => (a.name + a.email).toLowerCase().includes(q.from!.toLowerCase()))
  )
    return false
  if (q.to && !m.to.some((a) => a.email.toLowerCase().includes(q.to!.toLowerCase()))) return false
  if (q.subject && !m.subject.toLowerCase().includes(q.subject.toLowerCase())) return false
  if (q.hasAttachment && !m.hasAttachment) return false
  if (q.after && m.receivedAt < q.after) return false
  if (q.before && m.receivedAt > q.before) return false
  return true
}
const indexing = (account: Account) => !!account.indexing && !account.indexing.complete
function changed() {
  listeners.forEach((fn) => fn({ type: 'changed' }))
}

/* ——— Account setup: simulated locally, nothing leaves the browser ——— */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const emitAccounts = () => {
  const accounts = demoAccounts.map((a) => ({ ...a }))
  listeners.forEach((fn) => fn({ type: 'accounts', accounts }))
  return accounts
}
const demoConnections = new Map<string, { config: ConnectionConfig; remember: boolean }>()
const demoFolderChoices = new Map<string, FolderMappings>()
const imapCandidate = (domain: string, provider?: string): DiscoveryCandidate => ({
  protocol: 'imap',
  source: 'autoconfig',
  incoming: { host: 'imap.' + domain, port: 993, security: 'tls', username: '' },
  outgoing: { host: 'smtp.' + domain, port: 465, security: 'tls', username: '' },
  provider,
})
const providerName = (domain: string) => {
  const base = domain.split('.').slice(-2, -1)[0] || domain
  return base[0].toUpperCase() + base.slice(1) + ' Mail'
}
function configFor(account: Account): ConnectionConfig {
  const saved = demoConnections.get(account.connectionId)
  if (saved) return saved.config
  const domain = account.email.split('@')[1]
  if (account.protocol === 'imap') {
    const candidate = imapCandidate(domain) as Extract<DiscoveryCandidate, { protocol: 'imap' }>
    return {
      protocol: 'imap',
      email: account.email,
      incoming: { ...candidate.incoming, username: account.email },
      outgoing: { ...candidate.outgoing, username: account.email },
      outgoingSameCredentials: true,
    }
  }
  return { protocol: 'jmap', serverUrl: 'https://mail.' + domain, username: account.email }
}
const demoFolders = [
  { path: 'INBOX', name: 'Inbox' },
  { path: 'Sent', name: 'Sent' },
  { path: 'Drafts', name: 'Drafts' },
  { path: 'Archive', name: 'Archive' },
  { path: 'Trash', name: 'Trash' },
  { path: 'Receipts', name: 'Receipts' },
  { path: 'Projects/2026', name: '2026' },
]
/** The server flags Sent, Drafts and Trash; Archive is only a guess by name and Junk is missing. */
function folderReview(choices?: FolderMappings): FolderMappingReview {
  const review: FolderMappingReview = {
    folders: [...demoFolders],
    mappings: {
      sent: { path: 'Sent', source: 'server' },
      drafts: { path: 'Drafts', source: 'server' },
      trash: { path: 'Trash', source: 'server' },
      archive: { path: 'Archive', source: 'name' },
    },
  }
  for (const role of folderRoles) {
    const choice = choices?.[role]
    if (choice === undefined) continue
    if (choice?.create && !review.folders.some((f) => f.path === choice.path))
      review.folders.push({ path: choice.path, name: choice.path })
    review.mappings[role] = choice && { path: choice.path, source: 'user' }
  }
  return review
}
const loginError = 'The server rejected the username or password.'
function demoTest(input: ConnectInput): ConnectionTest {
  const incoming = input.password === 'wrong' ? { ok: false, error: loginError } : { ok: true }
  if (input.config.protocol === 'jmap') return { incoming }
  const outgoingPassword = input.config.outgoingSameCredentials
    ? input.password
    : input.outgoingPassword
  const outgoing =
    outgoingPassword === 'nosmtp' || outgoingPassword === 'wrong'
      ? { ok: false, error: 'The outgoing server rejected the username or password.' }
      : { ok: true }
  return { incoming, outgoing, ...(incoming.ok ? { folders: folderReview() } : {}) }
}

/* ——— Sending status: one example of each state that needs attention ——— */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const submissionDrafts = new Map<string, Draft>()
function sampleDraft(
  accountIndex: number,
  subject: string,
  to: Message['to'],
  text: string,
): Draft {
  return {
    id: crypto.randomUUID(),
    accountId: demoAccounts[accountIndex].id,
    identityId: 'identity',
    to,
    cc: [],
    bcc: [],
    subject,
    html: '<p>' + text + '</p>',
    text,
    attachments: [],
    updatedAt: new Date().toISOString(),
    status: 'sent',
  }
}
let submissions: SubmissionSummary[] = (() => {
  const filed = sampleDraft(
    0,
    'Quarterly figures',
    [{ name: 'Maya Chen', email: 'maya.chen@gmail.com' }],
    'Here are the figures we talked about.',
  )
  const partial = sampleDraft(
    1,
    'Studio schedule for October',
    [
      { name: 'Lena Weber', email: 'lena.weber@fastmail.com' },
      { name: 'Jonas', email: 'jonas@studio-archive.example' },
    ],
    'The October schedule is attached. Let me know if anything clashes.',
  )
  const uncertain = sampleDraft(
    2,
    'Re: Final files',
    [{ name: 'Daniel Fischer', email: 'daniel.fischer@outlook.com' }],
    'Thanks, everything arrived. I’ll send feedback tomorrow.',
  )
  for (const draft of [filed, partial, uncertain]) submissionDrafts.set(draft.id, draft)
  return [
    {
      draftId: filed.id,
      accountId: filed.accountId,
      subject: filed.subject,
      at: minutesAgo(18),
      state: 'sent',
      sentCopy: 'failed',
      error: 'The Sent folder is over its storage quota.',
    },
    {
      draftId: partial.id,
      accountId: partial.accountId,
      subject: partial.subject,
      at: minutesAgo(42),
      state: 'partial',
      rejected: [{ name: 'Jonas', email: 'jonas@studio-archive.example' }],
    },
    {
      draftId: uncertain.id,
      accountId: uncertain.accountId,
      subject: uncertain.subject,
      at: minutesAgo(95),
      state: 'uncertain',
    },
  ]
})()
const emitSubmissions = () =>
  listeners.forEach((fn) => fn({ type: 'submissions', submissions: [...submissions] }))
const submissionFor = (draftId: string) => {
  const found = submissions.find((s) => s.draftId === draftId)
  if (!found) throw new Error('This send is no longer tracked.')
  return found
}
const copyOf = (source: Draft, patch: Partial<Draft>): Draft => ({
  ...source,
  id: crypto.randomUUID(),
  status: 'local',
  updatedAt: new Date().toISOString(),
  ...patch,
})
export const demoAPI: DesktopMailAPI = {
  updateStatus: async () => ({ phase: 'idle' }),
  bootstrap: async () => ({
    accounts: demoAccounts,
    settings,
    secureStorage: false,
    demo: true,
    version: '0.1.0',
  }),
  discover: async (email) => {
    await pause(700)
    const address = email.trim().toLowerCase()
    const domain = address.split('@')[1] || ''
    // Try “@fastmail.com” for JMAP, “@nothing.test” for no result, anything else for IMAP.
    const candidates: DiscoveryCandidate[] = /(^|\.)(fastmail\.com|jmap\.test)$/.test(domain)
      ? [
          {
            protocol: 'jmap',
            source: 'jmap-well-known',
            serverUrl: 'https://api.' + domain + '/jmap/session',
            username: address,
          },
          imapCandidate(domain, 'Fastmail'),
        ]
      : /(^|\.)nothing\.test$/.test(domain)
        ? []
        : [imapCandidate(domain, providerName(domain))]
    return {
      email: address,
      domain,
      candidates: candidates.map((c) =>
        c.protocol === 'imap'
          ? {
              ...c,
              incoming: { ...c.incoming, username: address },
              outgoing: { ...c.outgoing, username: address },
            }
          : c,
      ),
    }
  },
  testConnection: async (input) => {
    await pause(900)
    return demoTest(input)
  },
  connect: async (input) => {
    await pause(600)
    const test = demoTest(input)
    if (!test.incoming.ok) throw new Error(test.incoming.error)
    if (test.outgoing && !test.outgoing.ok) throw new Error(test.outgoing.error)
    const email = input.config.protocol === 'imap' ? input.config.email : input.config.username
    const existing = demoAccounts.find((a) => a.connectionId === input.connectionId)
    // Demo only: the account is added in memory and shows the same sample mail as the others.
    const account: Account = existing || {
      id: accountKey('demo-added-' + demoAccounts.length, 'mail'),
      connectionId: 'demo-added-' + demoAccounts.length,
      remoteId: 'mail',
      name: '',
      email,
      color: nextAccountColor(demoAccounts.map((a) => a.color)),
      status: 'connected',
    }
    Object.assign(account, {
      name: input.name.trim() || existing?.name || email.split('@')[1].split('.')[0],
      senderName: input.senderName?.trim() || undefined,
      protocol: input.config.protocol,
      status: 'connected',
      error: undefined,
      outgoingError: undefined,
      sessionOnly: !input.remember,
    })
    if (!existing) demoAccounts.push(account)
    demoConnections.set(account.connectionId, { config: input.config, remember: input.remember })
    if (input.folders) demoFolderChoices.set(account.id, input.folders)
    return emitAccounts()
  },
  connectionSettings: async (connectionId) => {
    const account = demoAccounts.find((a) => a.connectionId === connectionId)
    if (!account) throw new Error('This connection no longer exists.')
    return {
      connectionId,
      name: account.name,
      config: configFor(account),
      remember: demoConnections.get(connectionId)?.remember ?? !account.sessionOnly,
      folders: demoFolderChoices.get(account.id),
    }
  },
  folderMappings: async (accountId) => {
    const account = demoAccounts.find((a) => a.id === accountId)
    if (account?.protocol !== 'imap') throw new Error('This account manages its folders itself.')
    await pause(300)
    return folderReview(demoFolderChoices.get(accountId))
  },
  setFolderMappings: async (accountId, mappings) => {
    await pause(300)
    demoFolderChoices.set(accountId, { ...demoFolderChoices.get(accountId), ...mappings })
    return folderReview(demoFolderChoices.get(accountId))
  },
  disconnect: async () => {},
  reconnect: async () => {},
  updateAccount: async (accountId, appearance) => {
    const account = demoAccounts.find((a) => a.id === accountId)
    if (!account) throw new Error('Account not found.')
    account.seed = appearance.seed
    account.image = appearance.image
    const accounts = demoAccounts.map((a) => ({ ...a }))
    listeners.forEach((fn) => fn({ type: 'accounts', accounts }))
    return accounts
  },
  updateAccountDetails: async (accountId, details) => {
    const account = demoAccounts.find((a) => a.id === accountId)
    if (!account) throw new Error('Account not found.')
    account.name = details.name.trim() || account.name
    account.senderName = details.senderName.trim() || undefined
    const accounts = demoAccounts.map((a) => ({ ...a }))
    listeners.forEach((fn) => fn({ type: 'accounts', accounts }))
    return accounts
  },
  mailboxes: async (accountId) => {
    if (!folders.has(accountId))
      folders.set(
        accountId,
        ['inbox', 'archive', 'sent', 'drafts', 'junk', 'trash', 'Receipts', 'Projects'].map(
          (name, i) => ({
            id: name,
            name: name[0].toUpperCase() + name.slice(1),
            accountId,
            parentId: null,
            role: i < 6 ? name : null,
            unreadEmails: i === 0 ? 3 : 0,
            totalEmails: i === 0 ? perAccount : i === 3 ? 0 : 8,
            rights,
          }),
        ),
      )
    const accountIndex = demoAccounts.findIndex((a) => a.id === accountId)
    let unreadCount = accountIndex < 3 ? 3 : 0
    for (const [key, current] of changes) {
      const [changedAccount, index] = key.split(':').map(Number)
      if (changedAccount !== accountIndex) continue
      unreadCount -= Number(accountIndex < 3 && index < 3)
      unreadCount += Number(!!current?.mailboxIds.inbox && !current.keywords.$seen)
    }
    return folders
      .get(accountId)!
      .map((box) => (box.role === 'inbox' ? { ...box, unreadEmails: unreadCount } : box))
  },
  identities: async (id) => [
    {
      id: 'identity',
      accountId: id,
      name: demoAccounts.find((a) => a.id === id)!.senderName || 'Paul',
      email: demoAccounts.find((a) => a.id === id)!.email,
    },
  ],
  query: async (query, cursor) => {
    const pages = demoAccounts.flatMap((account, accountIndex) => {
      if (
        (query.accountId && query.accountId !== account.id) ||
        (cursor && !(account.id in cursor))
      )
        return []
      const position = cursor?.[account.id] || 0
      if (
        stress &&
        ['inbox', 'all'].includes(query.view) &&
        !Object.entries(query).some(
          ([key, value]) => !['view', 'accountId'].includes(key) && value !== undefined,
        )
      ) {
        const removed = [...changes]
          .filter(([key, m]) => key.startsWith(accountIndex + ':') && (!m || !matches(m, query)))
          .map(([key]) => Number(key.split(':')[1]))
          .sort((a, b) => a - b)
        let index = position
        for (const excluded of removed) if (excluded <= index) index++
        const omitted = new Set(removed),
          items = []
        while (index < perAccount && items.length < 50) {
          const current = index++
          if (omitted.has(current)) continue
          const m = get(accountIndex, current, false)
          if (m) items.push(conversationFromMessages(account.id, m.threadId, [m]))
        }
        const total = perAccount - removed.length
        return [
          {
            accountId: account.id,
            position,
            page: {
              items,
              total,
              next: position + 50 < total ? position + 50 : undefined,
              incomplete: indexing(account),
            },
          },
        ]
      }
      const selected: Message[] = []
      let total = 0
      for (let index = 0; index < perAccount; index++) {
        const m = get(accountIndex, index, false)
        if (!m || !matches(m, query)) continue
        if (total >= position && selected.length < 50) selected.push(m)
        total++
      }
      return [
        {
          accountId: account.id,
          position,
          page: {
            items: selected.map((m) => ({
              ...conversationFromMessages(account.id, m.threadId, [m]),
              count: 1,
            })),
            total,
            next: position + 50 < total ? position + 50 : undefined,
            incomplete: indexing(account),
          },
        },
      ]
    })
    return mergePages(pages, 50)
  },
  conversation: async (accountId, threadId) => {
    const accountIndex = demoAccounts.findIndex((a) => a.id === accountId)
    const m = get(accountIndex, Number(threadId.replace('thread-', '')))
    if (!m) throw new Error('Conversation not found.')
    return [m]
  },
  mutate: async (input) => {
    const saved: [string, Message | null | undefined][] = []
    for (const target of input.targets) {
      const accountIndex = demoAccounts.findIndex((a) => a.id === target.accountId),
        index = Number(target.threadId.replace('thread-', ''))
      const key = accountIndex + ':' + index,
        m = get(accountIndex, index)
      if (!m) continue
      saved.push([key, changes.get(key)])
      const next = structuredClone(m)
      if (input.action === 'read') next.keywords.$seen = true
      if (input.action === 'unread') delete next.keywords.$seen
      if (input.action === 'star') next.keywords.$flagged = true
      if (input.action === 'unstar') delete next.keywords.$flagged
      const destination = (
        {
          archive: 'archive',
          trash: 'trash',
          spam: 'junk',
          restore: 'inbox',
          notSpam: 'inbox',
          move: input.mailboxId,
        } as Record<string, string | undefined>
      )[input.action]
      if (destination) next.mailboxIds = { [destination]: true }
      changes.set(key, input.action === 'destroy' ? null : next)
    }
    changed()
    // Like the desktop service, a permanent deletion has nothing to undo.
    if (input.action === 'destroy') return { changed: saved.length, failures: [] }
    const undoId = crypto.randomUUID()
    undoStack.set(undoId, saved)
    return { changed: saved.length, failures: [], undoId }
  },
  mutateAll: async (query, action) => {
    const targets: MutationInput['targets'] = []
    let cursor: Record<string, number> | undefined
    do {
      const page = await demoAPI.query(query, cursor)
      targets.push(...page.items.map((c) => ({ accountId: c.accountId, threadId: c.id })))
      cursor = page.next
    } while (cursor)
    return demoAPI.mutate({ targets, action })
  },
  undo: async (id) => {
    const entries = undoStack.get(id) || []
    for (const [key, value] of entries) {
      if (value === undefined) changes.delete(key)
      else changes.set(key, value)
    }
    changed()
    return { changed: entries.length, failures: [] }
  },
  folder: async (input) => {
    await demoAPI.mailboxes(input.accountId)
    const boxes = folders.get(input.accountId)!
    if (input.operation === 'create')
      boxes.push({
        id: crypto.randomUUID(),
        name: input.name!,
        accountId: input.accountId,
        parentId: input.parentId || null,
        role: null,
        unreadEmails: 0,
        totalEmails: 0,
        rights,
      })
    if (input.operation === 'rename') {
      const b = boxes.find((b) => b.id === input.id)
      if (b) b.name = input.name!
    }
    if (input.operation === 'delete')
      folders.set(
        input.accountId,
        boxes.filter((b) => b.id !== input.id),
      )
    changed()
  },
  resumeDraft: async () => {
    throw new Error('No server draft is available.')
  },
  stageRemoteAttachments: async () => [],
  drafts: async () => [...drafts.values()],
  saveDraft: async (draft) => {
    drafts.set(draft.id, draft)
    return draft
  },
  syncDraft: async (draft) => {
    const result = { ...draft, status: 'synced' as const }
    drafts.set(draft.id, result)
    return result
  },
  deleteDraft: async (id) => {
    drafts.delete(id)
    changed()
  },
  deleteServerDraft: async (accountId, messageId) => {
    const accountIndex = demoAccounts.findIndex((a) => a.id === accountId)
    changes.set(accountIndex + ':' + messageId.replace('message-', ''), null)
    changed()
  },
  send: async (draft) => {
    await pause(500)
    // Recipient addresses choose an outcome, so every result can be reviewed without a server.
    const recipients = [...draft.to, ...draft.cc, ...draft.bcc]
    const has = (word: string) => recipients.some((a) => a.email.toLowerCase().includes(word))
    if (has('nologin')) {
      drafts.set(draft.id, {
        ...draft,
        status: 'error',
        error: 'The outgoing server rejected the username or password.',
        errorKind: 'outgoingAuthentication',
      })
      throw new Error('The outgoing server rejected the username or password. Nothing was sent.')
    }
    if (has('unconfirmed')) {
      drafts.set(draft.id, { ...draft, status: 'uncertain' })
      submissionDrafts.set(draft.id, draft)
      submissions = [
        {
          draftId: draft.id,
          accountId: draft.accountId,
          subject: draft.subject,
          at: new Date().toISOString(),
          state: 'uncertain',
        },
        ...submissions,
      ]
      emitSubmissions()
      return {
        status: 'uncertain',
        message: 'Delivery is not confirmed. Your draft is safe. Check status before trying again.',
      }
    }
    drafts.delete(draft.id)
    // Record the outcome before announcing the change, as the desktop app does.
    queueMicrotask(changed)
    if (has('refused')) {
      const rejected = recipients.filter((a) => a.email.toLowerCase().includes('refused'))
      submissionDrafts.set(draft.id, draft)
      submissions = [
        {
          draftId: draft.id,
          accountId: draft.accountId,
          subject: draft.subject,
          at: new Date().toISOString(),
          state: 'partial',
          rejected,
        },
        ...submissions,
      ]
      emitSubmissions()
      return { status: 'partial', message: 'Sent to some recipients.', rejected, sentCopy: 'filed' }
    }
    if (has('nocopy')) {
      submissions = [
        {
          draftId: draft.id,
          accountId: draft.accountId,
          subject: draft.subject,
          at: new Date().toISOString(),
          state: 'sent',
          sentCopy: 'pending',
        },
        ...submissions,
      ]
      emitSubmissions()
      return { status: 'sent', message: 'Message sent. Sent copy pending.', sentCopy: 'pending' }
    }
    return { status: 'sent', message: 'Demo · no email was sent.', sentCopy: 'filed' }
  },
  reconcile: async (draftId) => {
    await pause(600)
    const submission = submissions.find((s) => s.draftId === draftId)
    if (submission?.state === 'uncertain')
      return {
        status: 'uncertain',
        message:
          'Delivery is still unconfirmed. Check Sent or the server before creating a replacement message.',
      }
    return { status: 'sent', message: 'This message has already been sent.' }
  },
  submissions: async () => [...submissions],
  retrySentCopy: async (draftId) => {
    await pause(500)
    submissionFor(draftId)
    submissions = submissions.filter((s) => s.draftId !== draftId)
    emitSubmissions()
    return { status: 'sent', message: 'Copy saved to Sent.', sentCopy: 'filed' }
  },
  recoverRejected: async (draftId) => {
    const submission = submissionFor(draftId)
    const source = submissionDrafts.get(draftId)
    if (submission.state !== 'partial' || !source)
      throw new Error('There are no refused recipients to recover for this message.')
    const refused = new Set(submission.rejected?.map((a) => a.email.toLowerCase()))
    const only = (list: Draft['to']) => list.filter((a) => refused.has(a.email.toLowerCase()))
    const recovery = copyOf(source, {
      to: only(source.to),
      cc: only(source.cc),
      bcc: only(source.bcc),
    })
    drafts.set(recovery.id, recovery)
    submissions = submissions.filter((s) => s.draftId !== draftId)
    emitSubmissions()
    changed()
    return recovery
  },
  replaceUncertain: async (draftId) => {
    const submission = submissionFor(draftId)
    const source = submissionDrafts.get(draftId)
    if (submission.state !== 'uncertain' || !source)
      throw new Error('Only an unconfirmed message can be replaced.')
    const replacement = copyOf(source, {})
    drafts.set(replacement.id, replacement)
    changed()
    return replacement
  },
  dismissSubmission: async (draftId) => {
    submissions = submissions.filter((s) => s.draftId !== draftId)
    const draft = drafts.get(draftId)
    if (draft?.status === 'uncertain') drafts.delete(draftId)
    emitSubmissions()
    changed()
  },
  stageAttachments: async () => {
    throw new Error('Native file attachments are available in the desktop app.')
  },
  attachment: async () => {
    throw new Error('Attachment downloads require the desktop app.')
  },
  inlineImage: async () => '',
  remoteImage: async () => '',
  senderAvatar: async (email) => {
    if (!settings.remoteImages) return null
    // Medium's fetched icon can render as an empty dark tile; show the sender initial instead.
    if (email.trim().toLowerCase() === 'digest@medium.com') return null
    try {
      if (window.mail) return window.mail.senderAvatar(email)
      const response = await fetch(`/__demo/avatar?email=${encodeURIComponent(email)}`, {
        credentials: 'omit',
      })
      if (!response.ok) return null
      const result: { image: string | null } = await response.json()
      return result.image
    } catch {
      return null
    }
  },
  unsubscribe: async () => {
    await pause(1200)
    return { kind: 'done' }
  },
  openExternal: async (url) => {
    if (/^https?:/.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
  },
  settings: async (value) => {
    settings = value
    return value
  },
  diagnostics: async () =>
    JSON.stringify({ mode: 'demo', message: 'Mail data is generated locally.' }, null, 2),
  ready: async () => {},
  onEvent: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
