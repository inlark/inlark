import { cn } from '@inlark/ui'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LockKeyhole,
  PenLine,
  ShieldCheck,
  ShieldX,
  X as Cross,
} from '@inlark/ui/icons'
import { Button, Checkbox, Spinner } from '@inlark/ui'
import {
  accountSchema,
  friendlyError,
  type Account,
  type Bootstrap,
  type CertificateDetails,
  type CertificateProblem,
  type ConnectInput,
  type ConnectionCheck,
  type ConnectionConfig,
  type ConnectionSettings,
  type ConnectionTest,
  type DiscoveryCandidate,
  type DiscoveryResult,
  type DiscoverySource,
  type FolderMappingReview,
  type FolderMappings,
  type Protocol,
  type ServerSettings,
  type TransportSecurity,
  type TrustedCertificate,
} from '@inlark/core'
import { api, isDemo } from './api'
import { queryClient } from './cache'
import { SegmentedControl } from './SegmentedControl'
import { FolderMappingEditor, initialFolderChoices, needsFolderReview } from './FolderMappings'

/** `signIn` repeats a saved connection's login; `edit` opens its server settings for changes. */
export type SetupMode = 'add' | 'signIn' | 'edit'
type ServerKind = 'incoming' | 'outgoing'
type ServerFields = {
  host: string
  port: string
  security: TransportSecurity
  certificate?: TrustedCertificate
}
interface Fields {
  protocol: Protocol
  serverUrl: string
  incoming: ServerFields
  outgoing: ServerFields
  username: string
  outgoingUsername: string
  sameLogin: boolean
}
/** Where the settings on screen came from, so the user can judge them before signing in. */
type Origin = { kind: 'candidate'; index: number } | { kind: 'saved' } | { kind: 'manual' }

const defaultPorts = {
  incoming: { tls: 993, starttls: 143 },
  outgoing: { tls: 465, starttls: 587 },
} as const
const securityOptions = [
  { value: 'tls', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
] as const
const protocolOptions = [
  { value: 'imap', label: 'IMAP and SMTP' },
  { value: 'jmap', label: 'JMAP' },
] as const
const securityLabel = { tls: 'SSL/TLS', starttls: 'STARTTLS' } as const
const sourceLabels: Record<DiscoverySource, string> = {
  'jmap-srv': 'Found in the domain’s DNS records',
  'jmap-well-known': 'Found at the domain’s JMAP address',
  autoconfig: 'From the domain’s published configuration',
  'imap-srv': 'Found in the domain’s DNS records',
  directory: 'From a public directory of mail providers',
}
const sourceLabel = (candidate: DiscoveryCandidate) =>
  candidate.protocol === 'imap' && candidate.provider && candidate.source !== 'directory'
    ? 'From ' + candidate.provider + '’s published configuration'
    : sourceLabels[candidate.source]

const blankServer = (kind: ServerKind): ServerFields => ({
  host: '',
  port: String(defaultPorts[kind].tls),
  security: 'tls',
})
const blankFields = (email: string): Fields => ({
  protocol: 'imap',
  serverUrl: '',
  incoming: blankServer('incoming'),
  outgoing: blankServer('outgoing'),
  username: email,
  outgoingUsername: email,
  sameLogin: true,
})
function fieldsFrom(source: ConnectionConfig | DiscoveryCandidate, email: string): Fields {
  if (source.protocol === 'jmap')
    return {
      ...blankFields(email),
      protocol: 'jmap',
      serverUrl: source.serverUrl,
      username: source.username || email,
      outgoingUsername: source.username || email,
    }
  const server = (s: ServerSettings): ServerFields => ({
    host: s.host,
    port: String(s.port),
    security: s.security,
    ...(s.certificate ? { certificate: s.certificate } : {}),
  })
  const username = source.incoming.username || email
  const outgoingUsername = source.outgoing.username || username
  return {
    protocol: 'imap',
    serverUrl: '',
    incoming: server(source.incoming),
    outgoing: server(source.outgoing),
    username,
    outgoingUsername,
    sameLogin:
      'outgoingSameCredentials' in source
        ? source.outgoingSameCredentials
        : outgoingUsername === username,
  }
}
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const candidateTitle = (c: DiscoveryCandidate) =>
  c.protocol === 'jmap' ? hostOf(c.serverUrl) : c.provider || c.incoming.host
const emailSchema = z.email()

function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <label
      className={cn(
        "form-field mt-3.75 [&_input]:mt-1.5 [&_input]:text-[12px] [&_input[aria-invalid='true']]:border-danger/70",
        className,
      )}
    >
      {label}
      <input
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? id : undefined}
        {...props}
      />
      {error ? (
        <span id={id} className="field-error block mt-1.25 text-[11px] text-danger">
          {error}
        </span>
      ) : (
        hint && (
          <span id={id} className="field-hint text-muted text-[11px] block mt-1.25">
            {hint}
          </span>
        )
      )}
    </label>
  )
}

function CheckRow({
  label,
  host,
  check,
  pending,
}: {
  label: string
  host: string
  check?: ConnectionCheck
  pending: boolean
}) {
  return (
    <li
      className={cn(
        'connection-check grid grid-cols-[16px_64px_minmax(0,_auto)_minmax(0,_1fr)] gap-2.5 items-baseline py-2.5 px-3.5',
        'text-[12px] [&+.connection-check]:border-t [&+.connection-check]:border-solid',
        '[&+.connection-check]:border-t-border [&_strong]:font-medium [&.ok_.connection-check-icon]:text-success',
        '[&.ok_.connection-check-result]:text-success [&.failed_.connection-check-icon]:text-danger',
        '[&.failed_.connection-check-result]:text-danger',
        check ? (check.ok ? 'ok' : 'failed') : 'pending',
      )}
    >
      <span className="connection-check-icon flex self-center text-muted">
        {check ? (
          check.ok ? (
            <Check size={13} />
          ) : (
            <Cross size={13} />
          )
        ) : pending ? (
          <Spinner size={12} />
        ) : null}
      </span>
      <strong>{label}</strong>
      <span className="connection-check-host text-muted overflow-hidden text-ellipsis whitespace-nowrap">
        {host}
      </span>
      <span className="connection-check-result text-muted leading-[1.5]">
        {check
          ? check.ok
            ? 'Signed in'
            : check.certificate
              ? 'Stopped before signing in: ' +
                problemTitles[check.certificate.problem].toLowerCase()
              : check.error || 'Sign-in failed'
          : pending
            ? 'Checking…'
            : 'Not checked'}
      </span>
    </li>
  )
}

const problemTitles: Record<CertificateProblem, string> = {
  selfSigned: 'Self-signed certificate',
  unknownIssuer: 'Certificate from an unknown authority',
  otherName: 'Certificate for another server name',
  changed: 'Certificate changed',
  expired: 'Certificate expired',
  notYetValid: 'Certificate not valid yet',
}
const certificateDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const isLocal = (host: string) => /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i.test(host)
/** Long enough to recognize, short enough for one line. */
const shortFingerprint = (sha256: string) => sha256.slice(0, 11) + '…' + sha256.slice(-11)

function certificateExplanation(certificate: CertificateDetails, host: string) {
  const local = isLocal(host)
  const intercepted = 'but it could also mean someone is intercepting the connection.'
  switch (certificate.problem) {
    case 'selfSigned':
      return (
        'No certificate authority vouches for it. ' +
        (local
          ? 'That’s normal for a bridge on this computer, such as Proton Mail Bridge.'
          : 'That’s common for self-hosted servers, ' + intercepted)
      )
    case 'unknownIssuer':
      return (
        'It’s issued by ' +
        certificate.issuer +
        ', an authority this computer doesn’t trust. ' +
        (local
          ? 'That’s normal for a server on this computer.'
          : 'That’s common on private networks, ' + intercepted)
      )
    case 'otherName':
      return (
        'It’s issued for ' +
        (certificate.names.join(', ') || certificate.subject) +
        ', not ' +
        host +
        '. If one of those names is your server, use it instead.'
      )
    case 'changed':
      return (
        'It isn’t the certificate you trusted before. ' +
        (local
          ? 'That’s expected after the bridge is reinstalled or reset.'
          : 'That’s expected after the certificate is renewed, ' + intercepted)
      )
    case 'expired':
      return (
        'It expired on ' +
        certificateDate.format(new Date(certificate.validTo)) +
        ', so it can’t be trusted. Renew it on the server, then try again.'
      )
    case 'notYetValid':
      return (
        'It isn’t valid until ' +
        certificateDate.format(new Date(certificate.validFrom)) +
        '. Check that this computer’s date and time are correct.'
      )
  }
}

/** A certificate that stopped the connection check, with what the user needs to judge it. */
function CertificateReview({
  certificate,
  host,
  servers,
  action,
  disabled,
  onTrust,
}: {
  certificate: CertificateDetails
  host: string
  servers: ServerKind[]
  action: string
  disabled: boolean
  onTrust: () => void
}) {
  const trustable = certificate.problem !== 'expired' && certificate.problem !== 'notYetValid'
  const names = certificate.names.filter((name) => name !== certificate.subject)
  return (
    <div className="certificate-review mt-3 pt-3 pb-3.5 px-3.5 border border-solid border-border-strong rounded-lg bg-field text-[12px]">
      <div className="flex items-start gap-2.5">
        <ShieldX size={15} className="shrink-0 mt-[1px] text-danger" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-[2px_10px]">
            <strong className="font-medium text-strong">
              {problemTitles[certificate.problem]}
            </strong>
            <span className="text-[11px] text-muted">
              {host} ·{' '}
              {servers.length > 1
                ? 'incoming and outgoing'
                : servers[0] === 'incoming'
                  ? 'incoming'
                  : 'outgoing'}
            </span>
          </div>
          <p className="mt-1 mb-0 mx-0 text-secondary leading-[1.6]">
            {certificateExplanation(certificate, host)}
          </p>
        </div>
      </div>
      <dl
        className={cn(
          'certificate-details [&>div]:grid [&>div]:grid-cols-[92px_minmax(0,_1fr)] [&>div]:gap-3 [&>div]:py-1.5',
          '[&_dt]:text-muted [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-foreground [&_dd]:[overflow-wrap:anywhere]',
          'mt-2.5 mb-0 ml-6.25 mr-0 text-[11px]',
        )}
      >
        <div>
          <dt>Issued to</dt>
          <dd>
            {certificate.subject}
            {names.length > 0 && <span className="text-muted"> · {names.join(', ')}</span>}
          </dd>
        </div>
        <div>
          <dt>Issued by</dt>
          <dd>{certificate.issuer}</dd>
        </div>
        <div>
          <dt>Valid</dt>
          <dd className="tabular-nums">
            {certificateDate.format(new Date(certificate.validFrom))} –{' '}
            {certificateDate.format(new Date(certificate.validTo))}
          </dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd className="font-mono text-[10.5px] leading-[1.7] select-all">
            {/* Breaks after 16 of the 32 pairs when it doesn't fit on one line. */}
            {certificate.sha256.slice(0, 48)}
            <wbr />
            {certificate.sha256.slice(48)}
          </dd>
        </div>
      </dl>
      {trustable && (
        <div className="flex items-center gap-3 mt-3 ml-6.25 max-[700px]:flex-col max-[700px]:items-start">
          <p className="flex-1 m-0 text-[11px] text-muted leading-[1.6]">
            Trust it only if you expect it, for example by comparing the fingerprint with the one
            your server or bridge shows. Inlark will accept exactly this certificate and stop if it
            ever changes.
          </p>
          <Button size="small" className="shrink-0" disabled={disabled} onClick={onTrust}>
            <ShieldCheck size={13} />
            {action}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Each certificate that stopped a server, once, with the servers that presented it. */
function certificateReviews(test?: ConnectionTest) {
  const reviews: { certificate: CertificateDetails; servers: ServerKind[] }[] = []
  for (const kind of ['incoming', 'outgoing'] as const) {
    const certificate = test?.[kind]?.certificate
    if (!certificate) continue
    const same = reviews.find((r) => r.certificate.sha256 === certificate.sha256)
    if (same) same.servers.push(kind)
    else reviews.push({ certificate, servers: [kind] })
  }
  return reviews
}

/** The server settings of a discovered or saved configuration, shown before any password is sent. */
function ServerSummary({ fields }: { fields: Fields }) {
  return fields.protocol === 'jmap' ? (
    <dl
      className={cn(
        'server-summary [&>div]:grid [&>div]:grid-cols-[118px_minmax(0,_1fr)] [&>div]:gap-3 [&>div]:py-2 [&>div]:px-0',
        '[&>div+div]:border-t [&>div+div]:border-solid [&>div+div]:border-t-border [&_dt]:text-muted [&_dd]:flex',
        '[&_dd]:flex-wrap [&_dd]:gap-[4px_14px] [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-foreground',
        '[&_dd]:[overflow-wrap:anywhere] m-0 text-[12px]',
      )}
    >
      <div>
        <dt>Server · JMAP</dt>
        <dd>
          <span className="server-host font-medium text-strong">{fields.serverUrl}</span>
        </dd>
      </div>
    </dl>
  ) : (
    <dl
      className={cn(
        'server-summary [&>div]:grid [&>div]:grid-cols-[118px_minmax(0,_1fr)] [&>div]:gap-3 [&>div]:py-2 [&>div]:px-0',
        '[&>div+div]:border-t [&>div+div]:border-solid [&>div+div]:border-t-border [&_dt]:text-muted [&_dd]:flex',
        '[&_dd]:flex-wrap [&_dd]:gap-[4px_14px] [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-foreground',
        '[&_dd]:[overflow-wrap:anywhere] m-0 text-[12px]',
      )}
    >
      {(['incoming', 'outgoing'] as const).map((kind) => (
        <div key={kind}>
          <dt>{kind === 'incoming' ? 'Incoming · IMAP' : 'Outgoing · SMTP'}</dt>
          <dd>
            <span className="server-host font-medium text-strong">{fields[kind].host}</span>
            <span className="server-meta text-secondary tabular-nums">
              Port {fields[kind].port} · {securityLabel[fields[kind].security]}
            </span>
            {fields[kind].certificate && (
              <span
                className="server-certificate inline-flex items-center gap-1.25 text-secondary"
                title={'SHA-256 ' + fields[kind].certificate.sha256}
              >
                <ShieldCheck size={12} className="text-success" />
                Trusted certificate
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AccountSetup({
  bootstrap,
  existing,
  mode = existing ? 'signIn' : 'add',
  onDone,
  onBack,
}: {
  bootstrap: Bootstrap
  existing?: Account
  mode?: SetupMode
  onDone: (message: string) => void
  onBack: () => void
}) {
  const [phase, setPhase] = useState<'email' | 'server' | 'folders'>(existing ? 'server' : 'email')
  const [email, setEmail] = useState(existing?.email || '')
  const [emailError, setEmailError] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discovery, setDiscovery] = useState<DiscoveryResult>()
  const [notice, setNotice] = useState('')
  const [origin, setOrigin] = useState<Origin>({ kind: 'manual' })
  const [editing, setEditing] = useState(mode === 'edit')
  const [fields, setFields] = useState<Fields>(() => blankFields(existing?.email || ''))
  const [password, setPassword] = useState('')
  const [outgoingPassword, setOutgoingPassword] = useState('')
  const [remember, setRemember] = useState(bootstrap.secureStorage)
  const [name, setName] = useState(existing?.name || '')
  const [senderName, setSenderName] = useState(existing?.senderName || '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'testing' | 'connecting'>()
  const [test, setTest] = useState<ConnectionTest>()
  const [review, setReview] = useState<FolderMappingReview>()
  const [choices, setChoices] = useState<FolderMappings>({})
  const pending = useRef<ConnectInput>(undefined)
  const lookup = useRef(0)
  const form = useRef<HTMLFormElement>(null)
  const saved = useQuery({
    queryKey: ['connection-settings', existing?.connectionId],
    queryFn: () => api.connectionSettings(existing!.connectionId),
    enabled: !!existing,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const savedSettings: ConnectionSettings | undefined = saved.data
  useEffect(() => {
    if (!existing) return
    if (savedSettings) {
      const address =
        savedSettings.config.protocol === 'imap' ? savedSettings.config.email : existing.email
      setEmail(address)
      setFields(fieldsFrom(savedSettings.config, address))
      setOrigin({ kind: 'saved' })
      setRemember(savedSettings.remember)
      setName(savedSettings.name || existing.name)
    } else if (saved.isError) {
      // Without saved settings, the user can still enter them again.
      setFields({ ...blankFields(existing.email), protocol: existing.protocol || 'jmap' })
      setEditing(true)
      setNotice('The saved server settings couldn’t be loaded. Enter them again below.')
    }
  }, [savedSettings, saved.isError])
  const loadingSaved = !!existing && saved.isPending
  useEffect(() => {
    // The folder step replaces the focused button, so move focus to its first choice.
    if (phase === 'folders')
      requestAnimationFrame(() => document.getElementById('folder-role-sent')?.focus())
  }, [phase])
  const domain = email.split('@')[1] || 'example.com'
  const candidates = discovery?.candidates || []

  /** Any change invalidates an earlier connection check and the message it produced. */
  const changed = (...keys: string[]) => {
    setTest(undefined)
    setError('')
    if (keys.some((key) => errors[key]))
      setErrors((current) => {
        const next = { ...current }
        for (const key of keys) delete next[key]
        return next
      })
  }
  const update = (patch: Partial<Fields>, ...keys: string[]) => {
    setFields((current) => ({ ...current, ...patch }))
    changed(...keys)
  }
  const updateServer = (kind: ServerKind, patch: Partial<ServerFields>, ...keys: string[]) => {
    setFields((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }))
    changed(...keys.map((key) => 'config.' + kind + '.' + key))
  }
  const setSecurity = (kind: ServerKind, security: TransportSecurity) =>
    setFields((current) => {
      const server = current[kind]
      // Follow the standard port unless the user entered their own.
      const standard =
        !server.port.trim() || Number(server.port) === defaultPorts[kind][server.security]
      return {
        ...current,
        [kind]: {
          ...server,
          security,
          port: standard ? String(defaultPorts[kind][security]) : server.port,
        },
      }
    })
  const choose = (index: number, result = discovery) => {
    const candidate = result?.candidates[index]
    if (!candidate) return
    setOrigin({ kind: 'candidate', index })
    setFields((current) => {
      const next = fieldsFrom(candidate, email.trim())
      // A username the user already typed is kept, since they know their login best.
      return current.username && current.username !== email.trim()
        ? { ...next, username: current.username }
        : next
    })
    setEditing(false)
    setErrors({})
    changed()
  }
  const manual = () => {
    setEditing(true)
    setOrigin({ kind: 'manual' })
    setErrors({})
    changed()
  }
  const findSettings = async () => {
    const address = email.trim().toLowerCase()
    if (!emailSchema.safeParse(address).success) {
      setEmailError('Enter a valid email address.')
      return
    }
    const token = ++lookup.current
    setDiscovering(true)
    setEmailError('')
    setNotice('')
    setError('')
    try {
      const result = await api.discover(address)
      if (token !== lookup.current) return
      setDiscovery(result)
      setEmail(result.email)
      if (result.candidates.length) {
        setFields(fieldsFrom(result.candidates[0], result.email))
        setOrigin({ kind: 'candidate', index: 0 })
        setEditing(false)
      } else {
        setFields(blankFields(result.email))
        setOrigin({ kind: 'manual' })
        setEditing(true)
        setNotice(
          'No settings are published for ' + result.domain + '. Enter your server details below.',
        )
      }
    } catch (e) {
      if (token !== lookup.current) return
      setDiscovery(undefined)
      setFields(blankFields(address))
      setOrigin({ kind: 'manual' })
      setEditing(true)
      setNotice(
        'Settings for ' +
          (address.split('@')[1] || 'this address') +
          ' couldn’t be looked up. ' +
          friendlyError(e) +
          ' Enter your server details below.',
      )
    } finally {
      if (token === lookup.current) setDiscovering(false)
    }
    setTest(undefined)
    setErrors({})
    setPhase('server')
  }
  const setUpManually = () => {
    const address = email.trim().toLowerCase()
    lookup.current++
    setDiscovering(false)
    setDiscovery(undefined)
    setNotice('')
    setFields((current) => ({
      ...current,
      username: current.username || address,
      outgoingUsername: current.outgoingUsername || address,
    }))
    manual()
    setPhase('server')
  }

  /** Builds and validates the request, marking any field the schema rejects. */
  const validate = (current: Fields): ConnectInput | undefined => {
    const address = email.trim()
    const config =
      current.protocol === 'jmap'
        ? {
            protocol: 'jmap' as const,
            serverUrl: current.serverUrl.trim(),
            username: current.username.trim(),
          }
        : {
            protocol: 'imap' as const,
            email: address,
            incoming: {
              host: current.incoming.host,
              port: Number(current.incoming.port.trim()) || 0,
              security: current.incoming.security,
              username: current.username.trim(),
              ...(current.incoming.certificate
                ? { certificate: current.incoming.certificate }
                : {}),
            },
            outgoing: {
              host: current.outgoing.host,
              port: Number(current.outgoing.port.trim()) || 0,
              security: current.outgoing.security,
              username: (current.sameLogin ? current.username : current.outgoingUsername).trim(),
              ...(current.outgoing.certificate
                ? { certificate: current.outgoing.certificate }
                : {}),
            },
            outgoingSameCredentials: current.sameLogin,
          }
    const separate = current.protocol === 'imap' && !current.sameLogin
    const parsed = accountSchema.safeParse({
      config,
      password,
      ...(separate && outgoingPassword ? { outgoingPassword } : {}),
      name: name.trim(),
      ...(senderName.trim() ? { senderName: senderName.trim() } : {}),
      remember,
      ...(existing ? { connectionId: existing.connectionId } : {}),
      ...(savedSettings?.folders ? { folders: savedSettings.folders } : {}),
    })
    if (parsed.success) {
      setErrors({})
      return parsed.data
    }
    const found: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      found[key] ??= issue.message
    }
    setErrors(found)
    // Server fields can only show their errors while they are editable.
    if (Object.keys(found).some((key) => key.startsWith('config.'))) setEditing(true)
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    )
    return undefined
  }
  const connect = async (input: ConnectInput) => {
    setBusy('connecting')
    setError('')
    try {
      await api.connect(input)
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      onDone(
        mode === 'add'
          ? 'Account connected.'
          : mode === 'edit'
            ? 'Connection updated.'
            : 'Signed in.',
      )
    } catch (e) {
      setError(friendlyError(e))
      setBusy(undefined)
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || discovering) return
    if (phase === 'email') return void findSettings()
    if (phase === 'folders') {
      if (pending.current) await connect({ ...pending.current, folders: choices })
      return
    }
    const input = validate(fields)
    if (!input) return
    if (input.config.protocol === 'jmap') return connect(input)
    await check(input)
  }
  /** IMAP checks both servers first, so a failure names the server that needs attention. */
  const check = async (input: ConnectInput) => {
    setBusy('testing')
    setError('')
    setTest(undefined)
    try {
      const result = await api.testConnection(input)
      setTest(result)
      if (!result.incoming.ok || (result.outgoing && !result.outgoing.ok)) {
        setBusy(undefined)
        return
      }
      pending.current = input
      if (result.folders) {
        // Earlier choices for this connection count as confirmed.
        const known: FolderMappingReview = {
          ...result.folders,
          mappings: { ...result.folders.mappings },
        }
        for (const [role, choice] of Object.entries(savedSettings?.folders || {}))
          known.mappings[role as keyof FolderMappings] = choice && {
            path: choice.path,
            source: 'user',
          }
        if (needsFolderReview(known)) {
          setReview(known)
          setChoices(initialFolderChoices(known))
          setBusy(undefined)
          setPhase('folders')
          return
        }
      }
      await connect(input)
    } catch (e) {
      setError(friendlyError(e))
      setBusy(undefined)
    }
  }
  /** Trusts a certificate for each server that presented it, then checks again. */
  const trust = (certificate: CertificateDetails, servers: ServerKind[]) => {
    if (busy) return
    const next = { ...fields }
    for (const kind of servers)
      next[kind] = {
        ...next[kind],
        certificate: { sha256: certificate.sha256, pem: certificate.pem },
      }
    setFields(next)
    const input = validate(next)
    if (input) void check(input)
  }

  const title =
    mode === 'edit' ? 'Edit connection' : mode === 'signIn' ? 'Sign in again' : 'Connect an account'
  const accountProblem = existing?.outgoingError
    ? 'Sending unavailable: ' + existing.outgoingError
    : existing && existing.status !== 'connected'
      ? existing.error
      : undefined
  const primaryLabel =
    phase === 'email'
      ? 'Continue'
      : phase === 'folders'
        ? mode === 'add'
          ? 'Connect account'
          : 'Save and sign in'
        : mode === 'add'
          ? 'Connect account'
          : mode === 'edit'
            ? 'Save and sign in'
            : 'Sign in'
  const busyLabel =
    phase === 'email' ? 'Continue' : busy === 'testing' ? 'Checking servers…' : 'Connecting…'
  const isBusy = discovering || !!busy
  const selected = origin.kind === 'candidate' ? candidates[origin.index] : undefined
  const failed = test && (!test.incoming.ok || (test.outgoing && !test.outgoing.ok))
  const reviews = certificateReviews(test)
  const trustLabel =
    mode === 'add' ? 'Trust and connect' : mode === 'edit' ? 'Trust and save' : 'Trust and sign in'

  return (
    <form className="account-form max-w-140" ref={form} onSubmit={(e) => void submit(e)} noValidate>
      <Button
        variant="ghost"
        size="small"
        className="account-form-back -ml-2.5 text-muted"
        onClick={onBack}
      >
        <ArrowLeft size={13} />
        Back to accounts
      </Button>
      <header className="account-form-title [&_p]:text-muted [&_p]:text-[12px] [&_p]:leading-[1.6] [&_p]:mt-1.5 [&_p]:mb-0 [&_p]:mx-0 mt-4.5 mb-2 mx-0">
        <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">
          {phase === 'folders' ? 'Check folders' : title}
        </h3>
        {phase === 'email' ? (
          <p>
            Enter your email address and Inlark looks up your server settings. You’ll see them
            before your password is sent anywhere.
          </p>
        ) : phase === 'folders' ? (
          <p>
            Some folders on {review && fields.incoming.host} couldn’t be confirmed. Choose where
            Inlark keeps sent mail and drafts, and where Archive, Mark as spam and Move to trash put
            conversations. You can change this later.
          </p>
        ) : (
          <p className="account-form-address [&>span]:text-secondary [&>span]:[overflow-wrap:anywhere] [&_.text-action]:text-[12px] flex items-baseline gap-2.5">
            <span>{email}</span>
            {mode === 'add' && (
              <button
                type="button"
                className="border-0 bg-none bg-transparent text-primary text-[11px] p-0 text-left hover:underline"
                onClick={() => {
                  setPhase('email')
                  setError('')
                }}
              >
                Change
              </button>
            )}
          </p>
        )}
      </header>
      {accountProblem && phase === 'server' && (
        <div className="form-error flex gap-2 text-[11px] leading-[1.6] my-3.75 text-danger [&_svg]:shrink-0 [&_svg]:mt-[3px] account-form-problem mt-3.5 mb-0 mx-0">
          <AlertCircle size={14} />
          <span>{accountProblem}</span>
        </div>
      )}

      {phase === 'email' && (
        <section
          className={cn(
            'account-form-section pt-5.5 pb-1 px-0 [&+.account-form-section]:border-t [&+.account-form-section]:border-solid',
            '[&+.account-form-section]:border-t-border [&+.account-form-section]:mt-4.5 [&_h4]:text-[11px]',
            '[&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-[2px] [&_h4]:mx-0 [&_h4]:text-secondary [&>.checkbox-label]:mt-4.5',
          )}
        >
          <TextField
            label="Email address"
            type="email"
            autoFocus
            autoComplete="email"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value)
              setEmailError('')
            }}
          />
          <div
            className="setup-lookup flex items-center gap-2 min-h-4.5 mt-3 text-[12px] text-muted"
            role="status"
          >
            {discovering && (
              <>
                <Spinner size={12} />
                Looking up settings for {email.split('@')[1] || 'your address'}…
              </>
            )}
          </div>
        </section>
      )}

      {phase === 'server' &&
        (loadingSaved ? (
          <div
            className="setup-lookup flex items-center gap-2 min-h-4.5 mt-3 text-[12px] text-muted"
            role="status"
          >
            <Spinner size={12} />
            Loading saved settings…
          </div>
        ) : (
          <>
            <section
              className={cn(
                'account-form-section pt-5.5 pb-1 px-0 [&+.account-form-section]:border-t [&+.account-form-section]:border-solid',
                '[&+.account-form-section]:border-t-border [&+.account-form-section]:mt-4.5 [&_h4]:text-[11px]',
                '[&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-[2px] [&_h4]:mx-0 [&_h4]:text-secondary [&>.checkbox-label]:mt-4.5',
              )}
            >
              <div className="account-form-section-heading [&_h4]:m-0 [&_.button]:-mr-2 [&_.button]:text-muted flex items-center justify-between gap-3 min-h-6.5">
                <h4>Server</h4>
                {editing ? (
                  (candidates.length > 0 || savedSettings) &&
                  mode !== 'edit' && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        if (savedSettings && !candidates.length) {
                          setFields(fieldsFrom(savedSettings.config, email))
                          setOrigin({ kind: 'saved' })
                          setEditing(false)
                          setErrors({})
                          changed()
                        } else choose(origin.kind === 'candidate' ? origin.index : 0)
                      }}
                    >
                      {savedSettings && !candidates.length
                        ? 'Use saved settings'
                        : 'Use found settings'}
                    </Button>
                  )
                ) : (
                  <Button variant="ghost" size="small" onClick={() => setEditing(true)}>
                    <PenLine size={12} />
                    Edit settings
                  </Button>
                )}
              </div>
              {notice && (
                <div
                  className="form-notice flex gap-2 text-[11px] leading-[1.6] my-3.75 text-muted [&_svg]:shrink-0 [&_svg]:mt-[3px] setup-notice mt-2.5 mb-1 mx-0"
                  role="status"
                >
                  <AlertCircle size={14} />
                  <span>{notice}</span>
                </div>
              )}
              {!editing && candidates.length > 1 && (
                <div
                  className="server-options grid gap-1.5 mt-3 mb-2.5 mx-0"
                  role="radiogroup"
                  aria-label="Server settings found"
                >
                  {candidates.map((candidate, index) => (
                    <label
                      key={index}
                      className={cn(
                        'server-option flex items-center gap-2.5 min-w-0 py-2.25 px-3 border border-solid border-border-strong',
                        'rounded-lg text-[12px] text-secondary cursor-pointer transition-[border-color,background] duration-120',
                        'ease-[ease] hover:bg-hover [&.chosen]:border-primary-solid/60 [&.chosen]:bg-primary-tint [&.chosen]:text-strong',
                        '[&.chosen_.theme-radio]:shadow-[inset_0_0_0_4px_var(--accent-solid)] [&:has(input:focus-visible)]:outline-2',
                        '[&:has(input:focus-visible)]:outline-solid [&:has(input:focus-visible)]:outline-primary',
                        '[&:has(input:focus-visible)]:outline-offset-[2px]',
                        origin.kind === 'candidate' && origin.index === index && 'chosen',
                      )}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="server-candidate"
                        checked={origin.kind === 'candidate' && origin.index === index}
                        onChange={() => choose(index)}
                      />
                      <span
                        className="theme-radio w-3.5 h-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--faint)] transition-[box-shadow] duration-120 ease-[ease]"
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          'protocol-tag inline-flex items-center h-4.5 py-0 px-1.5 border border-solid border-border-strong rounded-xs',
                          'text-[10px] font-medium tracking-[0.3px] text-muted whitespace-nowrap shrink-0',
                        )}
                      >
                        {candidate.protocol.toUpperCase()}
                      </span>
                      <span className="server-option-title min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {candidateTitle(candidate)}
                      </span>
                      <span className="server-option-source ml-auto shrink-0 text-[11px] text-muted max-[700px]:hidden">
                        {sourceLabel(candidate)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {!editing && (
                <div className="server-card mt-3 pt-3 pb-1 px-3.5 border border-solid border-border-strong rounded-lg bg-field">
                  {candidates.length < 2 && (
                    <div className="server-card-heading flex items-center gap-2.5 mb-1">
                      <span
                        className={cn(
                          'protocol-tag inline-flex items-center h-4.5 py-0 px-1.5 border border-solid border-border-strong rounded-xs',
                          'text-[10px] font-medium tracking-[0.3px] text-muted whitespace-nowrap shrink-0',
                        )}
                      >
                        {fields.protocol === 'jmap' ? 'JMAP' : 'IMAP · SMTP'}
                      </span>
                      <span className="server-card-source text-[11px] text-muted">
                        {selected
                          ? sourceLabel(selected)
                          : origin.kind === 'saved'
                            ? 'Saved settings'
                            : 'Entered manually'}
                      </span>
                    </div>
                  )}
                  <ServerSummary fields={fields} />
                </div>
              )}
              {editing && (
                <div className="server-fields [&_.form-field]:mt-3.5">
                  <div className="form-field mt-3.75 [&_input]:mt-1.5 [&_input]:text-[12px] [&_input[aria-invalid='true']]:border-danger/70">
                    <span className="form-label block mb-1.5 text-[12px] text-secondary">
                      Protocol
                    </span>
                    <SegmentedControl
                      label="Protocol"
                      value={fields.protocol}
                      options={protocolOptions}
                      onChange={(protocol) => update({ protocol })}
                    />
                  </div>
                  {fields.protocol === 'jmap' ? (
                    <TextField
                      label="Server URL"
                      type="url"
                      autoFocus={mode !== 'edit'}
                      spellCheck={false}
                      placeholder={'https://mail.' + domain}
                      value={fields.serverUrl}
                      error={errors['config.serverUrl']}
                      hint="A server address or a full JMAP session URL."
                      onChange={(e) => update({ serverUrl: e.target.value }, 'config.serverUrl')}
                    />
                  ) : (
                    (['incoming', 'outgoing'] as const).map((kind) => (
                      <fieldset
                        className="server-group [&_legend]:p-0 [&_legend]:text-[11px] [&_legend]:font-medium [&_legend]:text-secondary mt-4.5 mb-0 mx-0 p-0 border-0 min-w-0"
                        key={kind}
                      >
                        <legend>
                          {kind === 'incoming' ? 'Incoming mail · IMAP' : 'Outgoing mail · SMTP'}
                        </legend>
                        <div
                          className={cn(
                            'server-row grid grid-cols-[minmax(0,_1fr)_76px_auto] gap-[0_12px] items-start [&_.form-field]:mt-2',
                            'max-[700px]:grid-cols-[minmax(0,_1fr)_76px] max-[700px]:[&>:last-child]:col-span-full',
                          )}
                        >
                          <TextField
                            label="Server"
                            autoFocus={kind === 'incoming' && mode !== 'edit'}
                            spellCheck={false}
                            autoCapitalize="off"
                            placeholder={(kind === 'incoming' ? 'imap.' : 'smtp.') + domain}
                            value={fields[kind].host}
                            error={errors['config.' + kind + '.host']}
                            onChange={(e) => updateServer(kind, { host: e.target.value }, 'host')}
                          />
                          <TextField
                            label="Port"
                            inputMode="numeric"
                            className="port-field"
                            value={fields[kind].port}
                            error={errors['config.' + kind + '.port']}
                            onChange={(e) =>
                              updateServer(
                                kind,
                                { port: e.target.value.replace(/\D/g, '').slice(0, 5) },
                                'port',
                              )
                            }
                          />
                          <div className="form-field mt-3.75 [&_input]:mt-1.5 [&_input]:text-[12px] [&_input[aria-invalid='true']]:border-danger/70">
                            <span className="form-label block mb-1.5 text-[12px] text-secondary">
                              Security
                            </span>
                            <SegmentedControl
                              label={
                                (kind === 'incoming' ? 'Incoming' : 'Outgoing') + ' server security'
                              }
                              value={fields[kind].security}
                              options={securityOptions}
                              onChange={(security) => {
                                setSecurity(kind, security)
                                changed('config.' + kind + '.port')
                              }}
                            />
                          </div>
                        </div>
                        {fields[kind].certificate && (
                          <div className="trusted-certificate flex items-center gap-2 mt-2.5 text-[11px] text-muted">
                            <ShieldCheck size={13} className="shrink-0 text-success" />
                            <span
                              className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                              title={'SHA-256 ' + fields[kind].certificate.sha256}
                            >
                              Trusted certificate{' '}
                              <span className="font-mono text-[10.5px]">
                                {shortFingerprint(fields[kind].certificate.sha256)}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="shrink-0 border-0 bg-none bg-transparent text-primary text-[11px] p-0 hover:underline"
                              onClick={() => updateServer(kind, { certificate: undefined })}
                            >
                              Stop trusting
                            </button>
                          </div>
                        )}
                      </fieldset>
                    ))
                  )}
                </div>
              )}
            </section>

            <section
              className={cn(
                'account-form-section pt-5.5 pb-1 px-0 [&+.account-form-section]:border-t [&+.account-form-section]:border-solid',
                '[&+.account-form-section]:border-t-border [&+.account-form-section]:mt-4.5 [&_h4]:text-[11px]',
                '[&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-[2px] [&_h4]:mx-0 [&_h4]:text-secondary [&>.checkbox-label]:mt-4.5',
              )}
            >
              <h4>Sign in</h4>
              <div className="form-row grid grid-cols-[1fr_1fr] gap-[0_14px] items-start">
                <TextField
                  label="Username"
                  autoComplete="username"
                  spellCheck={false}
                  autoCapitalize="off"
                  value={fields.username}
                  error={
                    errors['config.username'] ||
                    errors['config.incoming.username'] ||
                    (fields.sameLogin ? errors['config.outgoing.username'] : undefined)
                  }
                  onChange={(e) =>
                    update(
                      { username: e.target.value },
                      'config.username',
                      'config.incoming.username',
                      'config.outgoing.username',
                    )
                  }
                />
                <TextField
                  label="Password or app password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus={!editing}
                  placeholder="Your password"
                  value={password}
                  error={errors.password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    changed('password')
                  }}
                />
              </div>
              {fields.protocol === 'imap' && (
                <>
                  <label className="checkbox-label flex items-center gap-2.25 text-[12px]">
                    <Checkbox
                      checked={fields.sameLogin}
                      onCheckedChange={(sameLogin) =>
                        update({ sameLogin }, 'outgoingPassword', 'config.outgoing.username')
                      }
                    />
                    Outgoing server uses the same login
                  </label>
                  {!fields.sameLogin && (
                    <div className="form-row grid grid-cols-[1fr_1fr] gap-[0_14px] items-start">
                      <TextField
                        label="Outgoing username"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        value={fields.outgoingUsername}
                        error={errors['config.outgoing.username']}
                        onChange={(e) =>
                          update({ outgoingUsername: e.target.value }, 'config.outgoing.username')
                        }
                      />
                      <TextField
                        label="Outgoing password"
                        type="password"
                        autoComplete="off"
                        placeholder="Outgoing server password"
                        value={outgoingPassword}
                        error={errors.outgoingPassword}
                        onChange={(e) => {
                          setOutgoingPassword(e.target.value)
                          changed('outgoingPassword')
                        }}
                      />
                    </div>
                  )}
                </>
              )}
              <label className="checkbox-label flex items-center gap-2.25 text-[12px]">
                <Checkbox
                  checked={remember}
                  disabled={isDemo}
                  onCheckedChange={(checked) => setRemember(checked)}
                />
                {bootstrap.secureStorage
                  ? 'Remember this login in the OS keyring'
                  : 'Remember this login on this device'}
              </label>
              {!bootstrap.secureStorage && (
                <div className="form-notice flex gap-2 text-[11px] leading-[1.6] my-3.75 mx-0 text-muted [&_svg]:shrink-0 [&_svg]:mt-[3px]">
                  <LockKeyhole size={14} />
                  <span>
                    {isDemo
                      ? 'Demo accounts stay in this window and never connect to a server.'
                      : 'No OS keyring is available. If you remember this login, your password will be saved unencrypted in a file accessible to your user account. Leave the box unchecked for session-only login.'}
                  </span>
                </div>
              )}
            </section>

            {mode === 'add' && (
              <section
                className={cn(
                  'account-form-section pt-5.5 pb-1 px-0 [&+.account-form-section]:border-t [&+.account-form-section]:border-solid',
                  '[&+.account-form-section]:border-t-border [&+.account-form-section]:mt-4.5 [&_h4]:text-[11px]',
                  '[&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-[2px] [&_h4]:mx-0 [&_h4]:text-secondary [&>.checkbox-label]:mt-4.5',
                )}
              >
                <h4>How it appears</h4>
                <div className="form-row grid grid-cols-[1fr_1fr] gap-[0_14px] items-start">
                  <TextField
                    label="Label"
                    placeholder="Personal"
                    maxLength={100}
                    hint="Only you see this."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <TextField
                    label="Your name"
                    placeholder="Jane Doe"
                    autoComplete="name"
                    maxLength={100}
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    hint={
                      <>
                        Recipients see{' '}
                        <span className="sender-preview [overflow-wrap:anywhere] text-secondary">
                          {(senderName.trim() || 'your server’s name') + ' <' + email + '>'}
                        </span>
                      </>
                    }
                  />
                </div>
              </section>
            )}

            {fields.protocol === 'imap' && (busy === 'testing' || test) && (
              <section
                className={cn(
                  'account-form-section pt-5.5 pb-1 px-0 [&+.account-form-section]:border-t [&+.account-form-section]:border-solid',
                  '[&+.account-form-section]:border-t-border [&+.account-form-section]:mt-4.5 [&_h4]:text-[11px]',
                  '[&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-[2px] [&_h4]:mx-0 [&_h4]:text-secondary [&>.checkbox-label]:mt-4.5',
                )}
                aria-live="polite"
              >
                <h4>Connection check</h4>
                <ul className="connection-checks list-none mt-2.5 mb-0 mx-0 p-0 border border-solid border-border-strong rounded-lg">
                  <CheckRow
                    label="Incoming"
                    host={fields.incoming.host}
                    check={test?.incoming}
                    pending={busy === 'testing'}
                  />
                  <CheckRow
                    label="Outgoing"
                    host={fields.outgoing.host}
                    check={test?.outgoing}
                    pending={busy === 'testing'}
                  />
                </ul>
                {reviews.map(({ certificate, servers }) => (
                  <CertificateReview
                    key={certificate.sha256}
                    certificate={certificate}
                    host={fields[servers[0]].host}
                    servers={servers}
                    action={trustLabel}
                    disabled={isBusy}
                    onTrust={() => trust(certificate, servers)}
                  />
                ))}
                {failed && (
                  <p className="connection-check-hint mt-2.5 mb-0 mx-0 text-[11px] text-muted">
                    {reviews.length
                      ? 'Nothing was saved. No password is sent to a server until its certificate is accepted.'
                      : 'Nothing was saved. Check the password or the server settings above, then try again.'}
                  </p>
                )}
              </section>
            )}
          </>
        ))}

      {phase === 'folders' && review && (
        <section
          className={cn(
            'account-form-section pt-5.5 pb-1 px-0 [&+.account-form-section]:border-t [&+.account-form-section]:border-solid',
            '[&+.account-form-section]:border-t-border [&+.account-form-section]:mt-4.5 [&_h4]:text-[11px]',
            '[&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-[2px] [&_h4]:mx-0 [&_h4]:text-secondary [&>.checkbox-label]:mt-4.5',
          )}
        >
          <FolderMappingEditor
            review={review}
            value={choices}
            onChange={setChoices}
            disabled={!!busy}
          />
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="form-error flex gap-2 text-[11px] leading-[1.6] my-3.75 mx-0 text-danger [&_svg]:shrink-0 [&_svg]:mt-[3px]"
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      <footer className="account-form-footer flex justify-end gap-2 mt-5.5 pt-4.5 border-t border-solid border-t-border">
        {phase === 'email' && (
          <Button
            variant="ghost"
            className="account-form-manual mr-auto -ml-2.5 text-muted"
            onClick={setUpManually}
          >
            Set up manually
          </Button>
        )}
        {phase === 'folders' ? (
          <Button onClick={() => setPhase('server')} disabled={!!busy}>
            Back
          </Button>
        ) : (
          <Button onClick={onBack}>Cancel</Button>
        )}
        <Button type="submit" variant="primary" disabled={isBusy || loadingSaved}>
          {isBusy ? (
            <>
              <Spinner size={14} />
              {busyLabel}
            </>
          ) : (
            primaryLabel
          )}
        </Button>
      </footer>
    </form>
  )
}
