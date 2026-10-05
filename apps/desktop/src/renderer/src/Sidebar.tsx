import { cn } from '@inlark/ui'
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
import { Wordmark } from '@inlark/ui/components/wordmark'
import type { Account, Mailbox, View } from '@inlark/core'
import appIcon from '../../../resources/icon-mark.svg?no-inline'
import { AccountMark } from './AccountMark'
import { ShortcutHint, useShortcutText, type ShortcutId } from './shortcuts'

export const views: { id: View; title: string; icon: typeof Inbox; shortcut?: ShortcutId }[] = [
  { id: 'inbox', title: 'Inbox', icon: Inbox, shortcut: 'goInbox' },
  { id: 'starred', title: 'Starred', icon: Star, shortcut: 'goStarred' },
  { id: 'sent', title: 'Sent', icon: Send, shortcut: 'goSent' },
  { id: 'drafts', title: 'Drafts', icon: FileText, shortcut: 'goDrafts' },
  { id: 'archive', title: 'Archive', icon: Archive, shortcut: 'goArchive' },
  { id: 'junk', title: 'Spam', icon: ShieldX, shortcut: 'goSpam' },
  { id: 'trash', title: 'Trash', icon: Trash2, shortcut: 'goTrash' },
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
  const keys = useShortcutText()
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
    <aside
      className={cn(
        'sidebar relative w-56 shrink-0 flex flex-col py-0 px-3 overflow-hidden [.sidebar-collapsed_&]:w-16',
        '[.sidebar-collapsed_&]:py-0 [.sidebar-collapsed_&]:px-2.25 max-[1100px]:w-51 max-[700px]:w-47 max-[700px]:py-0',
        'max-[700px]:px-2.5',
      )}
    >
      <div
        className={cn(
          'sidebar-brand h-14 flex items-center gap-1.5 py-0 px-2 shrink-0 [.sidebar-collapsed_&]:justify-center',
          '[.sidebar-collapsed_&]:p-1.25 max-[1100px]:gap-1.5 max-[1100px]:py-0 max-[1100px]:px-1.25 max-[700px]:gap-1.5',
          'max-[700px]:py-0 max-[700px]:px-[3px]',
        )}
      >
        <img
          className="brand-mark h-6 w-6 block shrink-0 light:brightness-0 max-[700px]:w-6 max-[700px]:h-6"
          src={appIcon}
          alt={collapsed ? 'Inlark' : ''}
          width={24}
          height={24}
        />
        {!collapsed && (
          <Wordmark className="brand-wordmark text-white h-4 w-auto light:[color:#000] max-[1100px]:h-3.75 max-[700px]:h-3.5" />
        )}
      </div>
      <div
        className={cn(
          'sidebar-tools absolute top-3.5 right-3 flex items-center gap-1 shrink-0 [&_.button]:w-6.75 [&_.button]:h-6.75',
          '[&_.button]:min-h-6.75 [&_.button]:p-0 [&_.button]:text-muted [&_.sidebar-compose]:rounded-[7px]',
          '[&_.sidebar-compose]:bg-raised [&_.sidebar-compose]:text-strong [.sidebar-collapsed_&]:static',
          '[.sidebar-collapsed_&]:flex-col [.sidebar-collapsed_&]:gap-1.5 [.sidebar-collapsed_&]:pt-0',
          '[.sidebar-collapsed_&]:pb-3.75 [.sidebar-collapsed_&]:px-0 max-[700px]:right-1.75 max-[700px]:gap-[2px]',
          'max-[700px]:[&_.button]:w-6 max-[700px]:[&_.button]:h-6 max-[700px]:[&_.button]:min-h-6',
          '[@media(max-height:700px)]:[.sidebar-collapsed_&]:pb-3',
        )}
      >
        <IconButton label="Search and commands" shortcut={keys('commandMenu')} onClick={onSearch}>
          <Search size={14} />
        </IconButton>
        <IconButton
          className="sidebar-compose"
          label="Compose"
          shortcut={keys('compose')}
          onClick={onCompose}
        >
          <SquarePen size={16} />
        </IconButton>
      </div>
      <div className="sidebar-scroll flex-1 min-h-0 overflow-y-hidden [scrollbar-gutter:stable] -mr-2.25 pt-0 pb-4 pr-[3px] pl-0 hover:overflow-y-auto focus-within:overflow-y-auto">
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
                  (v.shortcut && keys(v.shortcut) ? ' · ' + keys(v.shortcut) : '')
                }
                aria-current={
                  view === v.id && !route.account && !route.folder && !route.q ? 'page' : undefined
                }
                className={cn(
                  'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
                  'text-secondary text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
                  'focus-visible:outline-offset-[-2px] [&>svg]:text-muted [&>span:not(.account-mark)]:flex-1',
                  '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
                  '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
                  '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
                  'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
                  '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
                  '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
                  '[.sidebar-collapsed_&]:p-1.75',
                  v.id === 'archive' && 'nav-secondary-start mt-3.25',
                  view === v.id && !route.account && !route.folder && !route.q && 'active',
                )}
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
          <div
            className={cn(
              'sidebar-section-label mt-5.75 mb-1.25 mr-[3px] ml-2.5 flex justify-between items-center text-muted text-[11px]',
              'font-medium h-6 [.sidebar-collapsed_&]:h-0 [.sidebar-collapsed_&]:mt-3.25 [.sidebar-collapsed_&]:mb-0',
              '[.sidebar-collapsed_&]:mx-0',
            )}
          >
            {!collapsed && (
              <button
                className={cn(
                  'sidebar-section-toggle inline-flex items-center gap-1.5 min-w-0 p-0 border-0 bg-none bg-transparent',
                  'text-inherit [font:inherit] cursor-pointer hover:text-foreground [&_svg]:shrink-0',
                  '[&_svg]:transition-[transform] [&_svg]:duration-120 [&_svg]:ease-[ease]',
                  '[&_svg.closed]:transform-[rotate(-90deg)]',
                )}
                aria-expanded={accountsExpanded}
                onClick={() => setAccountsExpanded((open) => !open)}
              >
                <span>Accounts</span>
                <ChevronDown size={12} className={cn(accountsExpanded ? '' : 'closed')} />
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
                    className={cn(
                      'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
                      'text-secondary text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
                      'focus-visible:outline-offset-[-2px] [&>svg]:text-muted [&>span:not(.account-mark)]:flex-1',
                      '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
                      '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
                      '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
                      'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
                      '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
                      '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
                      '[.sidebar-collapsed_&]:p-1.75 account-toggle [&.account-current]:text-foreground [&_.account-chevron]:ml-auto',
                      '[&_.account-chevron]:text-faint',
                      route.account === a.id && 'account-current',
                    )}
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
                      className={cn(a.status !== 'connected' ? 'disconnected' : undefined)}
                    />
                    {!collapsed && (
                      <>
                        <span>{a.name}</span>
                        {a.status === 'connecting' ? (
                          <Spinner size={11} />
                        ) : a.status !== 'connected' ? (
                          <WifiOff
                            size={12}
                            className="account-offline text-faint"
                            aria-label="Not connected"
                          />
                        ) : accountUnread[a.id] ? (
                          <small>{accountUnread[a.id].toLocaleString()}</small>
                        ) : null}
                        <ChevronDown
                          size={12}
                          className={cn(
                            'account-chevron shrink-0 transition-[transform] duration-120 ease-[ease] [&.closed]:transform-[rotate(-90deg)]',
                            expanded ? '' : 'closed',
                          )}
                        />
                      </>
                    )}
                  </button>
                  {!collapsed && expanded && (
                    <div
                      className="account-children [&_.nav-item]:h-7.5 [&_.nav-item]:text-[12px] [&_.nav-item>svg]:shrink-0 mt-[1px] mb-2 mr-0 ml-4.5 pl-1.25 border-l border-solid border-l-border"
                      id={'account-folders-' + a.id}
                      role="group"
                      aria-label={a.name + ' folders'}
                    >
                      {views
                        .filter((v) => v.id !== 'drafts')
                        .map((v) => (
                          <button
                            key={v.id}
                            className={cn(
                              'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
                              'text-secondary text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
                              'focus-visible:outline-offset-[-2px] [&>svg]:text-muted [&>span:not(.account-mark)]:flex-1',
                              '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
                              '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
                              '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
                              'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
                              '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
                              '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
                              '[.sidebar-collapsed_&]:p-1.75',
                              route.account === a.id &&
                                !route.folder &&
                                !route.q &&
                                view === v.id &&
                                'active',
                            )}
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
                          <div
                            className="folder-nav-row [&_.nav-item]:flex-1 [&_.nav-item]:min-w-0 [&>.button]:opacity-0 [&:hover>.button]:opacity-100 [&:focus-within>.button]:opacity-100 flex items-center"
                            key={b.id}
                          >
                            <button
                              className={cn(
                                'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
                                'text-secondary text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
                                'focus-visible:outline-offset-[-2px] [&>svg]:text-muted [&>span:not(.account-mark)]:flex-1',
                                '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
                                '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
                                '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
                                'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
                                '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
                                '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
                                '[.sidebar-collapsed_&]:p-1.75',
                                route.folder === b.id && route.account === a.id && 'active',
                              )}
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
                        className={cn(
                          'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
                          'text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
                          'focus-visible:outline-offset-[-2px] [&>svg]:text-muted [&>span:not(.account-mark)]:flex-1',
                          '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
                          '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
                          '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
                          'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
                          '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
                          '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
                          '[.sidebar-collapsed_&]:p-1.75 account-create-folder text-muted',
                        )}
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
      <div
        className={cn(
          "sidebar-bottom relative mt-auto pt-4 shrink-0 before:content-[''] before:absolute before:bottom-full",
          'before:left-0 before:right-0 before:h-7 before:bg-[linear-gradient(transparent,_var(--sidebar))]',
          'before:pointer-events-none [@media(max-height:700px)]:pt-2',
        )}
      >
        {sendingIssues > 0 && (
          <button
            className={cn(
              'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
              'text-secondary text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
              'focus-visible:outline-offset-[-2px] [&>span:not(.account-mark)]:flex-1',
              '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
              '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
              '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
              'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
              '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
              '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
              '[.sidebar-collapsed_&]:p-1.75 sidebar-sending [&>svg]:text-primary [&>span]:text-primary [&_small]:ml-auto',
              view === 'drafts' && 'active',
            )}
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
            className={cn(
              'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
              'text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
              'focus-visible:outline-offset-[-2px] [&>span:not(.account-mark)]:flex-1',
              '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
              '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
              '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] [&.active]:bg-selected',
              '[&.active]:text-strong [&.active]:font-medium [&.active_svg]:text-strong [&_small]:text-[11px]',
              '[&_small]:text-muted [&_small]:tabular-nums [&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px]',
              '[.sidebar-collapsed_&]:justify-center [.sidebar-collapsed_&]:p-1.75 sidebar-status text-danger',
              '[&>svg]:text-danger hover:text-danger hover:bg-danger/10',
            )}
            title={unavailable.map((a) => a.email + ' · ' + statusLabel[a.status]).join('\n')}
            aria-label={statusText}
            onClick={() => onSettings('accounts')}
          >
            <WifiOff size={15} strokeWidth={1.65} />
            {!collapsed && <span>{statusText}</span>}
          </button>
        )}
        <div
          className={cn(
            'sidebar-footer flex items-center gap-1 border-t border-solid border-t-border pt-2 pb-2.5 px-0',
            '[&>.nav-item]:flex-1 [&>.nav-item]:min-w-0 [&>.nav-item_kbd]:opacity-0 [&>.nav-item_kbd]:transition-[opacity]',
            '[&>.nav-item_kbd]:duration-120 [&>.nav-item_kbd]:ease-[ease] [&>.nav-item:hover_kbd]:opacity-100',
            '[&>.nav-item:focus-visible_kbd]:opacity-100 [&>.button]:text-muted [.sidebar-collapsed_&]:flex-col',
            '[.sidebar-collapsed_&]:items-stretch [.sidebar-collapsed_&>.button]:self-center [@media(max-height:700px)]:pt-1',
            '[@media(max-height:700px)]:pb-1.5 [@media(max-height:700px)]:px-0',
          )}
        >
          {collapsed && (
            <IconButton
              label="Expand sidebar"
              shortcut={keys('toggleSidebar')}
              onClick={onToggleCollapsed}
            >
              <PanelLeftOpen size={15} />
            </IconButton>
          )}
          <button
            className={cn(
              'nav-item flex gap-2.5 items-center w-full h-8.5 py-0 px-2.5 border-0 bg-none bg-transparent rounded-md',
              'text-secondary text-[13px] text-left my-[2px] mx-0 transition-[color,background] duration-120 ease-[ease]',
              'focus-visible:outline-offset-[-2px] [&>svg]:text-muted [&>span:not(.account-mark)]:flex-1',
              '[&>span:not(.account-mark)]:overflow-hidden [&>span:not(.account-mark)]:text-ellipsis',
              '[&>span:not(.account-mark)]:whitespace-nowrap [&>span:not(.account-mark)]:relative',
              '[&>span:not(.account-mark)]:top-[1px] [&>small]:relative [&>small]:top-[1px] hover:bg-hover',
              'hover:text-foreground [&.active]:bg-selected [&.active]:text-strong [&.active]:font-medium',
              '[&.active_svg]:text-strong [&_small]:text-[11px] [&_small]:text-muted [&_small]:tabular-nums',
              '[&>.account-mark]:my-0 [&>.account-mark]:mx-[-1px] [.sidebar-collapsed_&]:justify-center',
              '[.sidebar-collapsed_&]:p-1.75',
            )}
            title={'Settings' + (keys('settings') ? ' · ' + keys('settings') : '')}
            aria-label="Settings"
            onClick={() => onSettings('general')}
          >
            <SettingsIcon size={16} strokeWidth={1.65} />
            {!collapsed && (
              <>
                <span>Settings</span>
                <ShortcutHint id="settings" />
              </>
            )}
          </button>
          {!collapsed && (
            <IconButton
              label="Collapse sidebar"
              shortcut={keys('toggleSidebar')}
              onClick={onToggleCollapsed}
            >
              <PanelLeftClose size={15} />
            </IconButton>
          )}
        </div>
      </div>
    </aside>
  )
}
