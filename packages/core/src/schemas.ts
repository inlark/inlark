import { z } from 'zod'
import type { DesktopMailAPI } from './model'

const id = z.string().min(1).max(2048)
const address = z.object({ name: z.string().max(1000), email: z.string().max(320) })
export const serverUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value)
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    )
  }, 'Use HTTPS, or HTTP on localhost for development.')
/** A DNS name, IPv4 address, or IPv6 address. Never a URL, so no scheme or path can sneak in. */
export const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a server name.')
  .max(253)
  .refine(
    (value) =>
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/.test(value) ||
      /^\[?[0-9a-f:]+(:\d{1,3}(\.\d{1,3}){3})?\]?$/.test(value),
    'Enter a server name such as imap.example.com, without https:// or a port.',
  )
export const trustedCertificateSchema = z.object({
  sha256: z.string().regex(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/),
  pem: z
    .string()
    .max(16_384)
    .regex(/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/),
})
export const serverSettingsSchema = z.object({
  host: hostSchema,
  port: z.number().int().min(1, 'Enter a port.').max(65535, 'Enter a port up to 65535.'),
  security: z.enum(['tls', 'starttls']),
  username: z.string().min(1, 'Enter a username.').max(320),
  certificate: trustedCertificateSchema.optional(),
})
export const connectionConfigSchema = z.discriminatedUnion('protocol', [
  z.object({
    protocol: z.literal('jmap'),
    serverUrl: serverUrlSchema,
    username: z.string().min(1, 'Enter a username.').max(320),
  }),
  z.object({
    protocol: z.literal('imap'),
    email: z.email('Enter a valid email address.').max(320),
    incoming: serverSettingsSchema,
    outgoing: serverSettingsSchema,
    outgoingSameCredentials: z.boolean(),
  }),
])
const folderRole = z.enum(['sent', 'drafts', 'archive', 'junk', 'trash'])
export const folderMappingsSchema = z.partialRecord(
  folderRole,
  z.object({ path: z.string().min(1).max(1024), create: z.boolean().optional() }).nullable(),
)
export const accountSchema = z
  .object({
    config: connectionConfigSchema,
    password: z.string().min(1, 'Enter your password.').max(4096),
    outgoingPassword: z.string().min(1).max(4096).optional(),
    name: z.string().max(100),
    senderName: z.string().max(100).optional(),
    remember: z.boolean(),
    connectionId: id.optional(),
    folders: folderMappingsSchema.optional(),
  })
  .refine(
    (input) =>
      input.config.protocol !== 'imap' ||
      input.config.outgoingSameCredentials ||
      !!input.outgoingPassword,
    { message: 'Enter the outgoing server password.', path: ['outgoingPassword'] },
  )
export const accountDetailsSchema = z.object({
  name: z.string().max(100),
  senderName: z.string().max(100),
})
export const appearanceSchema = z.object({
  seed: z.string().min(1).max(64).optional(),
  image: z
    .string()
    .max(256 * 1024)
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i)
    .optional(),
})
export const querySchema = z.object({
  view: z.enum(['inbox', 'starred', 'archive', 'sent', 'drafts', 'junk', 'trash', 'all']),
  accountId: id.optional(),
  mailboxId: id.optional(),
  text: z.string().max(2000).optional(),
  from: z.string().max(320).optional(),
  to: z.string().max(320).optional(),
  subject: z.string().max(1000).optional(),
  after: z.string().max(40).optional(),
  before: z.string().max(40).optional(),
  hasAttachment: z.boolean().optional(),
  unread: z.boolean().optional(),
})
export const actionSchema = z.enum([
  'archive',
  'trash',
  'restore',
  'spam',
  'notSpam',
  'read',
  'unread',
  'star',
  'unstar',
  'move',
  'destroy',
])
export const mutationSchema = z.object({
  targets: z.array(z.object({ accountId: id, threadId: id })).max(500),
  action: actionSchema,
  mailboxId: id.optional(),
})
export const attachmentSchema = z.object({
  blobId: id,
  name: z.string().max(1024),
  type: z.string().max(256),
  size: z.number().nonnegative(),
  cid: z.string().optional(),
  disposition: z.string().optional(),
})
export const stagedSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(1024),
  type: z.string().max(256),
  size: z.number().nonnegative(),
  blobId: id.optional(),
  cid: z.string().optional(),
})
export const draftSchema = z.object({
  id: z.string().uuid(),
  accountId: id,
  identityId: id,
  to: z.array(address).max(200),
  cc: z.array(address).max(200),
  bcc: z.array(address).max(200),
  subject: z.string().max(998),
  html: z.string().max(5_000_000),
  text: z.string().max(5_000_000),
  attachments: z.array(stagedSchema).max(100),
  updatedAt: z.string().datetime(),
  inReplyTo: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  replyThreadId: id.optional(),
  serverId: id.optional(),
  serverFingerprint: z.string().optional(),
  status: z.enum(['local', 'saving', 'synced', 'error', 'sending', 'uncertain', 'sent']),
  error: z.string().optional(),
  errorKind: z
    .enum(['conflict', 'connection', 'outgoingAuthentication', 'certificate', 'rejected'])
    .optional(),
})
export const sendDraftSchema = draftSchema
  .refine(
    (d) =>
      [...d.to, ...d.cc, ...d.bcc].length > 0 &&
      [...d.to, ...d.cc, ...d.bcc].every(
        (a) => z.email().safeParse(a.email).success && !/[\r\n]/.test(a.name),
      ),
    'Add valid recipients before sending.',
  )
  .refine((d) => !/[\r\n]/.test(d.subject), 'The subject must be a single line.')
export const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  remoteImages: z.boolean(),
  notifications: z.boolean(),
  closeToTray: z.boolean(),
  defaultAccountId: id.optional(),
  signatures: z.record(z.string(), z.string().max(100_000)),
  htmlSignatures: z.record(z.string(), z.boolean()).optional(),
  afterArchive: z.enum(['next', 'previous', 'list']).optional(),
  shortcuts: z
    .record(z.string().max(64), z.array(z.array(z.string().min(1).max(64)).min(1).max(4)).max(16))
    .optional(),
})
export const ipcSchemas = {
  bootstrap: z.tuple([]),
  updateStatus: z.tuple([]),
  ready: z.tuple([]),
  discover: z.tuple([z.string().trim().toLowerCase().pipe(z.email().max(320))]),
  testConnection: z.tuple([accountSchema]),
  connect: z.tuple([accountSchema]),
  connectionSettings: z.tuple([id]),
  folderMappings: z.tuple([id]),
  setFolderMappings: z.tuple([id, folderMappingsSchema]),
  disconnect: z.tuple([id]),
  reconnect: z.tuple([id]),
  updateAccount: z.tuple([id, appearanceSchema]),
  updateAccountDetails: z.tuple([id, accountDetailsSchema]),
  mailboxes: z.tuple([id]),
  identities: z.tuple([id]),
  query: z.tuple([querySchema, z.record(z.string(), z.number().int().nonnegative()).optional()]),
  conversation: z.tuple([id, id]),
  mutate: z.tuple([mutationSchema]),
  mutateAll: z.tuple([querySchema, actionSchema]),
  undo: z.tuple([id]),
  folder: z.tuple([
    z.object({
      accountId: id,
      operation: z.enum(['create', 'rename', 'delete']),
      id: id.optional(),
      name: z.string().trim().min(1).max(255).optional(),
      parentId: id.optional(),
    }),
  ]),
  resumeDraft: z.tuple([id, id]),
  stageRemoteAttachments: z.tuple([id, z.array(attachmentSchema).max(100)]),
  drafts: z.tuple([]),
  saveDraft: z.tuple([draftSchema]),
  syncDraft: z.tuple([draftSchema]),
  deleteDraft: z.tuple([z.string().uuid()]),
  deleteServerDraft: z.tuple([id, id]),
  send: z.tuple([sendDraftSchema]),
  reconcile: z.tuple([z.string().uuid()]),
  submissions: z.tuple([]),
  retrySentCopy: z.tuple([z.string().uuid()]),
  recoverRejected: z.tuple([z.string().uuid()]),
  replaceUncertain: z.tuple([z.string().uuid()]),
  dismissSubmission: z.tuple([z.string().uuid()]),
  stageAttachments: z.tuple([]),
  attachment: z.tuple([id, attachmentSchema, z.boolean()]),
  inlineImage: z.tuple([id, attachmentSchema]),
  remoteImage: z.tuple([z.string().url().max(8192)]),
  senderAvatar: z.tuple([z.string().trim().email().max(320)]),
  unsubscribe: z.tuple([id, id]),
  openExternal: z.tuple([z.string().max(8192)]),
  settings: z.tuple([settingsSchema]),
  diagnostics: z.tuple([]),
} satisfies Record<Exclude<keyof DesktopMailAPI, 'onEvent'>, z.ZodType>
