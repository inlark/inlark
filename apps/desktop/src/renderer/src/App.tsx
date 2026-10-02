import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useHotkey, useHotkeySequence } from '@tanstack/react-hotkeys'
import {
  Inbox,
  Search,
  PenLine,
  Archive,
  FileText,
  Trash2,
  Mail,
  Plus,
  Settings as SettingsIcon,
  ChevronRight,
  ChevronDown,
  Keyboard,
  SlidersHorizontal,
  MoreHorizontal,
  Check,
  X,
  RefreshCw,
  WifiOff,
  Rows3,
  AlertCircle,
  Star,
  MailOpen,
  MailMinus,
  FolderInput,
  ShieldX,
  Reply,
  ReplyAll,
  Forward,
  Undo2,
  Folder,
  FolderPlus,
  Moon,
  Sun,
  Monitor,
  PanelLeftOpen,
  PanelLeftClose,
  UserRound,
  Info,
} from '@inlark/ui/icons'
import { Button, Checkbox, Dropdown, MenuItem, IconButton, EmptyState, Spinner } from '@inlark/ui'
import {
  defaultSettings,
  scopeKey,
  unlinkedServerDrafts,
  friendlyError,
  identityKey,
  mailtoDraft,
  replyRecipients,
  type Address,
  type Bootstrap,
  type Conversation,
  type Draft,
  type MailAction,
  type Mailbox,
  type MailQuery,
  type Message,
  type MutationTarget,
  type QueryPage,
  type SubmissionSummary,
  type UpdateStatus,
  type View,
} from '@inlark/core'
import { api, isDemo } from './api'
import {
  queryClient,
  localDrafts,
  localSaveDraft,
  localDeleteDraft,
  suspendPersistence,
  resumePersistence,
} from './cache'
import { Reader, type UnsubscribeState } from './Reader'
import { MoveDialog } from './MoveDialog'
import { CommandPalette, type Command } from './CommandPalette'
import { Sidebar, views } from './Sidebar'
import { ConversationList, type ConversationListHandle } from './ConversationList'
import { DraftRows, DraftSelectionBar, deletable, type DraftItem } from './DraftList'
import { longDate } from './mail-date'
import {
  ShortcutDialog,
  FilterDialog,
  FolderDialog,
  ConfirmActionDialog,
  type FolderDialogState,
} from './AppDialogs'
import { messageText } from './message-text'
import { selectConversation } from './selection'
import { useCharacterKey } from './character-key'
import { emptyListState } from './empty-states'
import { AccountMark } from './AccountMark'
import { HintIconButton } from './HintIconButton'
import { targetAccounts, targetLimit } from './account-limits'
import { SubmissionList } from './SendingStatus'
import { IndexingMeter } from './IndexingMeter'
import { UpdateNotice } from './UpdateNotice'
const Composer = lazy(() => import('./Composer').then((m) => ({ default: m.Composer })))
const SettingsPanel = lazy(() => import('./Settings').then((m) => ({ default: m.SettingsPanel })))

type Toast = {
  text: string
  undoId?: string
  /** Undoes a change the client has not committed yet. */
  onUndo?: () => void
  tone?: 'error' | 'info'
}
let toastSequence = 0
const discardKeys = (item: DraftItem) =>
  item.kind === 'local' && item.draft.serverId
    ? [item.key, 'server:' + scopeKey(item.draft.accountId, item.draft.serverId)]
    : [item.key]
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export function App() {
  const route = useSearch({ from: '/' }),
    navigate = useNavigate()
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: () => api.bootstrap() })
  const bootstrap: Bootstrap = boot.data || {
    accounts: [],
    settings: defaultSettings,
    secureStorage: false,
    demo: isDemo,
    version: '0.1.0',
  }
  const { accounts, settings } = bootstrap
  const view = (
    views.some((v) => v.id === route.view) || route.view === 'all' ? route.view : 'inbox'
  ) as View
  const [collapsed, setCollapsed] = useState(localStorage.getItem('sidebar-collapsed') === 'true')
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() =>
    localStorage.getItem('mail-density') === 'comfortable' ? 'comfortable' : 'compact',
  )
  const [settingsOpen, setSettingsOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState('general')
  const [composer, setComposer] = useState<Draft>(),
    [paletteOpen, setPaletteOpen] = useState(false),
    [help, setHelp] = useState(false)
  const [searchOpen, setSearchOpen] = useState(!!route.q),
    [search, setSearch] = useState(route.q || '')
  const [filters, setFilters] = useState<Partial<MailQuery>>({}),
    [filterOpen, setFilterOpen] = useState(false)
  const [selected, setSelected] = useState(new Set<string>()),
    [focused, setFocused] = useState(''),
    [allMatching, setAllMatching] = useState(false)
  const [toast, setToastState] = useState<Toast & { id: number }>(),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ phase: 'idle' })
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>()
  const [moveTargets, setMoveTargets] = useState<MutationTarget[]>(),
    [confirmAction, setConfirmAction] = useState<MailAction>()
  const listRef = useRef<HTMLDivElement>(null),
    listHandle = useRef<ConversationListHandle>(null),
    offsets = useRef(new Map<string, number>()),
    lastRead = useRef(''),
    searchInput = useRef<HTMLInputElement>(null)
  const selectionAnchor = useRef<string | undefined>(undefined)
  const [draftSelected, setDraftSelected] = useState(new Set<string>()),
    draftAnchor = useRef<string | undefined>(undefined)
  const [unsubscribes, setUnsubscribes] = useState(new Map<string, 'pending' | 'done'>())
  // Keep successful deletions hidden for this session; delayed server results can still be stale.
  const [discarding, setDiscarding] = useState(new Set<string>()),
    pendingDiscard = useRef<{ toastId: number; items: DraftItem[] } | undefined>(undefined)
  const pendingMailto = useRef<string | undefined>(undefined)
  const setToast = (next?: Toast) => {
    const id = ++toastSequence
    setToastState(next && { ...next, id })
    return id
  }
  const notify = (text: string, tone?: Toast['tone']) => setToast({ text, tone })
  const fail = (error: unknown) => notify(friendlyError(error), 'error')
  const explain = ({ account, reason }: { account: { name: string }; reason: string }) =>
    notify((accounts.length > 1 ? account.name + ' · ' : '') + reason, 'info')
  const account = accounts.find((a) => a.id === route.account),
    folderAccountId = account?.id || accounts[0]?.id || ''
  const boxes = useQuery({
    queryKey: ['mailboxes', folderAccountId],
    queryFn: () => api.mailboxes(folderAccountId),
    enabled: !!folderAccountId,
  })
  const mailboxCounts = useQueries({
    queries: accounts.map((a) => ({
      queryKey: ['mailboxes', a.id],
      queryFn: () => api.mailboxes(a.id),
      enabled: a.status === 'connected',
    })),
    combine: (results) =>
      results.reduce(
        (counts, result, index) => {
          const account = accounts[index]
          if (account) counts.boxesByAccount[account.id] = result.data || []
          if (account?.status !== 'connected') return counts
          for (const box of result.data || []) {
            if (box.role === 'inbox') {
              counts.unread += box.unreadEmails
              counts.byAccount[box.accountId] = box.unreadEmails
            }
            if (box.role === 'drafts') counts.drafts += box.totalEmails
          }
          return counts
        },
        {
          unread: 0,
          drafts: 0,
          byAccount: {} as Record<string, number>,
          boxesByAccount: {} as Record<string, Mailbox[]>,
        },
      ),
  })
  const currentFolder = boxes.data?.find((b) => b.id === route.folder)
  const query: MailQuery = useMemo(
    () => ({
      view: route.q ? 'all' : view,
      // A remembered location can name an account that was removed since; show all mail instead.
      accountId: accounts.some((a) => a.id === route.account) ? route.account : undefined,
      mailboxId: route.folder,
      text: route.q || undefined,
      ...filters,
    }),
    [view, route.account, route.folder, route.q, filters, accounts],
  )
  const queryId = JSON.stringify(query)
  useEffect(() => {
    setSelected(new Set())
    setAllMatching(false)
    setFocused('')
    selectionAnchor.current = undefined
  }, [queryId])
  const mail = useInfiniteQuery({
    queryKey: ['mail', query],
    queryFn: ({ pageParam }) => api.query(query, pageParam),
    initialPageParam: undefined as Record<string, number> | undefined,
    getNextPageParam: (last) => last.next,
    enabled: accounts.length > 0,
  })
  const conversations = useMemo(
    () => [
      ...new Map((mail.data?.pages.flatMap((p) => p.items) || []).map((c) => [c.key, c])).values(),
    ],
    [mail.data],
  )
  const total = mail.data?.pages[0]?.total || 0
  // Accounts still indexing may be missing older mail, so their results are never the whole story.
  const incomplete = useMemo(
    () =>
      [...new Set(mail.data?.pages.flatMap((p) => p.incompleteAccounts || []) || [])]
        .map((id) => accounts.find((a) => a.id === id))
        .filter((a): a is (typeof accounts)[number] => !!a),
    [mail.data, accounts],
  )
  const drafts = useQuery({
    queryKey: ['drafts'],
    queryFn: async () => {
      const values = await Promise.all([api.drafts(), localDrafts()])
      const merged = new Map<string, Draft>()
      for (const draft of values.flat()) {
        const old = merged.get(draft.id)
        if (
          !old ||
          (old.status !== 'sent' && old.status !== 'uncertain' && old.updatedAt < draft.updatedAt)
        )
          merged.set(draft.id, draft)
      }
      return [...merged.values()]
        .filter((d) => accounts.some((a) => a.id === d.accountId) && d.status !== 'sent')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    enabled: !!accounts.length,
  })
  const allDraftItems = useMemo<DraftItem[]>(
    () => [
      ...unlinkedServerDrafts(conversations, drafts.data || []).map((message) => ({
        kind: 'server' as const,
        key: 'server:' + scopeKey(message.accountId, message.id),
        message,
      })),
      ...(drafts.data || [])
        .filter((draft) => !route.account || draft.accountId === route.account)
        .map((draft) => ({ kind: 'local' as const, key: 'local:' + draft.id, draft })),
    ],
    [conversations, drafts.data, route.account],
  )
  const draftItems = allDraftItems.filter((item) => !discarding.has(item.key))
  const submissions = useQuery({
    queryKey: ['submissions'],
    queryFn: () => api.submissions(),
    enabled: !!accounts.length,
  })
  const pendingSends = (submissions.data || []).filter((s) =>
    accounts.some((a) => a.id === s.accountId),
  )
  const readerAccount = accounts.find((a) => a.id === route.threadAccount)
  const listed = conversations.find(
    (c) => c.id === route.thread && c.accountId === route.threadAccount,
  )
  const thread = useQuery({
    queryKey: ['thread', route.threadAccount, route.thread],
    queryFn: () => api.conversation(route.threadAccount!, route.thread!),
    enabled: !!route.thread && !!readerAccount,
    // Open instantly from the list summary; bodies arrive a moment later.
    placeholderData: listed
      ? [...listed.messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      : undefined,
  })
  useEffect(() => {
    localStorage.setItem('mail-density', density)
  }, [density])
  const blocked =
    !!composer ||
    settingsOpen ||
    paletteOpen ||
    help ||
    filterOpen ||
    !!folderDialog ||
    !!moveTargets ||
    !!confirmAction
  const go = (next: Partial<typeof route>, reset = true) => {
    if (reset) {
      setSelected(new Set())
      setDraftSelected(new Set())
      setAllMatching(false)
      setFilters({})
    }
    void navigate({ to: '/', search: reset ? next : { ...route, ...next } })
  }
  const back = () => {
    go({ thread: undefined, threadAccount: undefined }, false)
    lastRead.current = ''
  }
  const open = (c: Conversation) => {
    if (listRef.current) offsets.current.set(queryId, listRef.current.scrollTop)
    setFocused(c.key)
    go({ thread: c.id, threadAccount: c.accountId }, false)
  }
  const targets = (): MutationTarget[] =>
    route.thread
      ? [{ accountId: route.threadAccount!, threadId: route.thread }]
      : conversations
          .filter((c) => selected.has(c.key) || (!selected.size && c.key === focused))
          .map((c) => ({ accountId: c.accountId, threadId: c.id }))
  const refresh = async () => {
    await Promise.all(
      ['mail', 'thread', 'mailboxes', 'drafts', 'submissions'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
  const act = async (
    action: MailAction,
    explicit?: MutationTarget[],
    mailboxId?: string,
    confirmed = false,
  ) => {
    if (busy) return
    // A server that can't do this safely explains why instead of failing halfway.
    const limit = targetLimit(
      accounts,
      allMatching && !explicit
        ? route.account
          ? [route.account]
          : accounts.map((a) => a.id)
        : targetAccounts(explicit || targets()),
      action,
    )
    if (limit) {
      explain(limit)
      return
    }
    if (!confirmed && ((allMatching && !explicit) || action === 'destroy')) {
      setConfirmAction(action)
      return
    }
    const chosen = explicit || targets()
    if (!chosen.length && !allMatching) return
    const leaves = ['archive', 'trash', 'spam', 'move', 'destroy'].includes(action)
    // Triage flows straight into the next conversation instead of bouncing to the list.
    const current = conversations.findIndex(
      (c) => c.id === route.thread && c.accountId === route.threadAccount,
    )
    const preference = settings.afterArchive || 'next'
    const neighbor =
      route.thread && leaves && current >= 0 && preference !== 'list'
        ? preference === 'next'
          ? (conversations[current + 1] ?? conversations[current - 1])
          : (conversations[current - 1] ?? conversations[current + 1])
        : undefined
    setBusy(true)
    suspendPersistence()
    const saved = queryClient.getQueriesData({ queryKey: ['mail'] })
    await queryClient.cancelQueries({ queryKey: ['mail'] })
    if (!allMatching)
      queryClient.setQueriesData<{ pages: QueryPage[] }>(
        { queryKey: ['mail'] },
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((p) => ({
              ...p,
              items: p.items.flatMap((c) => {
                if (!chosen.some((t) => t.accountId === c.accountId && t.threadId === c.id))
                  return [c]
                if (leaves) return []
                return [
                  {
                    ...c,
                    ...(action === 'read' || action === 'unread'
                      ? { unread: action === 'unread' }
                      : {}),
                    ...(action === 'star' || action === 'unstar'
                      ? { starred: action === 'star' }
                      : {}),
                  },
                ]
              }),
            })),
          },
      )
    if (route.thread && (leaves || action === 'unread')) {
      if (neighbor) open(neighbor)
      else back()
    }
    try {
      const result =
        allMatching && !explicit
          ? await api.mutateAll(query, action)
          : await api.mutate({ targets: chosen, action, mailboxId })
      const count = allMatching && !explicit ? result.changed : chosen.length
      setToast({
        tone: result.failures.length ? 'error' : undefined,
        text: result.failures.length
          ? result.changed + ' updated · ' + result.failures[0]
          : (count > 1 ? count.toLocaleString() + ' conversations · ' : '') +
            {
              archive: 'Archived',
              trash: 'Moved to trash',
              spam: 'Marked as spam',
              read: 'Marked as read',
              unread: 'Marked as unread',
              star: 'Starred',
              unstar: 'Star removed',
              move: 'Moved',
              restore: 'Restored to inbox',
              notSpam: 'Moved to inbox',
              destroy: 'Permanently deleted',
            }[action],
        undoId: result.undoId,
      })
      setSelected(new Set())
      setAllMatching(false)
    } catch (e) {
      saved.forEach(([key, value]) => queryClient.setQueryData(key, value))
      fail(e)
    } finally {
      resumePersistence()
      setBusy(false)
      setProgress('')
      await refresh()
    }
  }
  const openMove = (chosen: MutationTarget[]) => {
    const limit = targetLimit(accounts, targetAccounts(chosen), 'move')
    if (limit) explain(limit)
    else if (chosen.length) setMoveTargets(chosen)
  }
  /** Why the current conversation or selection can't take this action, if it can't. */
  const unavailable = (action: MailAction) =>
    targetLimit(
      accounts,
      allMatching
        ? route.account
          ? [route.account]
          : accounts.map((a) => a.id)
        : targetAccounts(targets()),
      action,
    )?.reason
  const compose = async (
    message?: Message,
    kind: 'reply' | 'replyAll' | 'forward' = 'reply',
    partial: Partial<Draft> = {},
  ) => {
    const id = message?.accountId || route.account || settings.defaultAccountId || accounts[0]?.id
    if (!id) {
      setSettingsTab('accounts')
      setSettingsOpen(true)
      return
    }
    try {
      const identities = await queryClient.fetchQuery({
        queryKey: ['identities', id],
        queryFn: () => api.identities(id),
      })
      if (!identities.length) {
        notify('This account has no permitted sending identities.')
        return
      }
      const recipients = message
        ? replyRecipients(message, identities, kind === 'replyAll')
        : undefined
      const identity = recipients?.identity || identities[0]
      const signature =
        settings.signatures[identityKey(id, identity.id)] ?? identity.textSignature ?? ''
      const who = (list: Address[]) =>
        list.map((a) => (a.name ? a.name + ' <' + a.email + '>' : a.email)).join(', ')
      const header = !message
        ? []
        : kind === 'forward'
          ? [
              '---------- Forwarded message ----------',
              'From: ' + who(message.from),
              'Date: ' + longDate(message.receivedAt),
              'Subject: ' + (message.subject || '(No subject)'),
              'To: ' + who(message.to),
              ...(message.cc.length ? ['Cc: ' + who(message.cc)] : []),
            ]
          : ['On ' + longDate(message.receivedAt) + ', ' + who(message.from) + ' wrote:']
      const body = message ? messageText(message) : ''
      const quote = message
        ? kind === 'forward'
          ? '<p>' +
            header.map(escapeHtml).join('<br/>') +
            '</p><p>' +
            escapeHtml(body).replace(/\n/g, '<br/>') +
            '</p>'
          : '<p>' +
            escapeHtml(header[0]) +
            '</p><blockquote><p>' +
            escapeHtml(body).replace(/\n/g, '<br/>') +
            '</p></blockquote>'
        : ''
      const html =
        '<p>' +
        escapeHtml(partial.text || '').replace(/\n/g, '<br/>') +
        '</p>' +
        (signature ? '<p><br/>' + escapeHtml(signature).replace(/\n/g, '<br/>') + '</p>' : '') +
        quote
      const text = [
        partial.text || '',
        signature,
        message
          ? header.join('\n') + '\n' + (kind === 'forward' ? body : body.replace(/^/gm, '> '))
          : '',
      ]
        .filter(Boolean)
        .join('\n\n')
      const draft: Draft = {
        id: crypto.randomUUID(),
        accountId: id,
        identityId: identity.id,
        to: kind === 'forward' ? [] : recipients?.to || [],
        cc: recipients?.cc || [],
        bcc: [],
        subject: message
          ? (kind === 'forward' ? 'Fwd: ' : /^re:/i.test(message.subject) ? '' : 'Re: ') +
            message.subject
          : '',
        attachments: [],
        updatedAt: new Date().toISOString(),
        status: 'local',
        ...(message && kind !== 'forward'
          ? {
              inReplyTo: message.messageId,
              references: [...(message.references || []), ...(message.messageId || [])],
              replyThreadId: message.threadId,
            }
          : {}),
        ...partial,
        html,
        text,
      }
      if (kind === 'forward' && message?.attachments?.length)
        draft.attachments = (await api.stageRemoteAttachments(id, message.attachments)).map(
          (a) => ({ ...a, cid: undefined }),
        )
      await localSaveDraft(draft)
      setComposer(draft)
    } catch (e) {
      fail(e)
    }
  }
  const onMailto = (url: string) => {
    try {
      if (!accounts.length) {
        pendingMailto.current = url
        setSettingsTab('accounts')
        setSettingsOpen(true)
        return
      }
      void compose(undefined, 'reply', mailtoDraft(url))
    } catch (e) {
      fail(e)
    }
  }
  const step = (delta: number) => {
    if (
      route.thread &&
      delta > 0 &&
      conversations.at(-1)?.id === route.thread &&
      conversations.at(-1)?.accountId === route.threadAccount &&
      mail.hasNextPage
    ) {
      void mail
        .fetchNextPage()
        .then((result) => {
          const next = result.data?.pages
            .flatMap((p) => p.items)
            .find((c) => !conversations.some((old) => old.key === c.key))
          if (next) open(next)
        })
        .catch((e) => fail(e))
      return
    }
    const current = conversations.findIndex((c) =>
      route.thread
        ? c.id === route.thread && c.accountId === route.threadAccount
        : c.key === focused,
    )
    const next = conversations[Math.max(0, Math.min(conversations.length - 1, current + delta))]
    if (next) {
      if (route.thread) open(next)
      else {
        setFocused(next.key)
        listHandle.current?.scrollToConversation(next.key)
      }
    }
  }
  const toggle = (key: string, range = false) => {
    setAllMatching(false)
    setSelected((previous) =>
      selectConversation(
        conversations.map((c) => c.key),
        allMatching ? new Set(conversations.map((c) => c.key)) : previous,
        key,
        range ? selectionAnchor.current : undefined,
      ),
    )
    if (!range || !selectionAnchor.current) selectionAnchor.current = key
  }
  const toggleDraft = (key: string, range = false) => {
    setDraftSelected((previous) =>
      selectConversation(
        draftItems.filter(deletable).map((item) => item.key),
        previous,
        key,
        range ? draftAnchor.current : undefined,
      ),
    )
    if (!range || !draftAnchor.current) draftAnchor.current = key
  }
  const openDraft = async (item: DraftItem) => {
    if (item.kind === 'local') return setComposer(item.draft)
    try {
      const draft = await api.resumeDraft(item.message.accountId, item.message.id)
      await localSaveDraft(draft)
      setComposer(draft)
    } catch (e) {
      fail(e)
    }
  }
  const commitDiscard = async (items: DraftItem[]) => {
    const failures: string[] = []
    const failedKeys: string[] = []
    for (const item of items) {
      try {
        if (item.kind === 'server')
          await api.deleteServerDraft(item.message.accountId, item.message.id)
        else {
          await api.deleteDraft(item.draft.id)
          await localDeleteDraft(item.draft.id)
        }
      } catch (e) {
        failures.push(friendlyError(e))
        failedKeys.push(...discardKeys(item))
      }
    }
    await refresh()
    setDiscarding((current) => {
      const next = new Set(current)
      for (const key of failedKeys) next.delete(key)
      return next
    })
    if (failures.length)
      notify(
        (failures.length > 1 ? failures.length + ' drafts' : 'A draft') +
          ' could not be deleted · ' +
          failures[0],
        'error',
      )
  }
  const discardDrafts = (keys: Iterable<string>) => {
    const chosen = new Set(keys)
    const items = draftItems.filter((item) => chosen.has(item.key) && deletable(item))
    if (!items.length) return
    // Only one deletion waits for undo at a time; an earlier one is committed right away.
    if (pendingDiscard.current) void commitDiscard(pendingDiscard.current.items)
    setDiscarding((current) => new Set([...current, ...items.flatMap(discardKeys)]))
    setDraftSelected(new Set())
    const toastId = setToast({
      text: items.length > 1 ? items.length + ' drafts deleted' : 'Draft deleted',
      onUndo: () => {
        if (pendingDiscard.current?.items !== items) return
        pendingDiscard.current = undefined
        setDiscarding((current) => {
          const next = new Set(current)
          for (const item of items) for (const key of discardKeys(item)) next.delete(key)
          return next
        })
        notify(items.length > 1 ? 'Drafts restored' : 'Draft restored')
      },
    })
    pendingDiscard.current = { toastId, items }
  }
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)')
    const apply = () =>
      (document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed))
  }, [collapsed])
  useEffect(() => {
    setSearch(route.q || '')
  }, [route.q])
  useEffect(() => {
    const unread = mailboxCounts.unread
    document.title =
      (route.thread && thread.data?.at(-1)?.subject
        ? thread.data.at(-1)!.subject + ' · '
        : route.q
          ? 'Search · '
          : '') +
      (unread ? 'Inbox (' + unread.toLocaleString() + ') · ' : '') +
      'Inlark'
  }, [route.thread, route.q, thread.data, mailboxCounts.unread])
  useEffect(() => {
    // Reopen where you left off: the same view, account and folder (not a stale conversation).
    try {
      localStorage.setItem(
        'last-location',
        JSON.stringify({ view: route.view, account: route.account, folder: route.folder }),
      )
    } catch {
      /* Remembering the location is a convenience only. */
    }
  }, [route.view, route.account, route.folder])
  useEffect(() => {
    const key = route.threadAccount + ':' + route.thread
    if (
      route.thread &&
      thread.data &&
      readerAccount?.status === 'connected' &&
      lastRead.current !== key
    ) {
      lastRead.current = key
      if (thread.data.some((m) => !m.keywords.$seen))
        void api
          .mutate({
            targets: [{ accountId: readerAccount.id, threadId: route.thread }],
            action: 'read',
          })
          .then(refresh)
          .catch((e) => fail(e))
    }
  }, [route.thread, route.threadAccount, thread.data, readerAccount?.status])
  useEffect(() => {
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'changed') void refresh()
      if (event.type === 'accounts') {
        queryClient.setQueryData<Bootstrap>(
          ['bootstrap'],
          (old) => old && { ...old, accounts: event.accounts },
        )
        void refresh()
      }
      if (event.type === 'mailto') onMailto(event.url)
      if (event.type === 'open')
        go({ thread: event.threadId, threadAccount: event.accountId }, false)
      if (event.type === 'progress')
        setProgress(event.completed.toLocaleString() + ' of ' + event.total.toLocaleString())
      if (event.type === 'submissions')
        // A pushed list is newer than any fetch still in flight, so that fetch must not win.
        void queryClient
          .cancelQueries({ queryKey: ['submissions'] })
          .then(() =>
            queryClient.setQueryData<SubmissionSummary[]>(['submissions'], event.submissions),
          )
      if (event.type === 'update') setUpdateStatus(event.status)
    })
    if (boot.data) {
      void api
        .updateStatus()
        .then(setUpdateStatus)
        .catch(() => {})
      void api.ready().catch((e) => fail(e))
    }
    return unsubscribe
  }, [accounts, queryId, !!boot.data])
  useEffect(() => {
    if (accounts.length && pendingMailto.current) {
      const url = pendingMailto.current
      pendingMailto.current = undefined
      setSettingsOpen(false)
      onMailto(url)
    }
  }, [accounts.length])
  useEffect(() => {
    if (!route.thread) return
    const index = conversations.findIndex(
      (c) => c.id === route.thread && c.accountId === route.threadAccount,
    )
    for (const nearby of [conversations[index - 1], conversations[index + 1]]) {
      if (nearby && accounts.some((a) => a.id === nearby.accountId && a.status === 'connected'))
        void queryClient.prefetchQuery({
          queryKey: ['thread', nearby.accountId, nearby.id],
          queryFn: () => api.conversation(nearby.accountId, nearby.id),
          staleTime: 60_000,
        })
    }
  }, [route.thread, route.threadAccount, conversations])
  const [toastHeld, setToastHeld] = useState(false)
  const canUndo = !!toast?.undoId || !!toast?.onUndo
  const toastDuration = canUndo ? 9000 : toast?.tone === 'error' ? 8000 : 5000
  useEffect(() => {
    if (!toast || toastHeld) return
    const timer = setTimeout(() => setToast(undefined), toastDuration)
    return () => clearTimeout(timer)
  }, [toast, toastHeld])
  useEffect(() => {
    const pending = pendingDiscard.current
    if (!pending || pending.toastId === toast?.id) return
    pendingDiscard.current = undefined
    void commitDiscard(pending.items)
  }, [toast?.id])
  const undo = async (id = toast?.undoId) => {
    if (toast?.onUndo) return toast.onUndo()
    if (!id) return
    setToast({ text: 'Undoing…' })
    try {
      const result = await api.undo(id)
      if (result.failures.length) notify(result.failures[0], 'error')
      else notify('Undone.')
      await refresh()
    } catch (e) {
      fail(e)
    }
  }
  const openSettings = (tab = 'general') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }
  const focusSearch = () => {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInput.current?.select())
  }
  const latest = thread.data?.at(-1)
  // The newest mailing-list message carries the sender's current unsubscribe address.
  const listMessage = thread.data && [...thread.data].reverse().find((m) => m.unsubscribe)
  const listKey = listMessage && scopeKey(listMessage.accountId, listMessage.id)
  const unsubscribeState: UnsubscribeState | undefined = listKey
    ? unsubscribes.get(listKey) || 'available'
    : undefined
  const unsubscribe = async () => {
    if (!listMessage || !listKey || unsubscribes.has(listKey)) return
    const mark = (state?: 'pending' | 'done') =>
      setUnsubscribes((current) => {
        const next = new Map(current)
        if (state) next.set(listKey, state)
        else next.delete(listKey)
        return next
      })
    const sender = listMessage.from[0]?.name || listMessage.from[0]?.email || 'this mailing list'
    mark('pending')
    try {
      const result = await api.unsubscribe(listMessage.accountId, listMessage.id)
      if (result.kind === 'done') {
        mark('done')
        notify('Unsubscribed from ' + sender)
        return
      }
      mark()
      if (result.kind === 'mailto' && result.url) onMailto(result.url)
      else notify('Finish unsubscribing in your browser', 'info')
    } catch (error) {
      mark()
      fail(error)
    }
  }
  const toggleStar = () =>
    void act(
      (
        route.thread
          ? thread.data?.some((m) => m.keywords.$flagged)
          : conversations.find((c) => c.key === focused)?.starred
      )
        ? 'unstar'
        : 'star',
    )
  const hasTarget = !!route.thread || !!selected.size || !!focused
  const on = { conflictBehavior: 'replace', enabled: !blocked } as const
  useHotkey('Mod+K', () => setPaletteOpen((p) => !p), {
    conflictBehavior: 'replace',
    enabled: !composer,
    ignoreInputs: false,
  })
  useHotkey('Mod+,', () => openSettings(), { ...on, ignoreInputs: false })
  useHotkey('[', () => setCollapsed((c) => !c), on)
  useHotkey('C', () => void compose(), on)
  useHotkey('/', focusSearch, on)
  useHotkey('J', () => step(1), on)
  useHotkey('K', () => step(-1), on)
  useHotkey('ArrowDown', () => step(1), on)
  useHotkey('ArrowUp', () => step(-1), on)
  useHotkey(
    'Enter',
    () => {
      const c = conversations.find((c) => c.key === focused) || conversations[0]
      if (c && !route.thread) open(c)
    },
    on,
  )
  useHotkey(
    'O',
    () => {
      const c = conversations.find((c) => c.key === focused) || conversations[0]
      if (c && !route.thread) open(c)
    },
    on,
  )
  useHotkey(
    'Escape',
    () => {
      if (route.thread) back()
      else if (draftSelected.size) setDraftSelected(new Set())
      else if (selected.size || allMatching) {
        setSelected(new Set())
        setAllMatching(false)
      } else if (searchOpen || route.q) {
        setSearch('')
        setSearchOpen(false)
        if (route.q) go({ q: undefined }, false)
      }
    },
    on,
  )
  useHotkey(
    'X',
    () => {
      if (focused) toggle(focused)
    },
    { ...on, enabled: !blocked && !route.thread },
  )
  useHotkey(
    'Shift+X',
    () => {
      if (focused) toggle(focused, true)
    },
    { ...on, enabled: !blocked && !route.thread },
  )
  useHotkey(
    'Mod+A',
    () => {
      if (view === 'drafts')
        return setDraftSelected(new Set(draftItems.filter(deletable).map((item) => item.key)))
      setSelected(new Set(conversations.map((c) => c.key)))
      setAllMatching(false)
    },
    { ...on, enabled: !blocked && !route.thread },
  )
  // In Drafts, the trash keys delete the selected drafts rather than moving conversations.
  const trashKey = () => (view === 'drafts' ? discardDrafts(draftSelected) : void act('trash'))
  const canTrash = !blocked && (view === 'drafts' ? !!draftSelected.size : hasTarget)
  useHotkey('E', () => void act('archive'), { ...on, enabled: !blocked && hasTarget })
  useHotkey('Backspace', trashKey, { ...on, enabled: canTrash })
  useHotkey('Delete', trashKey, { ...on, enabled: canTrash })
  useCharacterKey('#', trashKey, canTrash)
  useCharacterKey('!', () => void act('spam'), !blocked && hasTarget)
  useCharacterKey('?', () => setHelp(true), !blocked)
  useHotkey('U', () => void act('unread'), { ...on, enabled: !blocked && hasTarget })
  useHotkey('Shift+U', () => void act('unread'), { ...on, enabled: !blocked && hasTarget })
  useHotkey('Shift+I', () => void act('read'), { ...on, enabled: !blocked && hasTarget })
  useHotkey('S', toggleStar, { ...on, enabled: !blocked && hasTarget })
  useHotkey('V', () => openMove(targets()), {
    ...on,
    enabled: !blocked && hasTarget && !allMatching,
  })
  useHotkey('Z', () => void undo(), { ...on, enabled: !blocked && canUndo })
  useHotkey('Mod+Z', () => void undo(), { ...on, enabled: !blocked && canUndo })
  useHotkey(
    'R',
    () => {
      if (latest) void compose(latest)
    },
    { ...on, enabled: !blocked && !!route.thread },
  )
  useHotkey(
    'A',
    () => {
      if (latest) void compose(latest, 'replyAll')
    },
    { ...on, enabled: !blocked && !!route.thread },
  )
  useHotkey(
    'F',
    () => {
      if (latest) void compose(latest, 'forward')
    },
    { ...on, enabled: !blocked && !!route.thread },
  )
  useHotkey('Mod+U', () => void unsubscribe(), {
    ...on,
    enabled: !blocked && unsubscribeState === 'available',
  })
  useHotkeySequence(['G', 'I'], () => go({ view: 'inbox' }), on)
  useHotkeySequence(['G', 'S'], () => go({ view: 'starred' }), on)
  useHotkeySequence(['G', 'T'], () => go({ view: 'sent' }), on)
  useHotkeySequence(['G', 'D'], () => go({ view: 'drafts' }), on)
  useHotkeySequence(['G', 'A'], () => go({ view: 'archive' }), on)
  const suggestions = useMemo(() => {
    // People you hear from most come first; your own addresses never appear.
    const own = new Set(accounts.map((a) => a.email.toLowerCase()))
    const seen = new Map<string, { address: Address; count: number }>()
    for (const c of conversations)
      for (const m of c.messages)
        for (const address of [...m.from, ...m.to, ...m.cc]) {
          const key = address.email.toLowerCase()
          if (own.has(key)) continue
          const entry = seen.get(key)
          if (entry) {
            entry.count++
            if (!entry.address.name && address.name) entry.address = address
          } else seen.set(key, { address, count: 1 })
        }
    return [...seen.values()].sort((a, b) => b.count - a.count).map((entry) => entry.address)
  }, [conversations, accounts])
  const savePreferences = async (patch: Partial<typeof settings>) => {
    try {
      const next = await api.settings({ ...settings, ...patch })
      queryClient.setQueryData<Bootstrap>(['bootstrap'], (old) => old && { ...old, settings: next })
    } catch (e) {
      fail(e)
    }
  }
  const commandTarget = route.thread || selected.size || focused
  const limited = (action: MailAction) => {
    const reason = commandTarget ? unavailable(action) : undefined
    return reason ? { disabled: true, description: reason } : {}
  }
  const conversationCommands: Command[] = commandTarget
    ? [
        {
          id: 'archive',
          label: 'Archive',
          icon: Archive,
          key: 'E',
          run: () => void act('archive'),
          ...limited('archive'),
        },
        {
          id: 'trash',
          label: 'Move to trash',
          icon: Trash2,
          key: '#',
          keywords: 'delete',
          run: () => void act('trash'),
          ...limited('trash'),
        },
        {
          id: 'read',
          label: 'Mark as read',
          icon: MailOpen,
          key: 'Shift I',
          run: () => void act('read'),
        },
        {
          id: 'unread',
          label: 'Mark as unread',
          icon: Mail,
          key: 'U',
          run: () => void act('unread'),
        },
        {
          id: 'star',
          label: 'Star or unstar',
          icon: Star,
          key: 'S',
          keywords: 'flag favorite',
          run: toggleStar,
        },
        ...(!allMatching
          ? [
              {
                id: 'move',
                label: 'Move to folder…',
                icon: FolderInput,
                key: 'V',
                keywords: 'label file',
                run: () => openMove(targets()),
                ...limited('move'),
              },
            ]
          : []),
        {
          id: 'spam',
          label: 'Mark as spam',
          icon: ShieldX,
          key: '!',
          keywords: 'junk',
          run: () => void act('spam'),
          ...limited('spam'),
        },
        ...(latest && route.thread
          ? [
              {
                id: 'reply',
                label: 'Reply',
                icon: Reply,
                key: 'R',
                run: () => void compose(latest),
              },
              {
                id: 'reply-all',
                label: 'Reply all',
                icon: ReplyAll,
                key: 'A',
                run: () => void compose(latest, 'replyAll'),
              },
              {
                id: 'forward',
                label: 'Forward',
                icon: Forward,
                key: 'F',
                run: () => void compose(latest, 'forward'),
              },
            ]
          : []),
        ...(unsubscribeState && unsubscribeState !== 'done'
          ? [
              {
                id: 'unsubscribe',
                label: 'Unsubscribe from mailing list',
                icon: MailMinus,
                key: 'Ctrl U',
                keywords: 'newsletter opt out stop',
                run: () => void unsubscribe(),
                ...(unsubscribeState === 'pending'
                  ? { disabled: true, description: 'Unsubscribing…' }
                  : {}),
              },
            ]
          : []),
      ].map((c) => ({
        ...c,
        group: route.thread ? 'Conversation' : selected.size > 1 ? 'Selection' : 'Conversation',
      }))
    : []
  const commands: Command[] = [
    ...(toast && canUndo
      ? [
          {
            id: 'undo',
            group: 'Suggested',
            label: 'Undo “' + toast.text + '”',
            icon: Undo2,
            key: 'Z',
            run: () => void undo(),
          },
        ]
      : []),
    ...conversationCommands,
    {
      id: 'compose',
      group: 'Mail',
      label: 'Compose a message',
      icon: PenLine,
      key: 'C',
      keywords: 'new write email',
      run: () => void compose(),
    },
    {
      id: 'search-mail',
      group: 'Mail',
      label: 'Search mail',
      icon: Search,
      key: '/',
      keywords: 'find',
      run: focusSearch,
    },
    {
      id: 'refresh',
      group: 'Mail',
      label: 'Check for new mail',
      icon: RefreshCw,
      keywords: 'refresh sync reload',
      run: () => void refresh(),
    },
    ...views.map((v) => ({
      id: 'view-' + v.id,
      group: 'Go to',
      label: v.title,
      icon: v.icon,
      key: v.key,
      keywords: 'go open view ' + (v.id === 'junk' ? 'junk' : ''),
      run: () => go({ view: v.id }),
    })),
    ...(accounts.length > 1
      ? [
          {
            id: 'account-all',
            group: 'Accounts',
            label: 'All accounts',
            icon: Inbox,
            keywords: 'unified switch account',
            checked: !account,
            run: () => go({ view: 'inbox' }),
          },
          ...accounts.map((a) => ({
            id: 'account-' + a.id,
            group: 'Accounts',
            label: a.name,
            icon: Inbox,
            account: a,
            keywords: a.email + ' switch account',
            checked: account?.id === a.id,
            run: () => go({ view: 'inbox', account: a.id }),
          })),
        ]
      : []),
    ...(boxes.data || [])
      .filter((b) => !b.role)
      .map((b) => ({
        id: 'folder-' + b.id,
        group: 'Folders',
        label: b.name,
        icon: Folder,
        keywords: 'folder open go',
        run: () => go({ view: 'all', account: b.accountId, folder: b.id }),
      })),
    {
      id: 'folder-new',
      group: 'Folders',
      label: 'Create a folder…',
      icon: FolderPlus,
      keywords: 'new folder',
      run: () => setFolderDialog({ operation: 'create' }),
    },
    ...(['dark', 'light', 'system'] as const).map((theme) => ({
      id: 'theme-' + theme,
      group: 'Preferences',
      label: { dark: 'Dark theme', light: 'Light theme', system: 'Match system theme' }[theme],
      icon: { dark: Moon, light: Sun, system: Monitor }[theme],
      keywords: 'appearance theme mode colour color',
      checked: settings.theme === theme,
      run: () => void savePreferences({ theme }),
    })),
    {
      id: 'density',
      group: 'Preferences',
      label: density === 'compact' ? 'Comfortable density' : 'Compact density',
      icon: Rows3,
      keywords: 'display rows spacing list',
      run: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
    },
    {
      id: 'sidebar',
      group: 'Preferences',
      label: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      icon: collapsed ? PanelLeftOpen : PanelLeftClose,
      key: '[',
      keywords: 'navigation panel hide show',
      run: () => setCollapsed(!collapsed),
    },
    {
      id: 'settings',
      group: 'Preferences',
      label: 'Settings',
      icon: SettingsIcon,
      key: 'Ctrl ,',
      keywords: 'preferences options',
      run: () => openSettings(),
    },
    {
      id: 'accounts',
      group: 'Preferences',
      label: 'Manage accounts',
      icon: UserRound,
      keywords: 'add connect sign in',
      run: () => openSettings('accounts'),
    },
    {
      id: 'signatures',
      group: 'Preferences',
      label: 'Edit signatures',
      icon: PenLine,
      keywords: 'sign-off',
      run: () => openSettings('signatures'),
    },
    {
      id: 'shortcuts',
      group: 'Help',
      label: 'Keyboard shortcuts',
      icon: Keyboard,
      key: '?',
      keywords: 'help keys hotkeys',
      run: () => setHelp(true),
    },
  ]
  const activeIndex = conversations.findIndex(
    (c) => c.id === route.thread && c.accountId === route.threadAccount,
  )
  const title = route.q
    ? 'Search results'
    : currentFolder?.name || views.find((v) => v.id === view)?.title || 'All mail'
  const hasFilters = Object.values(filters).some(Boolean)
  // The Unread tab is a filter too, but an empty Unread list isn't a failed search.
  const hasSearchFilters = Object.entries(filters).some(([key, value]) => key !== 'unread' && value)
  const filterLabels: Record<string, string> = {
    from: 'From',
    to: 'To',
    subject: 'Subject',
    after: 'After',
    before: 'Before',
    hasAttachment: 'Has attachments',
  }
  const filterChips = Object.entries(filters).filter(([key, value]) => key !== 'unread' && value)
  const selectedCount = allMatching ? total : selected.size
  const changeFolder = async (name: string) => {
    if (!folderDialog) return
    const accountId = folderDialog.accountId || folderDialog.folder?.accountId || folderAccountId
    try {
      await api.folder({
        accountId,
        operation: folderDialog.operation,
        id: folderDialog.folder?.id,
        name,
      })
      setFolderDialog(undefined)
      await refresh()
      if (
        folderDialog.operation === 'delete' &&
        route.account === accountId &&
        route.folder === folderDialog.folder?.id
      )
        go({ view: 'inbox', account: accountId })
      notify(
        'Folder ' +
          (folderDialog.operation === 'create'
            ? 'created'
            : folderDialog.operation === 'rename'
              ? 'renamed'
              : 'deleted') +
          '.',
      )
    } catch (e) {
      fail(e)
    }
  }
  return (
    <div className={'app-shell ' + (collapsed ? 'sidebar-collapsed ' : '') + 'density-' + density}>
      <Sidebar
        accounts={accounts}
        boxesByAccount={mailboxCounts.boxesByAccount}
        route={route}
        view={view}
        draftCount={drafts.data?.filter((d) => !discarding.has('local:' + d.id)).length || 0}
        hasServerDrafts={mailboxCounts.drafts > 0}
        sendingIssues={pendingSends.length}
        unreadCount={mailboxCounts.unread}
        accountUnread={mailboxCounts.byAccount}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onSearch={() => setPaletteOpen(true)}
        onCompose={() => void compose()}
        onNavigate={go}
        onSettings={(tab) => {
          setSettingsTab(tab)
          setSettingsOpen(true)
        }}
        onFolderAction={(operation, accountId, folder) =>
          setFolderDialog({ operation, accountId, folder })
        }
      />
      <main className="main-content">
        <UpdateNotice status={updateStatus} />
        {!boot.data ? (
          <EmptyState
            icon={Mail}
            title={boot.isError ? 'Inlark couldn’t start' : 'Starting Inlark'}
            description={boot.isError ? friendlyError(boot.error) : undefined}
          >
            {!boot.isError && <Spinner />}
          </EmptyState>
        ) : !accounts.length ? (
          <EmptyState
            icon={Inbox}
            title="Welcome to Inlark"
            description="Connect your email account to get started."
          >
            <Button
              variant="primary"
              onClick={() => {
                setSettingsTab('accounts')
                setSettingsOpen(true)
              }}
            >
              <Plus size={14} />
              Connect an account
            </Button>
          </EmptyState>
        ) : route.thread && readerAccount ? (
          thread.data ? (
            <Reader
              key={scopeKey(readerAccount.id, route.thread!)}
              messages={thread.data}
              backLabel={title}
              busy={busy}
              account={readerAccount}
              settings={settings}
              onBack={back}
              onPrevious={activeIndex > 0 ? () => step(-1) : undefined}
              onNext={
                activeIndex >= 0 &&
                (activeIndex < conversations.length - 1 || mail.hasNextPage) &&
                !mail.isFetchingNextPage
                  ? () => step(1)
                  : undefined
              }
              position={activeIndex >= 0 ? activeIndex + 1 + ' of ' + total.toLocaleString() : ''}
              loading={thread.isPlaceholderData}
              onAction={(action) => void act(action)}
              onMove={() => openMove(targets())}
              onReply={(message, kind) => void compose(message, kind)}
              notify={notify}
              onMailto={onMailto}
              unsubscribe={unsubscribeState}
              onUnsubscribe={() => void unsubscribe()}
            />
          ) : (
            <EmptyState
              icon={thread.isError ? WifiOff : Mail}
              title={thread.isError ? 'This conversation is unavailable' : 'Opening conversation'}
              description={thread.isError ? friendlyError(thread.error) : undefined}
            >
              <Button onClick={back}>Back to inbox</Button>
            </EmptyState>
          )
        ) : (
          <>
            <div className="list-heading">
              <div className="list-title">
                <div className="list-eyebrow">
                  Mail <ChevronRight size={10} />
                  <Dropdown
                    trigger={
                      <button className="account-switcher" aria-label="Switch account">
                        {account && <AccountMark account={account} size={16} />}
                        <span>{account?.name || 'All accounts'}</span>
                        <ChevronDown size={11} />
                      </button>
                    }
                  >
                    <div className="account-menu">
                      <div className="menu-label">Mail accounts</div>
                      <MenuItem onClick={() => go({ view, q: route.q })}>
                        <Inbox size={15} />
                        <span className="account-menu-label">
                          <strong>All accounts</strong>
                          <small>Unified inbox</small>
                        </span>
                        {!account && <Check size={14} className="account-menu-check" />}
                      </MenuItem>
                      <div className="account-menu-divider" />
                      {accounts.map((item) => (
                        <MenuItem
                          key={item.id}
                          onClick={() => go({ view, q: route.q, account: item.id })}
                        >
                          <AccountMark account={item} size={28} />
                          <span className="account-menu-label">
                            <strong>{item.name}</strong>
                            <small>{item.email}</small>
                          </span>
                          {item.id === account?.id && (
                            <Check size={14} className="account-menu-check" />
                          )}
                        </MenuItem>
                      ))}
                    </div>
                  </Dropdown>
                </div>
                <h1>
                  {title}
                  <span>
                    {view === 'drafts'
                      ? (
                          total +
                          (drafts.data?.filter(
                            (d) => (!route.account || d.accountId === route.account) && !d.serverId,
                          ).length || 0) -
                          (allDraftItems.length - draftItems.length)
                        ).toLocaleString()
                      : total.toLocaleString() + (incomplete.length ? '+' : '')}
                  </span>
                </h1>
                {route.q && <p>Results for “{route.q}”</p>}
              </div>
              <div className="list-heading-actions">
                <IconButton label="Refresh mail" onClick={() => void refresh()}>
                  <RefreshCw
                    size={15}
                    className={mail.isFetching && !mail.isFetchingNextPage ? 'spin' : ''}
                  />
                </IconButton>
                <IconButton
                  label="Search mail"
                  shortcut="/"
                  onClick={() => {
                    setSearchOpen(!searchOpen)
                    requestAnimationFrame(() => searchInput.current?.focus())
                  }}
                >
                  <Search size={16} />
                </IconButton>
                {view !== 'drafts' && (
                  <Dropdown
                    trigger={
                      <IconButton label="Display options">
                        <Rows3 size={15} />
                      </IconButton>
                    }
                  >
                    <div className="menu-label">Message density</div>
                    <MenuItem onClick={() => setDensity('comfortable')}>
                      <span className="menu-check">
                        {density === 'comfortable' && <Check size={14} />}
                      </span>
                      Comfortable
                    </MenuItem>
                    <MenuItem onClick={() => setDensity('compact')}>
                      <span className="menu-check">
                        {density === 'compact' && <Check size={14} />}
                      </span>
                      Compact
                    </MenuItem>
                  </Dropdown>
                )}
              </div>
            </div>
            {searchOpen && (
              <form
                className="mail-search"
                onSubmit={(e) => {
                  e.preventDefault()
                  go({ q: search || undefined, ...(search ? { view: 'all' } : {}) }, false)
                }}
              >
                <Search size={16} />
                <input
                  ref={searchInput}
                  placeholder="Search mail"
                  aria-label="Search email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>Enter</kbd>
                <IconButton
                  label="Clear search"
                  onClick={() => {
                    setSearch('')
                    setSearchOpen(false)
                    go({ q: undefined }, false)
                  }}
                >
                  <X size={14} />
                </IconButton>
              </form>
            )}
            {!!filterChips.length && (
              <div className="active-filters" aria-label="Active filters">
                {filterChips.map(([key, value]) => (
                  <button
                    key={key}
                    className="filter-chip"
                    aria-label={'Remove ' + (filterLabels[key] || key) + ' filter'}
                    onClick={() => setFilters((current) => ({ ...current, [key]: undefined }))}
                  >
                    <span>
                      {filterLabels[key] || key}
                      {typeof value === 'string' &&
                        ': ' + (key === 'after' || key === 'before' ? value.slice(0, 10) : value)}
                    </span>
                    <X size={12} />
                  </button>
                ))}
                <button className="clear-filters" onClick={() => setFilters({})}>
                  Clear all
                </button>
              </div>
            )}
            {view !== 'drafts' && (
              <div className="list-toolbar">
                <Checkbox
                  aria-label={selected.size ? 'Deselect all' : 'Select loaded conversations'}
                  checked={
                    allMatching ||
                    (conversations.length > 0 && selected.size === conversations.length)
                  }
                  indeterminate={
                    !allMatching && selected.size > 0 && selected.size < conversations.length
                  }
                  disabled={!conversations.length || busy}
                  onCheckedChange={() => {
                    setSelected(
                      selected.size ? new Set() : new Set(conversations.map((c) => c.key)),
                    )
                    setAllMatching(false)
                  }}
                />
                <div className="list-tabs">
                  <button
                    aria-pressed={!filters.unread}
                    className={!filters.unread ? 'active' : ''}
                    onClick={() => setFilters((f) => ({ ...f, unread: undefined }))}
                  >
                    All messages
                  </button>
                  <button
                    aria-pressed={!!filters.unread}
                    className={filters.unread ? 'active' : ''}
                    onClick={() => setFilters((f) => ({ ...f, unread: true }))}
                  >
                    Unread
                  </button>
                </div>
                <div className="list-toolbar-actions">
                  <Button variant="ghost" size="small" onClick={() => setFilterOpen(true)}>
                    <SlidersHorizontal size={13} />
                    Filter{hasFilters && <span className="filter-dot" />}
                  </Button>
                </div>
              </div>
            )}
            {!!selected.size && view !== 'drafts' && (
              <div className="selection-bar" role="region" aria-label="Selection actions">
                <div className="selection-summary">
                  <span className="selection-count" role="status">
                    {selectedCount.toLocaleString()} selected
                  </span>
                  {!allMatching && total > selected.size && (
                    <button
                      className="text-action"
                      disabled={busy}
                      onClick={() => setAllMatching(true)}
                    >
                      Select all {total.toLocaleString()}
                    </button>
                  )}
                </div>
                <span className="toolbar-divider" />
                <HintIconButton
                  label="Archive selected"
                  shortcut="E"
                  disabled={busy}
                  hint={unavailable('archive')}
                  onClick={() => void act('archive')}
                >
                  <Archive size={16} />
                </HintIconButton>
                <IconButton
                  label="Mark selected read"
                  disabled={busy}
                  onClick={() => void act('read')}
                >
                  <Check size={16} />
                </IconButton>
                <HintIconButton
                  label="Trash selected"
                  disabled={busy}
                  hint={unavailable('trash')}
                  onClick={() => void act('trash')}
                >
                  <Trash2 size={16} />
                </HintIconButton>
                <Dropdown
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label="More selection actions"
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  }
                >
                  <MenuItem onClick={() => void act('unread')}>Mark unread</MenuItem>
                  <MenuItem onClick={() => void act('star')}>Star</MenuItem>
                  <MenuItem
                    onClick={() => openMove(targets())}
                    disabled={allMatching || !!unavailable('move')}
                  >
                    Move to folder
                  </MenuItem>
                  <MenuItem onClick={() => void act('spam')} disabled={!!unavailable('spam')}>
                    Mark spam
                  </MenuItem>
                  <MenuItem onClick={() => void act('restore')} disabled={!!unavailable('restore')}>
                    Restore to inbox
                  </MenuItem>
                  {view === 'trash' && (
                    <MenuItem
                      danger
                      onClick={() => void act('destroy')}
                      disabled={!!unavailable('destroy')}
                    >
                      Delete permanently
                    </MenuItem>
                  )}
                  {[...new Set([unavailable('move'), view === 'trash' && unavailable('destroy')])]
                    .filter(Boolean)
                    .map((reason) => (
                      <p className="menu-note" key={String(reason)}>
                        {reason}
                      </p>
                    ))}
                </Dropdown>
                <span className="toolbar-divider" />
                <IconButton
                  label="Clear selection"
                  shortcut="Esc"
                  disabled={busy}
                  onClick={() => {
                    setSelected(new Set())
                    setAllMatching(false)
                    listRef.current?.focus()
                  }}
                >
                  <X size={14} />
                </IconButton>
              </div>
            )}
            {view === 'drafts' && !!draftSelected.size && (
              <DraftSelectionBar
                count={draftSelected.size}
                total={draftItems.filter(deletable).length}
                onSelectAll={() =>
                  setDraftSelected(new Set(draftItems.filter(deletable).map((item) => item.key)))
                }
                onDelete={() => discardDrafts(draftSelected)}
                onClear={() => setDraftSelected(new Set())}
              />
            )}
            {(mail.isError || mail.data?.pages.some((p) => p.failedAccounts.length)) && (
              <div className="connection-banner">
                <WifiOff size={13} />
                {mail.isError
                  ? friendlyError(mail.error)
                  : 'Some accounts are unavailable. Showing mail from connected accounts.'}
                <button onClick={() => void refresh()}>Retry</button>
              </div>
            )}
            {!!incomplete.length && view !== 'drafts' && (
              <div className="indexing-notice" role="status">
                <span>
                  Still indexing {incomplete.map((a) => a.name).join(' and ')} — older mail may be
                  missing
                </span>
                {incomplete.length === 1 && incomplete[0].indexing && (
                  <IndexingMeter indexing={incomplete[0].indexing} label="Indexed" />
                )}
              </div>
            )}
            {view === 'drafts' ? (
              <div className="draft-list">
                <SubmissionList
                  submissions={pendingSends.filter(
                    (s) => !route.account || s.accountId === route.account,
                  )}
                  accounts={accounts}
                  onOpenDraft={setComposer}
                  notify={notify}
                />
                {!!pendingSends.length && !!draftItems.length && (
                  <h2 className="draft-section-label">Drafts</h2>
                )}
                <DraftRows
                  items={draftItems}
                  accounts={accounts}
                  selected={draftSelected}
                  onOpen={(item) => void openDraft(item)}
                  onSelect={toggleDraft}
                  onDelete={discardDrafts}
                />
                {mail.hasNextPage && (
                  <div className="load-more">
                    <Button
                      disabled={mail.isFetchingNextPage}
                      onClick={() => void mail.fetchNextPage()}
                    >
                      {mail.isFetchingNextPage ? 'Loading…' : 'Load more server drafts'}
                    </Button>
                  </div>
                )}
                {!draftItems.length && !pendingSends.length && (
                  <EmptyState
                    icon={FileText}
                    title="No drafts"
                    description="Messages you start writing are saved here automatically."
                  >
                    <Button onClick={() => void compose()}>Write a message</Button>
                  </EmptyState>
                )}
              </div>
            ) : !conversations.length && mail.isLoading ? (
              <div className="mail-list list-skeleton" aria-busy="true" aria-label="Loading mail">
                {Array.from({ length: 9 }, (_, i) => (
                  <div className="mail-row skeleton-row" key={i}>
                    <span className="row-selector" />
                    <span className="skeleton-avatar" />
                    <span className="skeleton-line" style={{ width: 120 + ((i * 37) % 50) }} />
                    <span className="row-content">
                      <span
                        className="skeleton-line"
                        style={{ width: 40 + ((i * 23) % 35) + '%' }}
                      />
                      <span
                        className="skeleton-line faint"
                        style={{ width: 55 + ((i * 17) % 30) + '%' }}
                      />
                    </span>
                    <span className="skeleton-line" style={{ width: 44 }} />
                  </div>
                ))}
              </div>
            ) : !conversations.length ? (
              mail.isLoading ? (
                <EmptyState icon={Mail} title="Loading mail">
                  <Spinner />
                </EmptyState>
              ) : (
                <EmptyState
                  {...emptyListState(view, {
                    searching: !!route.q || hasSearchFilters,
                    unreadOnly: !!filters.unread,
                  })}
                >
                  {hasSearchFilters && (
                    <Button onClick={() => setFilters({})}>Clear filters</Button>
                  )}
                  {view === 'inbox' && !route.q && !hasFilters && (
                    <span className="empty-hint">
                      <kbd>C</kbd> Write a message
                    </span>
                  )}
                </EmptyState>
              )
            ) : (
              <ConversationList
                conversations={conversations}
                accounts={accounts}
                queryId={queryId}
                total={total}
                density={density}
                selected={selected}
                allMatching={allMatching}
                focused={focused}
                busy={busy}
                remoteImages={settings.remoteImages}
                view={view}
                hasNextPage={!!mail.hasNextPage}
                isFetchingNextPage={mail.isFetchingNextPage}
                listRef={listRef}
                handleRef={listHandle}
                offsets={offsets}
                onFetchNextPage={() => void mail.fetchNextPage()}
                onOpen={open}
                onFocus={setFocused}
                onSelect={toggle}
                onAction={(action, conversation) =>
                  void act(action, [
                    { accountId: conversation.accountId, threadId: conversation.id },
                  ])
                }
              />
            )}
            <footer className="list-footer">
              <span role="status">
                {busy ? (
                  <>
                    <Spinner size={11} />
                    {progress || 'Updating…'}
                  </>
                ) : (
                  <>
                    <span
                      className={
                        'connection-dot ' +
                        (accounts.some((a) => a.status !== 'connected') ? 'connection-pending' : '')
                      }
                    />
                    {accounts.every((a) => a.status === 'connected')
                      ? 'All accounts connected'
                      : accounts.filter((a) => a.status === 'connected').length +
                        ' of ' +
                        accounts.length +
                        ' connected'}
                  </>
                )}
              </span>
              <button
                className="footer-shortcuts"
                onClick={() => setHelp(true)}
                aria-label="Show keyboard shortcuts"
              >
                <kbd>J</kbd>
                <kbd>K</kbd>
                <span>Navigate</span>
                <kbd>↵</kbd>
                <span>Open</span>
                <kbd>?</kbd>
                <span>Shortcuts</span>
              </button>
            </footer>
          </>
        )}
      </main>
      {toast && (
        <div
          className={'toast' + (toast.tone === 'error' ? ' toast-error' : '')}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => setToastHeld(true)}
          onMouseLeave={() => setToastHeld(false)}
          key={toast.id}
        >
          {toast.tone === 'error' ? (
            <AlertCircle size={15} />
          ) : toast.tone === 'info' ? (
            <Info size={15} />
          ) : (
            <Check size={15} />
          )}
          <span>{toast.text}</span>
          {canUndo && (
            <button className="toast-undo" onClick={() => void undo()}>
              Undo <kbd>Z</kbd>
            </button>
          )}
          <button
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setToast(undefined)}
          >
            <X size={13} />
          </button>
          {!toastHeld && (
            <span
              className="toast-timer"
              style={{ animationDuration: toastDuration + 'ms' }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
      <Suspense
        fallback={
          <div className="toast" role="status">
            <Spinner />
            Opening…
          </div>
        }
      >
        {composer && (
          <Composer
            key={composer.id}
            initial={composer}
            suggestions={suggestions}
            accounts={accounts}
            onClose={() => setComposer(undefined)}
            onOpenAccounts={() => openSettings('accounts')}
            notify={notify}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: ['drafts'] })}
          />
        )}
        {settingsOpen && (
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            bootstrap={bootstrap}
            onChange={(settings) =>
              queryClient.setQueryData(['bootstrap'], { ...bootstrap, settings })
            }
            notify={notify}
            initialTab={settingsTab}
          />
        )}
      </Suspense>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSearch={(q) => {
          setSearchOpen(true)
          go({ q, view: 'all' })
        }}
        commands={commands}
      />
      <ShortcutDialog open={help} onClose={() => setHelp(false)} />
      <FilterDialog
        key={filterOpen ? 'filter-open' : 'filter-closed'}
        open={filterOpen}
        filters={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next)
          setFilterOpen(false)
        }}
      />
      <FolderDialog
        key={
          folderDialog
            ? 'folder-' + folderDialog.operation + ':' + (folderDialog.folder?.id || '')
            : 'folder-closed'
        }
        dialog={folderDialog}
        onClose={() => setFolderDialog(undefined)}
        onSave={(name) => void changeFolder(name)}
      />
      <MoveDialog
        targets={moveTargets}
        accounts={accounts}
        onClose={() => setMoveTargets(undefined)}
        onMove={(id) => {
          void act('move', moveTargets, id)
          setMoveTargets(undefined)
        }}
      />
      <ConfirmActionDialog
        action={confirmAction}
        total={total}
        onClose={() => setConfirmAction(undefined)}
        onConfirm={(action) => {
          setConfirmAction(undefined)
          void act(action, undefined, undefined, true)
        }}
      />
    </div>
  )
}
