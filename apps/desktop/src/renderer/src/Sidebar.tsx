import { useEffect, useState } from 'react'
import {
  Archive,
  ChevronDown,
  Folder,
  Inbox,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  SquarePen,
  Settings as SettingsIcon,
  ShieldX,
  Star,
  Trash2,
  FileText,
  WifiOff,
} from '@inlark/ui/icons'
import { Button, Dropdown, IconButton, MenuItem, Spinner } from '@inlark/ui'
import type { Account, Mailbox, View } from '@inlark/core'
import appIcon from '../../../resources/icon-mark.svg?no-inline'
import { AccountMark } from './AccountMark'

export const views: { id: View; title: string; icon: typeof Inbox; key?: string }[] = [
  { id: 'inbox', title: 'Inbox', icon: Inbox, key: 'G I' },
  { id: 'starred', title: 'Starred', icon: Star, key: 'G S' },
  { id: 'sent', title: 'Sent', icon: Send, key: 'G T' },
  { id: 'drafts', title: 'Drafts', icon: FileText, key: 'G D' },
  { id: 'archive', title: 'Archive', icon: Archive, key: 'G A' },
  { id: 'junk', title: 'Spam', icon: ShieldX },
  { id: 'trash', title: 'Trash', icon: Trash2 },
]
const statusLabel: Record<Account['status'], string> = {
  connecting: 'connecting',
  connected: 'connected',
  offline: 'offline',
  authentication: 'needs sign-in',
  error: 'unavailable',
}
export function Sidebar({
  accounts,
  boxesByAccount,
  route,
  view,
  draftCount,
  hasServerDrafts,
  sendingIssues,
  unreadCount,
  accountUnread,
  collapsed,
  onToggleCollapsed,
  onSearch,
  onCompose,
  onNavigate,
  onSettings,
  onFolderAction,
}: {
  accounts: Account[]
  boxesByAccount: Record<string, Mailbox[]>
  route: { account?: string; folder?: string; q?: string }
  view: View
  draftCount: number
  hasServerDrafts: boolean
  /** Sends that still need a decision, shown in Drafts. */
  sendingIssues: number
  unreadCount: number
  accountUnread: Record<string, number>
  collapsed: boolean
  onToggleCollapsed: () => void
  onSearch: () => void
  onCompose: () => void
  onNavigate: (next: { view: View; account?: string; folder?: string }) => void
  onSettings: (tab: 'accounts' | 'general') => void
  onFolderAction: (
    operation: 'create' | 'rename' | 'delete',
    accountId: string,
    folder?: Mailbox,
  ) => void
}) {
  const go = onNavigate
  // Transient connecting states already show a spinner on the account row.
  const unavailable = accounts.filter((a) => a.status !== 'connected' && a.status !== 'connecting')
  const statusText =
    unavailable.length === 1
      ? unavailable[0].name + ' ' + statusLabel[unavailable[0].status]
      : unavailable.length + ' accounts unavailable'
  const sendingText =
    sendingIssues === 1
      ? '1 sent message needs attention'
      : sendingIssues + ' sent messages need attention'
  const [accountsExpanded, setAccountsExpanded] = useState(
    () => localStorage.getItem('sidebar-accounts-expanded') !== 'false',
  )
  const [accountExpanded, setAccountExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sidebar-account-expanded') || '{}')
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    localStorage.setItem('sidebar-accounts-expanded', String(accountsExpanded))
  }, [accountsExpanded])
  useEffect(() => {
    localStorage.setItem('sidebar-account-expanded', JSON.stringify(accountExpanded))
  }, [accountExpanded])
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-mark" src={appIcon} alt="" width={24} height={24} />
        {!collapsed && <strong>Inlark</strong>}
      </div>
      <div className="sidebar-tools">
        <IconButton label="Search and commands" shortcut="Ctrl K" onClick={onSearch}>
          <Search size={14} />
        </IconButton>
        <IconButton className="sidebar-compose" label="Compose" shortcut="C" onClick={onCompose}>
          <SquarePen size={16} />
        </IconButton>
      </div>
      <div className="sidebar-scroll">
        <nav className="main-nav" aria-label="Mail views">
          {views
            .filter(
              (v) =>
                v.id !== 'drafts' ||
                draftCount > 0 ||
                hasServerDrafts ||
                sendingIssues > 0 ||
                view === 'drafts',
            )
            .map((v) => (
              <button
                key={v.id}
                title={
                  v.title +
                  (v.id === 'inbox' ? ' · ' + unreadCount + ' unread' : '') +
                  (v.key ? ' · ' + v.key : '')
                }
                aria-current={
                  view === v.id && !route.account && !route.folder && !route.q ? 'page' : undefined
                }
                className={
                  'nav-item ' +
                  (v.id === 'archive' ? 'nav-secondary-start ' : '') +
                  (view === v.id && !route.account && !route.folder && !route.q ? 'active' : '')
                }
                onClick={() => go({ view: v.id })}
              >
                <v.icon size={16} strokeWidth={1.65} />
                {!collapsed && (
                  <>
                    <span>{v.title}</span>
                    {v.id === 'drafts' && draftCount > 0 && <small>{draftCount}</small>}
                    {v.id === 'inbox' && unreadCount > 0 && (
                      <small>{unreadCount.toLocaleString()}</small>
                    )}
                  </>
                )}
              </button>
            ))}
        </nav>
        {accounts.length > 0 && (
          <div className="sidebar-section-label">
            {!collapsed && (
              <button
                className="sidebar-section-toggle"
                aria-expanded={accountsExpanded}
                onClick={() => setAccountsExpanded((open) => !open)}
              >
                <span>Accounts</span>
                <ChevronDown size={12} className={accountsExpanded ? '' : 'closed'} />
              </button>
            )}
          </div>
        )}
        {accounts.length > 0 && (accountsExpanded || collapsed) && (
          <nav className="account-nav" id="sidebar-accounts" aria-label="Accounts">
            {accounts.map((a) => {
              const expanded = accountExpanded[a.id] !== false
              return (
                <div className="account-tree" key={a.id}>
                  <button
                    className={
                      'nav-item account-toggle ' + (route.account === a.id ? 'account-current' : '')
                    }
                    title={
                      a.email +
                      ' · ' +
                      (a.status === 'connected' ? (accountUnread[a.id] || 0) + ' unread' : a.status)
                    }
                    aria-expanded={collapsed ? undefined : expanded}
                    aria-label={collapsed ? a.name + ' inbox' : undefined}
                    onClick={() => {
                      if (collapsed) go({ view: 'inbox', account: a.id })
                      else setAccountExpanded((state) => ({ ...state, [a.id]: !expanded }))
                    }}
                  >
                    <AccountMark
                      account={a}
                      size={18}
                      className={a.status !== 'connected' ? 'disconnected' : undefined}
                    />
                    {!collapsed && (
                      <>
                        <span>{a.name}</span>
                        {a.status === 'connecting' ? (
                          <Spinner size={11} />
                        ) : a.status !== 'connected' ? (
                          <WifiOff
                            size={12}
                            className="account-offline"
                            aria-label="Not connected"
                          />
                        ) : accountUnread[a.id] ? (
                          <small>{accountUnread[a.id].toLocaleString()}</small>
                        ) : null}
                        <ChevronDown
                          size={12}
                          className={'account-chevron ' + (expanded ? '' : 'closed')}
                        />
                      </>
                    )}
                  </button>
                  {!collapsed && expanded && (
                    <div
                      className="account-children"
                      id={'account-folders-' + a.id}
                      role="group"
                      aria-label={a.name + ' folders'}
                    >
                      {views
                        .filter((v) => v.id !== 'drafts')
                        .map((v) => (
                          <button
                            key={v.id}
                            className={
                              'nav-item ' +
                              (route.account === a.id && !route.folder && !route.q && view === v.id
                                ? 'active'
                                : '')
                            }
                            aria-current={
                              route.account === a.id && !route.folder && !route.q && view === v.id
                                ? 'page'
                                : undefined
                            }
                            onClick={() => go({ view: v.id, account: a.id })}
                          >
                            <v.icon size={15} strokeWidth={1.65} />
                            <span>{v.title}</span>
                            {v.id === 'inbox' && accountUnread[a.id] > 0 && (
                              <small>{accountUnread[a.id].toLocaleString()}</small>
                            )}
                          </button>
                        ))}
                      {(boxesByAccount[a.id] || [])
                        .filter((b) => !b.role)
                        .map((b) => (
                          <div className="folder-nav-row" key={b.id}>
                            <button
                              className={
                                'nav-item ' +
                                (route.folder === b.id && route.account === a.id ? 'active' : '')
                              }
                              aria-current={
                                route.folder === b.id && route.account === a.id ? 'page' : undefined
                              }
                              onClick={() => go({ view: 'all', account: a.id, folder: b.id })}
                            >
                              <Folder size={14} />
                              <span>{b.name}</span>
                              {b.unreadEmails > 0 && (
                                <small>{b.unreadEmails.toLocaleString()}</small>
                              )}
                            </button>
                            <Dropdown
                              trigger={
                                <Button variant="ghost" size="icon" aria-label={'Manage ' + b.name}>
                                  <MoreHorizontal size={13} />
                                </Button>
                              }
                            >
                              <MenuItem
                                disabled={!b.rights.mayRename}
                                onClick={() => onFolderAction('rename', a.id, b)}
                              >
                                Rename folder
                              </MenuItem>
                              <MenuItem
                                danger
                                disabled={!b.rights.mayDelete}
                                onClick={() => onFolderAction('delete', a.id, b)}
                              >
                                Delete folder
                              </MenuItem>
                            </Dropdown>
                          </div>
                        ))}
                      <button
                        className="nav-item account-create-folder"
                        onClick={() => onFolderAction('create', a.id)}
                      >
                        <Plus size={14} />
                        <span>New folder</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        )}
      </div>
      <div className="sidebar-bottom">
        {sendingIssues > 0 && (
          <button
            className={'nav-item sidebar-sending' + (view === 'drafts' ? ' active' : '')}
            title={sendingText + ' · review in Drafts'}
            aria-label={sendingText + '. Review in Drafts.'}
            onClick={() => go({ view: 'drafts' })}
          >
            <Send size={15} strokeWidth={1.65} />
            {!collapsed && (
              <>
                <span>Send status</span>
                <small>{sendingIssues}</small>
              </>
            )}
          </button>
        )}
        {unavailable.length > 0 && (
          <button
            className="nav-item sidebar-status"
            title={unavailable.map((a) => a.email + ' · ' + statusLabel[a.status]).join('\n')}
            aria-label={statusText}
            onClick={() => onSettings('accounts')}
          >
            <WifiOff size={15} strokeWidth={1.65} />
            {!collapsed && <span>{statusText}</span>}
          </button>
        )}
        <div className="sidebar-footer">
          {collapsed && (
            <IconButton label="Expand sidebar" shortcut="[" onClick={onToggleCollapsed}>
              <PanelLeftOpen size={15} />
            </IconButton>
          )}
          <button
            className="nav-item"
            title="Settings · Ctrl ,"
            aria-label="Settings"
            onClick={() => onSettings('general')}
          >
            <SettingsIcon size={16} strokeWidth={1.65} />
            {!collapsed && (
              <>
                <span>Settings</span>
                <kbd>Ctrl ,</kbd>
              </>
            )}
          </button>
          {!collapsed && (
            <IconButton label="Collapse sidebar" shortcut="[" onClick={onToggleCollapsed}>
              <PanelLeftClose size={15} />
            </IconButton>
          )}
        </div>
      </div>
    </aside>
  )
}
