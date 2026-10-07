import { cn } from '@inlark/ui'
import { useState, type ReactNode, type RefObject } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  AlertCircle,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DeviceSync,
  FileImport,
  Key,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
  Share,
  ShieldX,
} from '@inlark/ui/icons'
import { Button, Checkbox, Dropdown, MenuItem, Modal, Spinner, Switch } from '@inlark/ui'
import {
  friendlyError,
  type Account,
  type EncryptionIdentity,
  type EncryptionKeySummary,
  type Identity,
} from '@inlark/core'
import { api } from './api'
import { AccountMark } from './AccountMark'
import {
  Callout,
  FingerprintBlock,
  FormError,
  KeyBadge,
  NewPasswordFields,
  PasswordField,
  StateIcon,
  dialogLead,
  formatFingerprint,
  keyFileError,
  keySources,
  lockVault,
  modalActions,
  newPasswordProblem,
  shortFingerprint,
  useEncryption,
} from './encryption-ui'
import { ContactKeyDialog, keysChanged, useUnlock } from './encryption-actions'

const section = cn(
  'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
  '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
  '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
)
const settingRow = cn(
  'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
  '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
  '[&_strong]:text-[13px] max-[700px]:gap-3.5',
)
const dialogWidth = 'w-[min(490px,_calc(100vw_-_40px))]'
const backupHint =
  'At least 10 characters. Inlark can’t recover it, so keep it apart from the backup file, for example in a password manager.'

type Notify = (message: string, tone?: 'error' | 'info') => void
/** One sending address, with its key when it has one. */
interface Target {
  account: Account
  identity: Identity
  own?: EncryptionIdentity
  key?: EncryptionKeySummary
  /** The account's addresses are still being fetched. */
  loading?: boolean
}
type Dialog =
  | { kind: 'setup' | 'transfer' | 'replace' | 'older'; target: Target }
  | { kind: 'backup' | 'postpone' | 'revoke'; key: EncryptionKeySummary }

const isOwn = (key: EncryptionKeySummary) =>
  key.sources.includes('own') || key.sources.includes('import')
const ownedBy = (identity: Identity) => (i: EncryptionIdentity) =>
  i.accountId === identity.accountId && i.identityId === identity.id

/** Settings → Encryption: key storage, each sending address, and contacts’ keys. */
export function EncryptionPanel({
  accounts,
  secureStorage,
  notify,
  portalContainer,
}: {
  accounts: Account[]
  secureStorage: boolean
  notify: Notify
  portalContainer: RefObject<HTMLDivElement | null>
}) {
  const status = useEncryption()
  const [unlock, unlockDialog] = useUnlock()
  const [dialog, setDialog] = useState<Dialog>()
  const [contact, setContact] = useState<string>()
  const [busy, setBusy] = useState(false)
  const identityLists = useQueries({
    queries: accounts.map((a) => ({
      queryKey: ['identities', a.id],
      queryFn: () => api.identities(a.id),
      enabled: a.status === 'connected',
    })),
  })
  const data = status.data
  const targets: Target[] = accounts.flatMap((account, index) => {
    // Without its identities an account still gets a row, so it doesn't silently disappear.
    const identities: Identity[] = identityLists[index]?.data || [
      { id: '', accountId: account.id, name: account.name, email: account.email },
    ]
    return identities.map((identity) => {
      const own = data?.identities.find(ownedBy(identity))
      const key =
        own && data?.keys.find((k) => k.fingerprint === own.fingerprint && k.email === own.email)
      const loading = account.status === 'connected' && !!identityLists[index]?.isPending
      return { account, identity, own, key, loading }
    })
  })
  const current = new Set(targets.map((t) => t.own?.fingerprint).filter(Boolean))
  const olderKeys = (data?.keys || []).filter((k) => isOwn(k) && !current.has(k.fingerprint))
  const run = async (task: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await task()
      if (done) notify(done)
    } catch (e) {
      notify(friendlyError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const setPreference = (own: EncryptionIdentity, enabled: boolean, prefer: boolean) =>
    void run(async () =>
      keysChanged(
        await api.setEncryptionPreference(own.accountId, own.identityId, enabled, prefer),
      ),
    )
  const unlocked = data?.vault === 'unlocked'
  const close = () => setDialog(undefined)
  return (
    <>
      <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">Encryption</h3>
      <p className="settings-lead text-muted mt-1.5 mb-6 mx-0 text-[12px] leading-[1.6]">
        Encrypted mail can only be read by you and the people you send it to. Inlark uses OpenPGP,
        so it works with Thunderbird, Proton Mail and other apps that support it. Subjects and
        addresses aren’t encrypted.
      </p>
      {data && data.vault !== 'absent' && (
        <div className={section}>
          <h4>Key storage</h4>
          <div className={settingRow}>
            <div className="flex items-center gap-3 min-w-0">
              <StateIcon
                icon={unlocked ? LockOpen : Lock}
                tone={unlocked ? 'neutral' : 'warning'}
                size={34}
              />
              <div>
                <strong>{unlocked ? 'Your keys are unlocked' : 'Your keys are locked'}</strong>
                <p>
                  {!unlocked
                    ? 'Unlock them to read encrypted mail and keep writing encrypted drafts.'
                    : data.protection === 'password'
                      ? 'Protected by your vault password. Lock them when you step away.'
                      : 'Protected by your system keyring. Locking hides encrypted mail until you unlock again.'}
                </p>
              </div>
            </div>
            <Button
              disabled={busy}
              variant={unlocked ? 'default' : 'primary'}
              onClick={() =>
                void run(
                  async () => {
                    if (unlocked) await lockVault()
                    else await unlock()
                  },
                  unlocked ? 'Encryption keys locked.' : undefined,
                )
              }
            >
              {unlocked ? <Lock size={14} /> : <LockOpen size={14} />}
              {unlocked ? 'Lock' : 'Unlock'}
            </Button>
          </div>
        </div>
      )}
      <div className={section}>
        <h4>Your addresses</h4>
        {status.isPending ? (
          <div className="flex items-center gap-2 py-4 text-muted text-[12px]">
            <Spinner size={14} /> Loading…
          </div>
        ) : (
          <div className="encryption-identities">
            {targets.map((target) => (
              <IdentityRow
                key={target.account.id + '\n' + (target.identity.id || target.identity.email)}
                target={target}
                showAccount={accounts.length > 1}
                busy={busy}
                portalContainer={portalContainer}
                onDialog={(kind) => setDialog({ kind, target })}
                onKeyDialog={(kind) => target.key && setDialog({ kind, key: target.key })}
                onPreference={setPreference}
                onExport={() =>
                  void run(() => api.exportEncryptionKey(target.own!.fingerprint, 'public'))
                }
                notify={notify}
              />
            ))}
          </div>
        )}
      </div>
      <ContactKeys keys={data?.keys || []} onOpen={setContact} />
      {olderKeys.length > 0 && (
        <div className={section}>
          <h4>Older keys</h4>
          <p className="mt-0 mb-1 text-[12px] leading-[1.6] text-muted">
            Kept so you can still read mail encrypted to them. They aren’t used for new mail.
          </p>
          {olderKeys.map((key) => (
            <div
              key={key.fingerprint}
              className="older-key flex items-center gap-3 py-3 border-b border-solid border-b-border last:border-b-0"
            >
              <StateIcon icon={Key} tone="neutral" size={30} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-[13px]">
                  <span className="[overflow-wrap:anywhere]">{key.email}</span>
                  {key.problem === 'revoked' && <KeyBadge tone="danger">Revoked</KeyBadge>}
                  {key.backup && key.backup !== 'done' && (
                    <KeyBadge tone="warning">Not backed up</KeyBadge>
                  )}
                </div>
                <span className="block text-[11px] text-muted font-mono mt-0.5">
                  {shortFingerprint(key.fingerprint)}
                </span>
              </div>
              <Dropdown
                container={portalContainer}
                className="[&_.menu-item]:min-h-7.75 w-52"
                trigger={
                  <Button
                    size="small"
                    aria-label={'Manage older key ' + shortFingerprint(key.fingerprint)}
                  >
                    Manage
                    <ChevronDown size={13} />
                  </Button>
                }
              >
                <MenuItem onClick={() => setDialog({ kind: 'backup', key })}>
                  <Key size={14} />
                  Back up key…
                </MenuItem>
                <MenuItem
                  onClick={() => void run(() => api.exportEncryptionKey(key.fingerprint, 'public'))}
                >
                  <Share size={14} />
                  Export public key…
                </MenuItem>
                {key.problem !== 'revoked' && (
                  <>
                    <div className="h-[1px] m-1.25 bg-border" />
                    <MenuItem danger onClick={() => setDialog({ kind: 'revoke', key })}>
                      <ShieldX size={14} />
                      Revoke key…
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            </div>
          ))}
        </div>
      )}
      {dialog?.kind === 'setup' && (
        <SetupDialog
          target={dialog.target}
          secureStorage={secureStorage}
          unlock={unlock}
          notify={notify}
          onClose={close}
        />
      )}
      {dialog?.kind === 'backup' && (
        <Modal
          open
          onOpenChange={(open) => !open && close()}
          title="Back up your key"
          description={'Key ' + shortFingerprint(dialog.key.fingerprint) + ' · ' + dialog.key.email}
          className={dialogWidth}
        >
          <BackupForm
            fingerprint={dialog.key.fingerprint}
            unlock={unlock}
            onSaved={() => {
              notify('Backup saved. Keep its password somewhere safe.')
              close()
            }}
            secondary={<Button onClick={close}>Cancel</Button>}
          />
        </Modal>
      )}
      {dialog?.kind === 'postpone' && (
        <Modal
          open
          onOpenChange={(open) => !open && close()}
          title="Back up later?"
          className={dialogWidth}
        >
          <PostponeForm
            fingerprint={dialog.key.fingerprint}
            onBackUp={() => setDialog({ kind: 'backup', key: dialog.key })}
            onDone={close}
          />
        </Modal>
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog target={dialog.target} unlock={unlock} onClose={close} />
      )}
      {dialog?.kind === 'replace' && (
        <ReplaceDialog
          target={dialog.target}
          unlock={unlock}
          onClose={close}
          onReplaced={(key) => {
            notify('Your new key is ready. Contacts will be asked to review it.')
            setDialog(key ? { kind: 'backup', key } : undefined)
          }}
        />
      )}
      {dialog?.kind === 'revoke' && (
        <RevokeDialog keySummary={dialog.key} unlock={unlock} onClose={close} />
      )}
      {dialog?.kind === 'older' && (
        <OlderKeyDialog target={dialog.target} unlock={unlock} notify={notify} onClose={close} />
      )}
      <ContactKeyDialog email={contact} onClose={() => setContact(undefined)} />
      {unlockDialog}
    </>
  )
}

function IdentityRow({
  target,
  showAccount,
  busy,
  portalContainer,
  onDialog,
  onKeyDialog,
  onPreference,
  onExport,
  notify,
}: {
  target: Target
  showAccount: boolean
  busy: boolean
  portalContainer: RefObject<HTMLDivElement | null>
  onDialog: (kind: 'setup' | 'transfer' | 'replace' | 'older') => void
  onKeyDialog: (kind: 'backup' | 'postpone' | 'revoke') => void
  onPreference: (own: EncryptionIdentity, enabled: boolean, prefer: boolean) => void
  onExport: () => void
  notify: Notify
}) {
  const { account, identity, own, key } = target
  const unavailable = !identity.id
  const broken = !!key && !key.usable
  return (
    <div className="encryption-identity border-b border-solid border-b-border last:border-b-0 py-4 first:pt-1">
      <div className="flex items-center gap-3">
        <AccountMark account={account} size={30} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-strong [overflow-wrap:anywhere]">
            {identity.email}
            {showAccount && (
              <span className="font-normal text-[11px] text-muted ml-2">{account.name}</span>
            )}
          </div>
          <div className="text-[11px] mt-0.5">
            {!own ? (
              <span className="text-muted">
                {!unavailable
                  ? 'Not set up'
                  : target.loading
                    ? 'Loading addresses…'
                    : 'Connect this account to set up encryption'}
              </span>
            ) : broken ? (
              <span className="text-danger">
                {key.problem === 'revoked'
                  ? 'Key revoked'
                  : key.problem === 'expired'
                    ? 'Key expired'
                    : 'Key can’t be used'}
                {' · Replace it to encrypt again'}
              </span>
            ) : (
              <span className={own.enabled ? 'text-success' : 'text-muted'}>
                <span
                  className={cn(
                    'inline-block w-1.25 h-1.25 rounded-full mr-1.5 align-[2px]',
                    own.enabled ? 'bg-success' : 'bg-faint',
                  )}
                />
                {own.enabled ? 'On' : 'Off'}
                <span className="text-muted">
                  {' · Key '}
                  <span className="font-mono">{shortFingerprint(own.fingerprint)}</span>
                </span>
              </span>
            )}
          </div>
        </div>
        {!own ? (
          <Button size="small" disabled={busy || unavailable} onClick={() => onDialog('setup')}>
            Set up…
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            {broken ? (
              <Button size="small" disabled={busy} onClick={() => onDialog('replace')}>
                Replace key…
              </Button>
            ) : (
              <Switch
                aria-label={'Encrypt mail from ' + identity.email}
                checked={own.enabled}
                disabled={busy}
                onCheckedChange={(enabled) => onPreference(own, enabled, own.prefer)}
              />
            )}
            <Dropdown
              container={portalContainer}
              className="[&_.menu-item]:min-h-7.75 w-56"
              trigger={
                <Button
                  size="small"
                  className="data-popup-open:bg-hover data-popup-open:text-strong [&[data-popup-open]_svg]:transform-[rotate(180deg)]"
                  aria-label={'Manage key for ' + identity.email}
                >
                  Manage
                  <ChevronDown size={13} />
                </Button>
              }
            >
              <MenuItem onClick={() => onKeyDialog('backup')} disabled={!key}>
                <Key size={14} />
                Back up key…
              </MenuItem>
              <MenuItem onClick={onExport}>
                <Share size={14} />
                Export public key…
              </MenuItem>
              <MenuItem
                onClick={() =>
                  void navigator.clipboard
                    .writeText(formatFingerprint(own.fingerprint))
                    .then(() => notify('Fingerprint copied.'))
                }
              >
                <Copy size={14} />
                Copy fingerprint
              </MenuItem>
              <MenuItem onClick={() => onDialog('transfer')} disabled={broken}>
                <DeviceSync size={14} />
                Move to another device…
              </MenuItem>
              <MenuItem onClick={() => onDialog('older')}>
                <FileImport size={14} />
                Import an older key…
              </MenuItem>
              <div className="h-[1px] m-1.25 bg-border" />
              <MenuItem onClick={() => onDialog('replace')}>
                <RefreshCw size={14} />
                Replace key…
              </MenuItem>
              {key?.problem !== 'revoked' && (
                <MenuItem danger onClick={() => onKeyDialog('revoke')} disabled={!key}>
                  <ShieldX size={14} />
                  Revoke key…
                </MenuItem>
              )}
            </Dropdown>
          </div>
        )}
      </div>
      {own?.enabled && !broken && (
        <div className={cn(settingRow, 'mb-0 mt-3 pl-10.5')}>
          <div>
            <strong>Prefer encrypted mail</strong>
            <p>
              Let contacts know you’d like encrypted mail. New conversations are encrypted
              automatically when every recipient prefers it too.
            </p>
          </div>
          <Switch
            aria-label={'Prefer encrypted mail for ' + identity.email}
            checked={own.prefer}
            disabled={busy}
            onCheckedChange={(prefer) => onPreference(own, true, prefer)}
          />
        </div>
      )}
      {key?.backup && key.backup !== 'done' && (
        <Callout
          tone="warning"
          icon={AlertCircle}
          className="mt-3.5 ml-10.5"
          title={key.backup === 'postponed' ? 'Your key isn’t backed up' : 'Back up your key'}
          action={
            <>
              {key.backup === 'needed' && (
                <Button size="small" variant="ghost" onClick={() => onKeyDialog('postpone')}>
                  Later
                </Button>
              )}
              <Button size="small" onClick={() => onKeyDialog('backup')}>
                Back up…
              </Button>
            </>
          }
        >
          <p>
            If this computer is lost, your encrypted mail is lost with it. Resetting your email
            password can’t bring it back.
          </p>
        </Callout>
      )}
    </div>
  )
}

/** Contacts’ keys found so far, filtered as you type, with a lookup for anyone else. */
function ContactKeys({
  keys,
  onOpen,
}: {
  keys: EncryptionKeySummary[]
  onOpen: (email: string) => void
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const contacts = new Map<string, EncryptionKeySummary[]>()
  for (const key of keys)
    if (!isOwn(key)) contacts.set(key.email, [...(contacts.get(key.email) || []), key])
  const text = query.trim().toLowerCase()
  const list = [...contacts.entries()]
    .filter(([email]) => !text || email.includes(text))
    .sort(([a], [b]) => a.localeCompare(b))
  const shown = showAll || text ? list : list.slice(0, 6)
  const lookup = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : ''
  return (
    <div className={section}>
      <h4>Contacts’ keys</h4>
      <p className="mt-0 mb-3.5 text-[12px] leading-[1.6] text-muted">
        Found automatically, from your contacts’ mail providers and from mail they send you. Look
        someone up to check or verify their key.
      </p>
      <form
        className="contact-lookup flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (lookup) onOpen(lookup)
        }}
      >
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2.75 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            className="h-8 py-0 pl-8 pr-2.5 text-[12px]"
            type="search"
            aria-label="Find or look up a contact’s key"
            placeholder="Find or look up an email address"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button size="small" type="submit" className="shrink-0 h-8" disabled={!lookup}>
          Look up
        </Button>
      </form>
      {shown.length > 0 && (
        <div className="contact-keys mt-2">
          {shown.map(([email, list]) => {
            const current = list.find((k) => k.accepted && !k.retired)
            const active = list.filter((k) => !k.retired && k.usable)
            const changed = !!current && active.some((k) => k !== current)
            const conflict = !current && active.length > 1
            const shownKey = current || active[0] || list[0]
            return (
              <button
                key={email}
                type="button"
                className={cn(
                  'contact-key flex items-center gap-3 w-[calc(100%_+_16px)] py-2.5 px-2 -mx-2 rounded-md border-0',
                  'bg-transparent text-left transition-[background] duration-120 ease-[ease] hover:bg-hover',
                )}
                onClick={() => onOpen(email)}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] [overflow-wrap:anywhere]">{email}</span>
                  <span className="block text-[11px] text-muted mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span className="font-mono">{shortFingerprint(shownKey.fingerprint)}</span>
                    {' · from '}
                    {keySources(shownKey)}
                  </span>
                </span>
                {changed ? (
                  <KeyBadge tone="warning">Key changed</KeyBadge>
                ) : conflict ? (
                  <KeyBadge tone="warning">Choose a key</KeyBadge>
                ) : !shownKey.usable ? (
                  <KeyBadge tone="danger">Can’t be used</KeyBadge>
                ) : shownKey.confirmed ? (
                  <KeyBadge tone="good" icon={BadgeCheck}>
                    Verified
                  </KeyBadge>
                ) : (
                  <KeyBadge>Not verified</KeyBadge>
                )}
                <ChevronRight size={14} className="text-faint shrink-0" />
              </button>
            )
          })}
        </div>
      )}
      {!text && list.length > shown.length && (
        <Button
          size="small"
          variant="ghost"
          className="mt-1 -ml-2"
          onClick={() => setShowAll(true)}
        >
          Show all {list.length} contacts
        </Button>
      )}
      {text && !list.length && (
        <p className="mt-3 mb-0 text-[12px] text-muted">
          {lookup
            ? 'No saved key for this address yet. Look it up to search for one.'
            : 'No saved keys match.'}
        </p>
      )}
    </div>
  )
}

/** Choose a backup password, then where to save the file. */
function BackupForm({
  fingerprint,
  unlock,
  onSaved,
  secondary,
  lead = 'Save a password-protected copy of your private key. You’ll need it to read encrypted mail on a new computer, or if something happens to this one.',
}: {
  fingerprint: string
  unlock: () => Promise<boolean>
  onSaved: () => void
  secondary?: ReactNode
  lead?: ReactNode
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setSubmitted(true)
        setError('')
        if (newPasswordProblem(password, confirm)) return
        setBusy(true)
        try {
          if (!(await unlock())) return
          await api.exportEncryptionKey(fingerprint, 'backup', password)
          const status = await api.encryptionStatus()
          keysChanged(status)
          // The save dialog can be cancelled, which leaves the key without a backup.
          if (status.keys.some((k) => k.fingerprint === fingerprint && k.backup === 'done'))
            onSaved()
        } catch (e) {
          setError(friendlyError(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <p className={dialogLead}>{lead}</p>
      <NewPasswordFields
        label="Backup password"
        password={password}
        confirm={confirm}
        autoFocus
        showProblems={submitted}
        hint={backupHint}
        onChange={(p, c) => {
          setPassword(p)
          setConfirm(c)
        }}
      />
      {error && <FormError>{error}</FormError>}
      <div className={modalActions}>
        {secondary}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Spinner size={14} />}
          Save backup…
        </Button>
      </div>
    </form>
  )
}

/** Postponing a backup is allowed, but only after saying plainly what's at stake. */
function PostponeForm({
  fingerprint,
  onBackUp,
  onDone,
}: {
  fingerprint: string
  onBackUp: () => void
  onDone: () => void
}) {
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Callout tone="warning" icon={AlertCircle} title="A lost key can’t be recovered">
        <p>
          If this computer is lost or damaged, or you forget your vault password, you won’t be able
          to read your encrypted mail again. Resetting your email password doesn’t help.
        </p>
      </Callout>
      <label className="checkbox-label flex items-center gap-2.25 text-[12px] mt-4.5">
        <Checkbox checked={understood} onCheckedChange={setUnderstood} />I understand I could lose
        access to my encrypted mail
      </label>
      <p className="mt-1.5 mb-0 ml-6 text-[11px] text-muted">
        A reminder stays in Settings until you back up.
      </p>
      {error && <FormError>{error}</FormError>}
      <div className={modalActions}>
        <Button
          variant="danger"
          className="modal-action-start ml-0"
          disabled={!understood || busy}
          onClick={async () => {
            setBusy(true)
            try {
              keysChanged(await api.postponeEncryptionBackup(fingerprint))
              onDone()
            } catch (e) {
              setError(friendlyError(e))
              setBusy(false)
            }
          }}
        >
          Back up later
        </Button>
        <Button variant="primary" onClick={onBackUp}>
          Back up now
        </Button>
      </div>
    </>
  )
}

/** A choice shown as a card; native radios keep arrow-key navigation. */
function Choice({
  name,
  checked,
  onSelect,
  icon,
  title,
  children,
}: {
  name: string
  checked: boolean
  onSelect: () => void
  icon: typeof Key
  title: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'choice flex gap-3.5 items-center py-3 px-3.5 rounded-lg border border-solid cursor-pointer',
        'transition-[background,border-color] duration-120 ease-[ease] [&+.choice]:mt-2',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-primary',
        'has-[:focus-visible]:outline-offset-2',
        checked
          ? 'border-primary-solid/70 bg-primary-tint'
          : 'border-border-strong hover:bg-hover hover:border-foreground/20',
      )}
    >
      <input type="radio" className="sr-only" name={name} checked={checked} onChange={onSelect} />
      <StateIcon icon={icon} tone={checked ? 'accent' : 'neutral'} size={34} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-strong">{title}</span>
        <span className="block text-[12px] leading-[1.5] text-muted mt-0.5">{children}</span>
      </span>
      <span
        className={cn(
          'w-3.75 h-3.75 shrink-0 rounded-full transition-[box-shadow] duration-120',
          checked
            ? 'shadow-[inset_0_0_0_4.5px_var(--accent-solid)]'
            : 'shadow-[inset_0_0_0_1px_var(--faint)]',
        )}
        aria-hidden="true"
      />
    </label>
  )
}

const formatCode = (digits: string) => digits.match(/.{1,4}/g)?.join('-') || ''
const transferError = (error: unknown) =>
  /decrypt|session key|passphrase/i.test(friendlyError(error))
    ? 'That setup code didn’t open the Setup Message. Check the code and try again.'
    : friendlyError(error)

type SetupStep =
  | 'choose'
  | 'vault'
  | 'creating'
  | 'existing'
  | 'replace'
  | 'import'
  | 'transfer'
  | 'backup'
  | 'postpone'

/**
 * Guides one address from nothing to a working, backed-up key: choose how, protect the vault
 * if the system keyring can't, then save a backup straight away.
 */
function SetupDialog({
  target,
  secureStorage,
  unlock,
  notify,
  onClose,
}: {
  target: Target
  secureStorage: boolean
  unlock: () => Promise<boolean>
  notify: Notify
  onClose: () => void
}) {
  const { identity } = target
  const status = useEncryption()
  const [step, setStep] = useState<SetupStep>('choose')
  const [method, setMethod] = useState<'create' | 'import' | 'transfer'>('create')
  const [vaultPassword, setVaultPassword] = useState('')
  const [vaultConfirm, setVaultConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [keyPassword, setKeyPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const found = (status.data?.keys || []).filter(
    (k) => k.email.toLowerCase() === identity.email.toLowerCase(),
  )
  const needsVaultPassword = status.data?.vault === 'absent' && !secureStorage
  const own = status.data?.identities.find(ownedBy(identity))
  const ids = { accountId: identity.accountId, identityId: identity.id }
  const password = vaultPassword || undefined
  /** Whether this address has a key now; file pickers can be cancelled without an error. */
  const installed = async () => {
    const next = await api.encryptionStatus()
    keysChanged(next)
    return next.identities.some(ownedBy(identity))
  }
  const go = (to: SetupStep) => {
    setError('')
    setStep(to)
  }
  const create = async (replace = false) => {
    setError('')
    if (!replace && found.length) return setStep('existing')
    setStep('creating')
    try {
      keysChanged(
        await api.setupEncryption({ ...ids, action: replace ? 'replace' : 'create', password }),
      )
      setStep('backup')
    } catch (e) {
      if (!replace && /existing key|already exists/i.test(friendlyError(e))) {
        await status.refetch()
        setStep('existing')
      } else {
        setError(friendlyError(e))
        setStep(replace ? 'replace' : 'choose')
      }
    }
  }
  const next = () => (method === 'create' ? void create() : go(method))
  const start = async () => {
    setError('')
    if (status.data?.vault === 'locked' && !(await unlock())) return
    if (needsVaultPassword) go('vault')
    else next()
  }
  const importKey = async () => {
    setBusy(true)
    setError('')
    try {
      await api.setupEncryption({
        ...ids,
        action: 'import',
        password,
        keyPassword: keyPassword || undefined,
      })
      if (await installed()) setStep('backup')
    } catch (e) {
      setError(keyFileError(e, keyPassword))
    } finally {
      setBusy(false)
    }
  }
  const transfer = async () => {
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 36) {
      setError('Enter all 36 digits of the setup code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.transferEncryption({ ...ids, action: 'import', code: formatCode(digits), password })
      if (await installed()) setStep('backup')
    } catch (e) {
      setError(transferError(e))
    } finally {
      setBusy(false)
    }
  }
  const finish = (message: string) => {
    notify(message)
    onClose()
  }
  const back = (to: SetupStep) => (
    <Button className="modal-action-start" variant="ghost" disabled={busy} onClick={() => go(to)}>
      Back
    </Button>
  )
  const titles: Record<SetupStep, string> = {
    choose: 'Set up encryption',
    vault: 'Choose a vault password',
    creating: 'Creating your key…',
    existing: 'This address already has a key',
    replace: 'Create a new key instead?',
    import: 'Import your key',
    transfer: 'Transfer from another device',
    backup: 'Your key is ready',
    postpone: 'Back up later?',
  }
  const firstFound = found.find(isOwn) || found[0]
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy && step !== 'creating') onClose()
      }}
      title={titles[step]}
      description={
        ['choose', 'import', 'transfer'].includes(step) ? 'For ' + identity.email : undefined
      }
      className={dialogWidth}
    >
      {step === 'choose' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <Choice
            name="setup-method"
            icon={Key}
            title="Create a new key"
            checked={method === 'create'}
            onSelect={() => setMethod('create')}
          >
            Start here if you haven’t used encrypted mail with this address before.
          </Choice>
          <Choice
            name="setup-method"
            icon={FileImport}
            title="Import an existing key"
            checked={method === 'import'}
            onSelect={() => setMethod('import')}
          >
            Use a key file or backup from Thunderbird, GnuPG or another app.
          </Choice>
          <Choice
            name="setup-method"
            icon={DeviceSync}
            title="Transfer from another device"
            checked={method === 'transfer'}
            onSelect={() => setMethod('transfer')}
          >
            Use a Setup Message and the code shown on your other device.
          </Choice>
          <div
            className={cn(
              'key-explainer grid grid-cols-2 gap-4 mt-5 py-3.5 px-4 rounded-lg text-[11px] leading-[1.55] text-muted',
              'bg-[color-mix(in_srgb,_var(--hover)_55%,_transparent)] [&_strong]:block [&_strong]:text-[12px]',
              '[&_strong]:font-medium [&_strong]:text-secondary [&_strong]:mb-0.5',
            )}
          >
            <span>
              <strong>Public key</strong>
              Shared with your contacts automatically, so they can encrypt mail to you.
            </span>
            <span>
              <strong>Private key</strong>
              Opens your encrypted mail. It stays on this device,{' '}
              {secureStorage ? 'protected by your system keyring' : 'protected by a password'}.
            </span>
          </div>
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">
              Continue
            </Button>
          </div>
        </form>
      )}
      {step === 'vault' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
            if (!newPasswordProblem(vaultPassword, vaultConfirm)) next()
          }}
        >
          <p className={dialogLead}>
            Your system keyring isn’t available, so Inlark protects your keys with a password of
            their own. You’ll enter it whenever you unlock them.
          </p>
          <NewPasswordFields
            label="Vault password"
            password={vaultPassword}
            confirm={vaultConfirm}
            autoFocus
            showProblems={submitted}
            hint="At least 10 characters. If you forget it, only a key backup can restore access."
            onChange={(p, c) => {
              setVaultPassword(p)
              setVaultConfirm(c)
            }}
          />
          <div className={modalActions}>
            {back('choose')}
            <Button type="submit" variant="primary">
              Continue
            </Button>
          </div>
        </form>
      )}
      {step === 'creating' && (
        <div className="flex flex-col items-center text-center pt-3 pb-5 gap-3" role="status">
          <Spinner size={20} />
          <p className="m-0 text-[12px] text-muted">
            Checking that this address has no key yet, then creating yours.
          </p>
        </div>
      )}
      {step === 'existing' && (
        <>
          <p className={dialogLead}>
            {firstFound && isOwn(firstFound)
              ? 'A key for ' + identity.email + ' is already on this device.'
              : 'A key for ' +
                identity.email +
                ' was found in ' +
                (firstFound ? keySources(firstFound) : 'a key directory') +
                '.'}{' '}
            To keep reading mail encrypted to it, import its private key, for example from a backup
            or the app you created it in.
          </p>
          {firstFound && <FingerprintBlock value={firstFound.fingerprint} />}
          <div className={modalActions}>
            <Button className="modal-action-start" variant="ghost" onClick={() => go('replace')}>
              Create a new key instead
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setMethod('import')
                go('import')
              }}
            >
              Import existing key
            </Button>
          </div>
        </>
      )}
      {step === 'replace' && (
        <>
          <Callout tone="warning" icon={AlertCircle}>
            <p>
              Contacts who have your current key will see a new one and may need to review it. Mail
              encrypted to the old key can’t be read here unless you import that key later.
            </p>
          </Callout>
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            {back('existing')}
            <Button variant="primary" onClick={() => void create(true)}>
              Create new key
            </Button>
          </div>
        </>
      )}
      {step === 'import' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void importKey()
          }}
        >
          <p className={dialogLead}>
            Choose a file containing your private key, such as an exported <code>.asc</code> file or
            a backup. A public key alone isn’t enough.
          </p>
          <PasswordField
            label="Key file password"
            value={keyPassword}
            autoFocus
            onChange={(value) => {
              setKeyPassword(value)
              setError('')
            }}
            hint="The password you chose when exporting the key. Leave empty if it has none."
          />
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            {back('choose')}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Spinner size={14} /> : <FileImport size={14} />}
              Choose key file…
            </Button>
          </div>
        </form>
      )}
      {step === 'transfer' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void transfer()
          }}
        >
          <p className={dialogLead}>
            On your other device, choose to move your key. Then pick the Setup Message file it saves
            and enter the code it shows.
          </p>
          <label className="form-field block [&_input]:mt-1.5">
            Setup code
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13px] tracking-[0.5px]"
              placeholder="1234-5678-…"
              value={code}
              aria-invalid={!!error || undefined}
              onChange={(e) => {
                setCode(formatCode(e.target.value.replace(/\D/g, '').slice(0, 36)))
                setError('')
              }}
            />
            <span className="field-hint text-muted text-[11px] block mt-1.25">
              36 digits. Dashes are added for you.
            </span>
          </label>
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            {back('choose')}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Spinner size={14} /> : <DeviceSync size={14} />}
              Choose Setup Message…
            </Button>
          </div>
        </form>
      )}
      {step === 'backup' && own && (
        <>
          <Callout tone="success" icon={Check} className="mb-5">
            <p>
              Encryption is on for {identity.email}. Your key is{' '}
              <span className="font-mono text-foreground">{shortFingerprint(own.fingerprint)}</span>
              .
            </p>
          </Callout>
          <h4 className="mt-0 mb-1.5 text-[13px] font-medium text-strong">
            Next, back up your key
          </h4>
          <BackupForm
            fingerprint={own.fingerprint}
            unlock={unlock}
            lead={
              method === 'create'
                ? 'Without a backup, losing this computer means losing your encrypted mail. Resetting your email password can’t bring it back.'
                : 'If your original key file isn’t stored safely, save a backup now.'
            }
            onSaved={() => finish('Encryption is ready, and your key is backed up.')}
            secondary={
              <Button className="modal-action-start" variant="ghost" onClick={() => go('postpone')}>
                Back up later
              </Button>
            }
          />
        </>
      )}
      {step === 'postpone' && own && (
        <PostponeForm
          fingerprint={own.fingerprint}
          onBackUp={() => go('backup')}
          onDone={() => finish('Encryption is ready. Remember to back up your key.')}
        />
      )}
    </Modal>
  )
}

/** Exports an Autocrypt Setup Message and shows the code that opens it. */
function TransferDialog({
  target,
  unlock,
  onClose,
}: {
  target: Target
  unlock: () => Promise<boolean>
  onClose: () => void
}) {
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={code ? 'Enter this code on your other device' : 'Move your key to another device'}
      className={dialogWidth}
    >
      {!code ? (
        <>
          <p className={dialogLead}>
            Inlark saves a Setup Message: an encrypted file containing your key for{' '}
            {target.identity.email}. Copy it to your other device, open it in Inlark or another app
            that supports Autocrypt, and enter the code shown next.
          </p>
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  if (!(await unlock())) return
                  const result = await api.transferEncryption({
                    accountId: target.identity.accountId,
                    identityId: target.identity.id,
                    action: 'export',
                  })
                  if (result.code) setCode(result.code)
                } catch (e) {
                  setError(friendlyError(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy && <Spinner size={14} />}
              Save Setup Message…
            </Button>
          </div>
        </>
      ) : (
        <>
          <div
            className={cn(
              'setup-code grid grid-cols-3 gap-x-4 gap-y-2 py-4.5 px-5 rounded-lg bg-field border border-solid',
              'border-border font-mono text-[17px] tracking-[1px] text-strong text-center select-text tabular-nums',
            )}
            aria-label={'Setup code ' + code.replace(/-/g, ' ')}
          >
            {code.split('-').map((group, index) => (
              <span key={index}>{group}</span>
            ))}
          </div>
          <Callout tone="warning" icon={AlertCircle} className="mt-4">
            <p>
              Don’t send this code by email. Anyone with both the file and the code can use your
              key. It won’t be shown again.
            </p>
          </Callout>
          <div className={modalActions}>
            <Button
              className="modal-action-start"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy code'}
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** Swaps the key for an address. The old one stays, so older mail remains readable. */
function ReplaceDialog({
  target,
  unlock,
  onClose,
  onReplaced,
}: {
  target: Target
  unlock: () => Promise<boolean>
  onClose: () => void
  onReplaced: (key?: EncryptionKeySummary) => void
}) {
  const [method, setMethod] = useState<'create' | 'import'>('create')
  const [keyPassword, setKeyPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { identity, own } = target
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Replace your key?"
      description={'For ' + identity.email}
      className={dialogWidth}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            if (!(await unlock())) return
            const next = await api.setupEncryption({
              accountId: identity.accountId,
              identityId: identity.id,
              action: 'replace',
              importReplacement: method === 'import',
              keyPassword: keyPassword || undefined,
            })
            keysChanged(next)
            const mine = next.identities.find(ownedBy(identity))
            // An unchanged fingerprint means the file picker was cancelled.
            if (mine && mine.fingerprint !== own?.fingerprint)
              onReplaced(
                next.keys.find((k) => k.fingerprint === mine.fingerprint && k.email === mine.email),
              )
          } catch (e) {
            setError(method === 'import' ? keyFileError(e, keyPassword) : friendlyError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <p className={dialogLead}>
          Contacts will see a new key for this address and may need to review it. Your current key
          is kept, so you can still read mail encrypted to it.
        </p>
        <Choice
          name="replace-method"
          icon={Key}
          title="Create a new key"
          checked={method === 'create'}
          onSelect={() => setMethod('create')}
        >
          Generate a fresh key on this device.
        </Choice>
        <Choice
          name="replace-method"
          icon={FileImport}
          title="Import a key file"
          checked={method === 'import'}
          onSelect={() => setMethod('import')}
        >
          Use a private key you already have.
        </Choice>
        {method === 'import' && (
          <div className="mt-4">
            <PasswordField
              label="Key file password"
              value={keyPassword}
              onChange={setKeyPassword}
              hint="Leave empty if the file has none."
            />
          </div>
        )}
        {error && <FormError>{error}</FormError>}
        <div className={modalActions}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner size={14} />}
            {method === 'import' ? 'Choose key file…' : 'Replace key'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Revokes a key, then offers the revoked key to share so contacts stop using it. */
function RevokeDialog({
  keySummary,
  unlock,
  onClose,
}: {
  keySummary: EncryptionKeySummary
  unlock: () => Promise<boolean>
  onClose: () => void
}) {
  const [revoked, setRevoked] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={revoked ? 'Key revoked' : 'Revoke this key?'}
      description={'Key ' + shortFingerprint(keySummary.fingerprint) + ' · ' + keySummary.email}
      className={dialogWidth}
    >
      {!revoked ? (
        <>
          <p className={dialogLead}>
            Revoke a key if it may have been copied, or if you’ll never use it again. Contacts who
            receive the revocation stop encrypting to it. You can still read mail already encrypted
            to it. Encryption stays off for this address until you set up a new key.
          </p>
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            <Button onClick={onClose} disabled={busy}>
              Keep key
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  if (!(await unlock())) return
                  keysChanged(await api.revokeEncryptionKey(keySummary.fingerprint))
                  setRevoked(true)
                } catch (e) {
                  setError(friendlyError(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy && <Spinner size={14} />}
              Revoke key
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={dialogLead}>
            Share the revoked public key with your contacts, and with whoever runs your domain’s key
            directory, so they know to stop using it.
          </p>
          {error && <FormError>{error}</FormError>}
          <div className={modalActions}>
            <Button
              className="modal-action-start"
              variant="ghost"
              onClick={() =>
                void api
                  .exportEncryptionKey(keySummary.fingerprint, 'public')
                  .catch((e) => setError(friendlyError(e)))
              }
            >
              <Share size={14} />
              Export revoked key…
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** Adds a key used in the past, only to read older mail. */
function OlderKeyDialog({
  target,
  unlock,
  notify,
  onClose,
}: {
  target: Target
  unlock: () => Promise<boolean>
  notify: Notify
  onClose: () => void
}) {
  const [keyPassword, setKeyPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Import an older key"
      description={'For ' + target.identity.email}
      className={dialogWidth}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            if (!(await unlock())) return
            const before = await api.encryptionStatus()
            const next = await api.setupEncryption({
              accountId: target.identity.accountId,
              identityId: target.identity.id,
              action: 'historical',
              keyPassword: keyPassword || undefined,
            })
            keysChanged(next)
            // An unchanged list of private keys means the file picker was cancelled.
            if (next.keys.filter(isOwn).length !== before.keys.filter(isOwn).length) {
              notify('Older key imported. Mail encrypted to it can be read again.')
              onClose()
            }
          } catch (e) {
            setError(keyFileError(e, keyPassword))
          } finally {
            setBusy(false)
          }
        }}
      >
        <p className={dialogLead}>
          Import a private key you used before, so Inlark can open older mail encrypted to it. It
          won’t be used for new mail.
        </p>
        <PasswordField
          label="Key file password"
          value={keyPassword}
          autoFocus
          onChange={setKeyPassword}
          hint="Leave empty if the file has none."
        />
        {error && <FormError>{error}</FormError>}
        <div className={modalActions}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner size={14} /> : <FileImport size={14} />}
            Choose key file…
          </Button>
        </div>
      </form>
    </Modal>
  )
}
