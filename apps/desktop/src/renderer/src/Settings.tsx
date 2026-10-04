import { useEffect, useRef, useState } from 'react'
import { Wordmark } from '@inlark/ui/components/wordmark'
import appIcon from '../../../resources/icon.svg?no-inline'
import {
  Plus,
  ChevronDown,
  Mail,
  RefreshCw,
  Trash2,
  Copy,
  SlidersHorizontal,
  PenLine,
  Info,
  SettingsIcon,
  Folder,
  Send,
  SquarePen,
  Keyboard,
} from '@inlark/ui/icons'
import { Button, Dropdown, EmptyState, MenuItem, Modal, Select, Switch } from '@inlark/ui'
import {
  friendlyError,
  type Account,
  type AccountAppearance,
  type Settings as Preferences,
  type Bootstrap,
} from '@inlark/core'
import { api } from './api'
import { queryClient, purgeAccountCache } from './cache'
import { AccountAvatarPicker } from './AccountAvatarPicker'
import { SignatureSettings } from './SignatureSettings'
import { AccountSetup, type SetupMode } from './AccountSetup'
import { FolderMappingsDialog } from './FolderMappings'
import { IndexingMeter } from './IndexingMeter'
import { ShortcutEditor } from './ShortcutEditor'

/** A miniature of the app window in one theme. */
function ThemePreview({ theme, className }: { theme: 'dark' | 'light'; className?: string }) {
  return (
    <span className={'mini-window mini-window-' + theme + (className ? ' ' + className : '')}>
      <span className="mini-sidebar">
        <span className="mini-nav active" />
        <span className="mini-nav" />
        <span className="mini-nav" />
      </span>
      <span className="mini-list">
        {[0, 1, 2].map((row) => (
          <span className="mini-row" key={row}>
            <span className="mini-avatar" />
            <span className="mini-line" />
          </span>
        ))}
      </span>
    </span>
  )
}

/** Edits the parts of an account that don't need signing in again. */
function AccountDetailsForm({
  account,
  onDone,
  notify,
}: {
  account: Account
  onDone: () => void
  notify: (message: string, tone?: 'error' | 'info') => void
}) {
  const [name, setName] = useState(account.name)
  const [senderName, setSenderName] = useState(account.senderName || '')
  const [saving, setSaving] = useState(false)
  return (
    <form
      className="account-details-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        try {
          await api.updateAccountDetails(account.id, { name, senderName })
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
            // Identities carry the sending name, so the composer picks up the change.
            queryClient.invalidateQueries({ queryKey: ['identities', account.id] }),
          ])
          onDone()
        } catch (error) {
          notify(friendlyError(error), 'error')
        } finally {
          setSaving(false)
        }
      }}
    >
      <label className="form-field">
        Label
        <input
          autoFocus
          value={name}
          maxLength={100}
          placeholder="Personal"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="field-hint">Only you see this.</span>
      </label>
      <label className="form-field">
        Your name
        <input
          value={senderName}
          maxLength={100}
          autoComplete="name"
          placeholder="Jane Doe"
          onChange={(e) => setSenderName(e.target.value)}
        />
        <span className="field-hint">
          Recipients see{' '}
          <span className="sender-preview">
            {(senderName.trim() || 'Your server’s name') + ' <' + account.email + '>'}
          </span>
        </span>
      </label>
      <div className="account-details-actions">
        <Button size="small" onClick={onDone}>
          Cancel
        </Button>
        <Button size="small" variant="primary" type="submit" disabled={saving}>
          Save
        </Button>
      </div>
    </form>
  )
}

const afterArchiveOptions: { value: NonNullable<Preferences['afterArchive']>; label: string }[] = [
  { value: 'next', label: 'Open the next conversation' },
  { value: 'previous', label: 'Open the previous conversation' },
  { value: 'list', label: 'Return to the list' },
]

export function SettingsPanel({
  open,
  onClose,
  bootstrap,
  onChange,
  notify,
  initialTab = 'general',
}: {
  open: boolean
  onClose: () => void
  bootstrap: Bootstrap
  onChange: (settings: Preferences) => void
  notify: (message: string, tone?: 'error' | 'info') => void
  initialTab?: string
}) {
  // With nothing connected yet, opening Accounts can only mean adding one.
  const initialSetup = (): { mode: SetupMode } | undefined =>
    initialTab === 'accounts' && !bootstrap.accounts.length ? { mode: 'add' } : undefined
  const [tab, setTab] = useState(initialTab),
    [setup, setSetup] = useState<{ mode: SetupMode; account?: Account } | undefined>(initialSetup),
    [remove, setRemove] = useState<Account>(),
    [editing, setEditing] = useState<string>(),
    [folders, setFolders] = useState<Account>()
  const modalRef = useRef<HTMLDivElement>(null)
  /** Leaves setup and puts focus back where the account list starts. */
  const closeSetup = () => {
    setSetup(undefined)
    requestAnimationFrame(() => document.getElementById('settings-add-account')?.focus())
  }
  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setSetup(initialSetup())
    }
  }, [open, initialTab])
  const updateAppearance = (account: Account, appearance: AccountAppearance) => {
    // Show the change everywhere at once, and put it back if it cannot be saved.
    queryClient.setQueryData<Bootstrap>(
      ['bootstrap'],
      (old) =>
        old && {
          ...old,
          accounts: old.accounts.map((a) => (a.id === account.id ? { ...a, ...appearance } : a)),
        },
    )
    api.updateAccount(account.id, appearance).catch((e) => {
      notify(friendlyError(e), 'error')
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    })
  }
  const update = async (patch: Partial<Preferences>) => {
    try {
      const next = await api.settings({ ...bootstrap.settings, ...patch })
      onChange(next)
      return true
    } catch (e) {
      notify(friendlyError(e), 'error')
      return false
    }
  }
  return (
    <>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose()
        }}
        title="Settings"
        className="settings-modal"
        popupRef={modalRef}
      >
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {[
              ['general', 'General', SlidersHorizontal],
              ['accounts', 'Accounts', Mail],
              ['signatures', 'Signatures', PenLine],
              ['shortcuts', 'Shortcuts', Keyboard],
              ['about', 'About', Info],
            ].map(([id, name, Icon]) => {
              const Component = Icon as typeof Mail
              return (
                <button
                  key={String(id)}
                  aria-current={tab === id ? 'page' : undefined}
                  className={tab === id ? 'active' : ''}
                  onClick={() => {
                    setTab(String(id))
                    setSetup(undefined)
                  }}
                >
                  <Component size={15} />
                  {String(name)}
                </button>
              )
            })}
          </nav>
          <div className="settings-content">
            {tab === 'general' && (
              <>
                <h3>General</h3>
                <div className="setting-section">
                  <h4>Appearance</h4>
                  <div className="theme-options">
                    {(
                      [
                        ['dark', 'Dark'],
                        ['light', 'Light'],
                        ['system', 'System'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        className={
                          'theme-option' + (bootstrap.settings.theme === id ? ' chosen' : '')
                        }
                        aria-pressed={bootstrap.settings.theme === id}
                        onClick={() => void update({ theme: id })}
                      >
                        <span className="theme-preview" aria-hidden="true">
                          {id === 'system' ? (
                            <>
                              <ThemePreview theme="dark" />
                              <ThemePreview theme="light" className="theme-split" />
                            </>
                          ) : (
                            <ThemePreview theme={id} />
                          )}
                        </span>
                        <span className="theme-option-label">
                          <span className="theme-radio" />
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-section">
                  <h4>Reading</h4>
                  <div className="setting-row">
                    <div>
                      <strong>After archiving or deleting</strong>
                      <p>Where to go when a conversation leaves the list you’re reading.</p>
                    </div>
                    <Select
                      aria-label="After archiving or deleting"
                      className="setting-select"
                      value={bootstrap.settings.afterArchive || 'next'}
                      options={afterArchiveOptions}
                      onValueChange={(afterArchive) => void update({ afterArchive })}
                    />
                  </div>
                </div>
                <div className="setting-section">
                  <h4>Privacy</h4>
                  <div className="setting-row">
                    <div>
                      <strong>Load remote images</strong>
                      <p>Display images in incoming email and sender pictures automatically.</p>
                    </div>
                    <Switch
                      aria-label="Load remote images"
                      checked={bootstrap.settings.remoteImages}
                      onCheckedChange={(remoteImages) => void update({ remoteImages })}
                    />
                  </div>
                  <p className="setting-footnote">
                    Email images are requested directly, so senders may know when you read a
                    message. Gravatar receives a hash of each sender’s address; sender websites or
                    their icon hosts receive icon requests. If those fail, Twenty Icons receives the
                    sender’s root domain. DuckDuckGo receives it only if Twenty has no icon.
                  </p>
                </div>
                <div className="setting-section">
                  <h4>Desktop</h4>
                  <div className="setting-row">
                    <div>
                      <strong>New mail notifications</strong>
                      <p>Get notified when new conversations arrive.</p>
                    </div>
                    <Switch
                      aria-label="New mail notifications"
                      checked={bootstrap.settings.notifications}
                      onCheckedChange={(notifications) => void update({ notifications })}
                    />
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Keep running in the tray</strong>
                      <p>Keep checking for new mail after the window is closed.</p>
                    </div>
                    <Switch
                      aria-label="Keep running in the tray"
                      checked={bootstrap.settings.closeToTray}
                      onCheckedChange={(closeToTray) => void update({ closeToTray })}
                    />
                  </div>
                </div>
                {bootstrap.accounts.length > 1 && (
                  <div className="setting-section">
                    <h4>Writing</h4>
                    <div className="setting-row">
                      <div>
                        <strong>Default sending account</strong>
                        <p>New messages start from this account unless you’re in another one.</p>
                      </div>
                      <Select
                        aria-label="Default sending account"
                        className="setting-select"
                        value={
                          bootstrap.settings.defaultAccountId || bootstrap.accounts[0]?.id || ''
                        }
                        options={bootstrap.accounts.map((a) => ({
                          value: a.id,
                          label: a.name + ' · ' + a.email,
                        }))}
                        onValueChange={(defaultAccountId) => void update({ defaultAccountId })}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === 'accounts' &&
              (setup ? (
                <AccountSetup
                  key={setup.mode + ':' + (setup.account?.id || 'new')}
                  bootstrap={bootstrap}
                  existing={setup.account}
                  mode={setup.mode}
                  onBack={closeSetup}
                  onDone={(message) => {
                    closeSetup()
                    notify(message)
                  }}
                />
              ) : (
                <>
                  <div className="settings-section-heading">
                    <div>
                      <h3>Accounts</h3>
                    </div>
                    {!!bootstrap.accounts.length && (
                      <Button
                        size="small"
                        id="settings-add-account"
                        onClick={() => setSetup({ mode: 'add' })}
                      >
                        <Plus size={13} />
                        Add account
                      </Button>
                    )}
                  </div>
                  <div className="settings-accounts">
                    {bootstrap.accounts.map((account) => {
                      const protocol = account.protocol || 'jmap'
                      const needsSignIn =
                        (account.status !== 'connected' && account.status !== 'connecting') ||
                        !!account.outgoingError
                      return (
                        <div className="settings-account-entry" key={account.id}>
                          <div className="settings-account">
                            <AccountAvatarPicker
                              name={account.name}
                              email={account.email}
                              value={{ seed: account.seed, image: account.image }}
                              portalContainer={modalRef}
                              onChange={(appearance) => updateAppearance(account, appearance)}
                              onError={(e) => notify(friendlyError(e), 'error')}
                            />
                            <div className="settings-account-text">
                              <strong>
                                {account.name}
                                <span
                                  className="protocol-tag"
                                  title={
                                    protocol === 'imap'
                                      ? 'Connected with IMAP and SMTP'
                                      : 'Connected with JMAP'
                                  }
                                >
                                  {protocol.toUpperCase()}
                                </span>
                              </strong>
                              <span className="settings-account-email">{account.email}</span>
                              <small
                                className={
                                  account.status === 'connected' ? 'connected' : 'connection-error'
                                }
                              >
                                <span className="connection-dot" />
                                {account.status === 'connected'
                                  ? account.outgoingError
                                    ? 'Receiving mail'
                                    : account.sessionOnly
                                      ? 'Connected · session only'
                                      : 'Connected'
                                  : account.status === 'connecting'
                                    ? 'Connecting…'
                                    : account.error || 'Disconnected'}
                              </small>
                              {account.outgoingError && (
                                <small className="connection-error outgoing-error">
                                  <Send size={11} />
                                  <span>Sending unavailable: {account.outgoingError}</span>
                                </small>
                              )}
                              {account.indexing && !account.indexing.complete && (
                                <small className="account-indexing">
                                  <IndexingMeter indexing={account.indexing} />
                                </small>
                              )}
                            </div>
                            <div className="account-actions">
                              {needsSignIn && (
                                <Button
                                  size="small"
                                  onClick={() => setSetup({ mode: 'signIn', account })}
                                >
                                  Sign in again
                                </Button>
                              )}
                              <Dropdown
                                container={modalRef}
                                className="settings-account-menu"
                                trigger={
                                  <Button
                                    size="small"
                                    className="account-manage-trigger"
                                    aria-label={'Manage ' + account.name + ' account'}
                                  >
                                    Manage
                                    <ChevronDown size={13} />
                                  </Button>
                                }
                              >
                                <MenuItem
                                  onClick={() =>
                                    setEditing(editing === account.id ? undefined : account.id)
                                  }
                                >
                                  <SquarePen size={14} />
                                  Edit label and name
                                </MenuItem>
                                <MenuItem onClick={() => setSetup({ mode: 'edit', account })}>
                                  <SettingsIcon size={14} />
                                  Edit connection…
                                </MenuItem>
                                {protocol === 'imap' && (
                                  <MenuItem onClick={() => setFolders(account)}>
                                    <Folder size={14} />
                                    Folders…
                                  </MenuItem>
                                )}
                                <MenuItem
                                  onClick={() =>
                                    void api
                                      .reconnect(account.connectionId)
                                      .then(() => notify('Reconnected.'))
                                      .catch((e) => notify(friendlyError(e), 'error'))
                                  }
                                >
                                  <RefreshCw size={14} />
                                  Reconnect
                                </MenuItem>
                                <div className="account-menu-divider" />
                                <MenuItem danger onClick={() => setRemove(account)}>
                                  <Trash2 size={14} />
                                  Remove account…
                                </MenuItem>
                              </Dropdown>
                            </div>
                          </div>
                          {editing === account.id && (
                            <AccountDetailsForm
                              account={account}
                              onDone={() => setEditing(undefined)}
                              notify={notify}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {!bootstrap.accounts.length && (
                    <div className="no-accounts">
                      <EmptyState
                        icon={Mail}
                        title="No accounts yet"
                        description="Connect a JMAP or IMAP account to start reading and sending mail."
                      >
                        <Button onClick={() => setSetup({ mode: 'add' })} variant="primary">
                          <Plus size={13} />
                          Connect an account
                        </Button>
                      </EmptyState>
                    </div>
                  )}
                </>
              ))}
            {tab === 'signatures' && (
              <>
                <h3>Signatures</h3>
                {bootstrap.accounts.length ? (
                  <>
                    <p className="settings-lead">
                      Added to new messages, replies and forwards. Write plain text or HTML. Changes
                      save as you type.
                    </p>
                    <SignatureSettings
                      accounts={bootstrap.accounts}
                      signatures={{
                        signatures: bootstrap.settings.signatures,
                        htmlSignatures: bootstrap.settings.htmlSignatures,
                      }}
                      remoteImages={bootstrap.settings.remoteImages}
                      onSave={update}
                    />
                  </>
                ) : (
                  <div className="no-accounts">
                    <EmptyState
                      icon={PenLine}
                      title="No signatures yet"
                      description="Each account has its own signature. Connect an account to write one."
                    >
                      <Button
                        onClick={() => {
                          setTab('accounts')
                          setSetup({ mode: 'add' })
                        }}
                        variant="primary"
                      >
                        <Plus size={13} />
                        Connect an account
                      </Button>
                    </EmptyState>
                  </div>
                )}
              </>
            )}
            {tab === 'shortcuts' && (
              <>
                <h3>Keyboard shortcuts</h3>
                <p className="settings-lead">
                  Click any keys to change them, or + to add another. Changes save right away.
                </p>
                <ShortcutEditor />
              </>
            )}
            {tab === 'about' && (
              <>
                <div className="about-hero">
                  <img className="about-mark" src={appIcon} alt="" width={52} height={52} />
                  <div>
                    <h3>
                      <Wordmark height={24} />
                    </h3>
                    <p>A desktop email client for JMAP and IMAP servers.</p>
                  </div>
                  <span className="about-version">Version {bootstrap.version}</span>
                </div>
                <div className="setting-section">
                  <h4>Privacy</h4>
                  <div className="setting-row">
                    <div>
                      <strong>Direct connection</strong>
                      <p>
                        Inlark connects straight to your mail server. No account or cloud service in
                        between.
                      </p>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>No telemetry</strong>
                      <p>Inlark collects no usage data or analytics.</p>
                    </div>
                  </div>
                </div>
                <div className="setting-section">
                  <h4>Troubleshooting</h4>
                  <div className="setting-row">
                    <div>
                      <strong>Diagnostics</strong>
                      <p>
                        Includes the app version and connection states. Excludes credentials,
                        addresses, and message content.
                      </p>
                    </div>
                    <Button
                      onClick={async () => {
                        try {
                          const diagnostics = await api.diagnostics()
                          await navigator.clipboard.writeText(diagnostics)
                          notify('Redacted diagnostics copied.')
                        } catch (e) {
                          notify(friendlyError(e), 'error')
                        }
                      }}
                    >
                      <Copy size={14} />
                      Copy diagnostics
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>
      <FolderMappingsDialog
        key={folders?.id || 'folders-closed'}
        account={folders}
        onClose={() => setFolders(undefined)}
        notify={notify}
      />
      <Modal
        open={!!remove}
        onOpenChange={(value) => {
          if (!value) setRemove(undefined)
        }}
        title="Remove this account?"
        description="This removes the connection, local cached mail, and local drafts for this connection. Mail on the server stays where it is."
      >
        <div className="modal-actions">
          <Button onClick={() => setRemove(undefined)}>Keep account</Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!remove) return
              try {
                const ids = bootstrap.accounts
                  .filter((a) => a.connectionId === remove.connectionId)
                  .map((a) => a.id)
                await api.disconnect(remove.connectionId)
                await purgeAccountCache(ids)
                await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
                setRemove(undefined)
                notify('Account removed from this device.')
              } catch (e) {
                notify(friendlyError(e), 'error')
              }
            }}
          >
            Remove account
          </Button>
        </div>
      </Modal>
    </>
  )
}
