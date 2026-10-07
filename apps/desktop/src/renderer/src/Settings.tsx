import { cn } from '@inlark/ui'
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
    <span
      className={cn(
        'mini-window [--w-bg:#171718] [--w-sidebar:#111112] [--w-border:#ffffff12] [--w-line:#ffffff17]',
        '[--w-nav:#ffffff12] [--w-accent:#aaa6ec] inset-0 absolute grid grid-cols-[30%_1fr] bg-[var(--w-sidebar)]',
        theme === 'light' &&
          'mini-window-light [--w-bg:#ffffff] [--w-sidebar:#f2f3f5] [--w-border:#17191f14] [--w-line:#17191f17] [--w-nav:#17191f12] [--w-accent:#6962c1]',
        className,
      )}
    >
      <span className="mini-sidebar flex flex-col gap-[7%] py-[18%] px-[14%]">
        <span className="mini-nav h-1.25 rounded-[2px] bg-[var(--w-nav)] [&.active]:bg-[color-mix(in_srgb,_var(--w-accent)_45%,_transparent)] last:w-[70%] active" />
        <span className="mini-nav h-1.25 rounded-[2px] bg-[var(--w-nav)] [&.active]:bg-[color-mix(in_srgb,_var(--w-accent)_45%,_transparent)] last:w-[70%]" />
        <span className="mini-nav h-1.25 rounded-[2px] bg-[var(--w-nav)] [&.active]:bg-[color-mix(in_srgb,_var(--w-accent)_45%,_transparent)] last:w-[70%]" />
      </span>
      <span className="mini-list shadow-[0_0_0_1px_var(--w-border)] flex flex-col gap-[12%] mt-[10%] pt-[12%] pb-0 px-[12%] rounded-tl-[6px] bg-[var(--w-bg)]">
        {[0, 1, 2].map((row) => (
          <span
            className="mini-row [&:nth-child(2)_.mini-line]:flex-[0_1_70%] [&:nth-child(3)_.mini-line]:flex-[0_1_85%] flex items-center gap-[8%]"
            key={row}
          >
            <span className="mini-avatar w-2.25 h-2.25 shrink-0 rounded-full bg-[color-mix(in_srgb,_var(--w-accent)_60%,_transparent)]" />
            <span className="mini-line flex-1 h-1.25 rounded-[2px] bg-[var(--w-line)]" />
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
      className="account-details-form [&_.form-field]:mt-0 grid grid-cols-[1fr_1fr] gap-[0_14px] -mt-1 mb-0 mx-0 pt-0 pb-4.5 pr-0 pl-11.5"
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
      <label className="form-field mt-3.75 [&_input]:mt-1.5 [&_input]:text-[12px] [&_input[aria-invalid='true']]:border-danger/70">
        Label
        <input
          autoFocus
          value={name}
          maxLength={100}
          placeholder="Personal"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="field-hint text-muted text-[11px] block mt-1.25">Only you see this.</span>
      </label>
      <label className="form-field mt-3.75 [&_input]:mt-1.5 [&_input]:text-[12px] [&_input[aria-invalid='true']]:border-danger/70">
        Your name
        <input
          value={senderName}
          maxLength={100}
          autoComplete="name"
          placeholder="Jane Doe"
          onChange={(e) => setSenderName(e.target.value)}
        />
        <span className="field-hint text-muted text-[11px] block mt-1.25">
          Recipients see{' '}
          <span className="sender-preview [overflow-wrap:anywhere] text-secondary">
            {(senderName.trim() || 'Your server’s name') + ' <' + account.email + '>'}
          </span>
        </span>
      </label>
      <div className="account-details-actions col-span-full flex justify-end gap-2 mt-3.5">
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
        className={cn(
          'settings-modal [&>.modal-heading]:absolute [&>.modal-heading]:inset-x-0 [&>.modal-heading]:top-0',
          '[&>.modal-heading]:z-1 [&>.modal-heading]:items-center [&>.modal-heading]:m-0 [&>.modal-heading]:pt-3.5',
          '[&>.modal-heading]:pb-0 [&>.modal-heading]:pr-3.5 [&>.modal-heading]:pl-5',
          '[&>.modal-heading]:pointer-events-none [&>.modal-heading>*]:pointer-events-auto [&_.modal-title]:text-[12px]',
          '[&_.modal-title]:font-medium [&_.modal-title]:tracking-[0] [&_.modal-title]:text-muted',
          '[&>.modal-heading>.button]:text-muted max-[700px]:[&>.modal-heading]:pl-4 w-[min(880px,_calc(100vw_-_40px))]',
          'p-0 overflow-visible',
        )}
        popupRef={modalRef}
      >
        <div className="settings-layout flex min-h-0 h-[min(620px,_calc(100dvh_-_80px_-_var(--titlebar-height)))] overflow-hidden rounded-[inherit]">
          <nav
            className={cn(
              'settings-nav w-50 shrink-0 bg-sidebar pt-12.5 pb-3 px-2.5 flex flex-col gap-[2px] border-r border-solid',
              'border-r-border max-[700px]:w-34 max-[700px]:pt-12.5 max-[700px]:pb-3 max-[700px]:px-2',
            )}
            aria-label="Settings sections"
          >
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
                  className={cn(
                    'flex gap-2.5 items-center h-8 bg-transparent border-0 py-0 px-2.5 text-left text-secondary rounded-md',
                    'transition-[color,background] duration-120 ease-[ease] text-[13px] hover:bg-hover hover:text-foreground',
                    'max-[700px]:px-2 max-[700px]:text-[12px] max-[700px]:gap-1.75',
                    tab === id &&
                      'active bg-selected hover:bg-selected text-strong hover:text-strong font-medium',
                  )}
                  onClick={() => {
                    setTab(String(id))
                    setSetup(undefined)
                  }}
                >
                  <Component className={cn('text-muted', tab === id && 'text-strong')} size={15} />
                  {String(name)}
                </button>
              )
            })}
          </nav>
          <div
            className={cn(
              'settings-content flex-1 overflow-auto pt-12 pb-10 px-12 min-w-0',
              'max-[700px]:pt-12 max-[700px]:pb-5 max-[700px]:px-5',
            )}
          >
            {tab === 'general' && (
              <>
                <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">General</h3>
                <div
                  className={cn(
                    'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                    '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                    '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                  )}
                >
                  <h4>Appearance</h4>
                  <div className="theme-options grid grid-cols-[repeat(3,_1fr)] gap-3.5 max-[700px]:gap-2.5">
                    {(
                      [
                        ['dark', 'Dark'],
                        ['light', 'Light'],
                        ['system', 'System'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        className={cn(
                          'theme-option flex flex-col gap-2.5 min-w-0 p-0 border-0 bg-none bg-transparent text-secondary text-[12px]',
                          'text-left focus-visible:outline-none [&:hover:not(.chosen):not(:focus-visible)_.theme-preview]:shadow-[0_0_0_1px_var(--faint)]',
                          '[&.chosen_.theme-preview]:shadow-[0_0_0_2px_var(--surface),_0_0_0_4px_var(--accent-solid)]',
                          '[&:focus-visible_.theme-preview]:shadow-[0_0_0_2px_var(--surface),_0_0_0_4px_var(--accent-solid)]',
                          '[&.chosen_.theme-option-label]:text-strong [&.chosen_.theme-radio]:shadow-[inset_0_0_0_4px_var(--accent-solid)]',
                          bootstrap.settings.theme === id && 'chosen',
                        )}
                        aria-pressed={bootstrap.settings.theme === id}
                        onClick={() => void update({ theme: id })}
                      >
                        <span
                          className="theme-preview relative block aspect-[16_/_10] rounded-lg overflow-hidden shadow-[0_0_0_1px_var(--border-strong)] transition-[box-shadow] duration-120 ease-[ease]"
                          aria-hidden="true"
                        >
                          {id === 'system' ? (
                            <>
                              <ThemePreview theme="dark" />
                              <ThemePreview
                                theme="light"
                                className="theme-split [clip-path:inset(0_0_0_50%)]"
                              />
                            </>
                          ) : (
                            <ThemePreview theme={id} />
                          )}
                        </span>
                        <span className="theme-option-label flex items-center gap-2 pl-[2px]">
                          <span className="theme-radio w-3.5 h-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--faint)] transition-[box-shadow] duration-120 ease-[ease]" />
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className={cn(
                    'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                    '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                    '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                  )}
                >
                  <h4>Reading</h4>
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
                    <div>
                      <strong>After archiving or deleting</strong>
                      <p>Where to go when a conversation leaves the list you’re reading.</p>
                    </div>
                    <Select
                      aria-label="After archiving or deleting"
                      className="setting-select w-auto min-w-60 shrink-0"
                      value={bootstrap.settings.afterArchive || 'next'}
                      options={afterArchiveOptions}
                      onValueChange={(afterArchive) => void update({ afterArchive })}
                    />
                  </div>
                </div>
                <div
                  className={cn(
                    'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                    '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                    '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                  )}
                >
                  <h4>Privacy</h4>
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
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
                  <p className="setting-footnote text-faint text-[12px] leading-[1.6]">
                    Email images are requested directly, so senders may know when you read a
                    message. Gravatar receives a hash of each sender’s address; sender websites or
                    their icon hosts receive icon requests. If those fail, Twenty Icons receives the
                    sender’s root domain. DuckDuckGo receives it only if Twenty has no icon.
                  </p>
                </div>
                <div
                  className={cn(
                    'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                    '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                    '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                  )}
                >
                  <h4>Desktop</h4>
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
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
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
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
                  <div
                    className={cn(
                      'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                      '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                      '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                    )}
                  >
                    <h4>Writing</h4>
                    <div
                      className={cn(
                        'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                        '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                        '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                      )}
                    >
                      <div>
                        <strong>Default sending account</strong>
                        <p>New messages start from this account unless you’re in another one.</p>
                      </div>
                      <Select
                        aria-label="Default sending account"
                        className="setting-select w-auto min-w-60 shrink-0"
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
                  <div className="settings-section-heading flex justify-between items-start gap-2.5">
                    <div>
                      <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">Accounts</h3>
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
                        <div
                          className="settings-account-entry border-b border-solid border-b-border"
                          key={account.id}
                        >
                          <div
                            className={cn(
                              'settings-account [&_strong]:block [&_strong]:font-medium [&_small]:flex [&_small]:gap-1.25',
                              '[&_small]:items-center [&_small]:text-[11px] [&_small]:mt-1 [&_strong]:text-[13px]',
                              '[&_strong_.protocol-tag]:ml-2 [&_strong_.protocol-tag]:[vertical-align:1px] [&_strong_.protocol-tag]:h-4',
                              '[&_strong_.protocol-tag]:text-[9px] [&_small.outgoing-error]:items-start [&_small.outgoing-error]:mt-[3px]',
                              '[&_small.outgoing-error_svg]:shrink-0 [&_small.outgoing-error_svg]:mt-[2px] flex items-center gap-2.5 py-4.5',
                              'px-0',
                            )}
                          >
                            <AccountAvatarPicker
                              name={account.name}
                              email={account.email}
                              value={{ seed: account.seed, image: account.image }}
                              portalContainer={modalRef}
                              onChange={(appearance) => updateAppearance(account, appearance)}
                              onError={(e) => notify(friendlyError(e), 'error')}
                            />
                            <div className="settings-account-text flex-1 min-w-0">
                              <strong>
                                {account.name}
                                <span
                                  className={cn(
                                    'protocol-tag inline-flex items-center h-4.5 py-0 px-1.5 border border-solid border-border-strong rounded-xs',
                                    'text-[10px] font-medium tracking-[0.3px] text-muted whitespace-nowrap shrink-0',
                                  )}
                                  title={
                                    protocol === 'imap'
                                      ? 'Connected with IMAP and SMTP'
                                      : 'Connected with JMAP'
                                  }
                                >
                                  {protocol.toUpperCase()}
                                </span>
                              </strong>
                              <span className="settings-account-email block text-muted text-[12px] leading-[1.6]">
                                {account.email}
                              </span>
                              <small
                                className={cn(
                                  account.status === 'connected'
                                    ? 'connected text-success'
                                    : 'connection-error [&_.connection-dot]:bg-danger text-danger',
                                )}
                              >
                                <span className="connection-dot w-1.25 h-1.25 rounded-full bg-success inline-block shrink-0" />
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
                                <small className="connection-error [&_.connection-dot]:bg-danger text-danger outgoing-error">
                                  <Send size={11} />
                                  <span>Sending unavailable: {account.outgoingError}</span>
                                </small>
                              )}
                              {account.indexing && !account.indexing.complete && (
                                <small className="account-indexing text-muted">
                                  <IndexingMeter indexing={account.indexing} />
                                </small>
                              )}
                            </div>
                            <div className="account-actions flex gap-1">
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
                                className="settings-account-menu [&_.menu-item]:min-h-7.75 w-55"
                                trigger={
                                  <Button
                                    size="small"
                                    className="account-manage-trigger data-popup-open:bg-hover data-popup-open:text-strong [&[data-popup-open]_svg]:transform-[rotate(180deg)]"
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
                                <div className="account-menu-divider h-[1px] m-1.25 bg-border" />
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
                    <div className="no-accounts [&_.empty-state]:pb-12 flex min-h-90">
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
                <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">Signatures</h3>
                {bootstrap.accounts.length ? (
                  <>
                    <p className="settings-lead text-muted mt-1.5 mb-6 mx-0 text-[12px] leading-[1.6]">
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
                  <div className="no-accounts [&_.empty-state]:pb-12 flex min-h-90">
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
                <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">Keyboard shortcuts</h3>
                <p className="settings-lead text-muted mt-1.5 mb-6 mx-0 text-[12px] leading-[1.6]">
                  Click any keys to change them, or + to add another. Changes save right away.
                </p>
                <ShortcutEditor />
              </>
            )}
            {tab === 'about' && (
              <>
                <div
                  className={cn(
                    'about-hero [&>div]:flex-1 [&>div]:min-w-0 [&_p]:text-muted [&_p]:text-[12px] [&_p]:mt-[3px] [&_p]:mb-0',
                    '[&_p]:mx-0 flex items-center gap-4 pb-6.5 border-b border-solid border-b-border',
                  )}
                >
                  <img
                    className="about-mark w-13 h-13 block shrink-0"
                    src={appIcon}
                    alt=""
                    width={52}
                    height={52}
                  />
                  <div>
                    <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">
                      <Wordmark height={24} />
                    </h3>
                    <p>A desktop email client for JMAP and IMAP servers.</p>
                  </div>
                  <span className="about-version shrink-0 py-[3px] px-2 border border-solid border-border-strong rounded-3xl text-secondary text-[11px] tabular-nums">
                    Version {bootstrap.version}
                  </span>
                </div>
                <div
                  className={cn(
                    'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                    '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                    '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                  )}
                >
                  <h4>Privacy</h4>
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
                    <div>
                      <strong>Direct connection</strong>
                      <p>
                        Inlark connects straight to your mail server. No account or cloud service in
                        between.
                      </p>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
                    <div>
                      <strong>No telemetry</strong>
                      <p>Inlark collects no usage data or analytics.</p>
                    </div>
                  </div>
                </div>
                <div
                  className={cn(
                    'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
                    '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
                    '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
                  )}
                >
                  <h4>Troubleshooting</h4>
                  <div
                    className={cn(
                      'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
                      '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
                      '[&_strong]:text-[13px] max-[700px]:gap-3.5',
                    )}
                  >
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
        <div
          className={cn(
            'modal-actions flex justify-end gap-2 mt-6 [&>.modal-action-start]:mr-auto [&>.modal-action-start]:-ml-2.5',
            '[&>.modal-action-start]:text-muted [&>.modal-action-start:hover:not(:disabled)]:text-danger',
          )}
        >
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
