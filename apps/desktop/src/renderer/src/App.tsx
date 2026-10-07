import { cn } from '@inlark/ui'
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
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
  ShieldCheck,
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
  identitySignature,
  mailtoDraft,
  replyRecipients,
  replyTarget,
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
import { signatureBlock, signatureText } from './signature'
import { textSignatureMarker } from './composer-document'
import { selectConversation } from './selection'
import { ShortcutHint, useShortcutHandlers, useShortcutText, useShortcuts } from './shortcuts'
import { emptyListState } from './empty-states'
import { AccountMark } from './AccountMark'
import { HintIconButton } from './HintIconButton'
import { targetAccounts, targetLimit } from './account-limits'
import { SubmissionList } from './SendingStatus'
import { IndexingMeter } from './IndexingMeter'
import { UpdateNotice } from './UpdateNotice'
import { offersAction } from './view-actions'
import { version as packagedVersion } from '../../../package.json'
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
    version: packagedVersion,
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
  const shortcuts = useShortcuts()
  const keys = useShortcutText()
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
        notify('This account has no permitted sending identities.', 'error')
        return
      }
      const recipients = message
        ? replyRecipients(message, identities, kind === 'replyAll')
        : undefined
      const identity = recipients?.identity || identities[0]
      const signature = identitySignature(settings, identity)
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
        (signature.format === 'html'
          ? signature.value.trim()
            ? signatureBlock(signature.value)
            : ''
          : signature.value
            ? '<p ' +
              textSignatureMarker +
              '=""><br/>' +
              escapeHtml(signature.value).replace(/\n/g, '<br/>') +
              '</p>'
            : '') +
        quote
      const text = [
        partial.text || '',
        signature.format === 'html' ? signatureText(signature.value) : signature.value,
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
  /** A draft filed in the open conversation, preferring the local copy the composer edits. */
  const threadDraft = (message: Message): DraftItem => {
    const local = drafts.data?.find(
      (d) => d.accountId === message.accountId && d.serverId === message.id,
    )
    return local
      ? { kind: 'local', key: 'local:' + local.id, draft: local }
      : { kind: 'server', key: 'server:' + scopeKey(message.accountId, message.id), message }
  }
  const discardDrafts = (keys: Iterable<string>) => {
    const chosen = new Set(keys)
    discardDraftItems(draftItems.filter((item) => chosen.has(item.key)))
  }
  const discardDraftItems = (candidates: DraftItem[]) => {
    const items = candidates.filter(deletable)
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
  const latest = thread.data && replyTarget(thread.data)
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
  const openFocused = () => {
    const c = conversations.find((c) => c.key === focused) || conversations[0]
    if (c && !route.thread) open(c)
  }
  // In Drafts, the trash keys delete the selected drafts rather than moving conversations.
  const trashKey = () => (view === 'drafts' ? discardDrafts(draftSelected) : void act('trash'))
  const canTrash = !blocked && (view === 'drafts' ? !!draftSelected.size : hasTarget)
  const canAct = !blocked && hasTarget
  const inList = !blocked && !route.thread
  const inThread = !blocked && !!route.thread && !!latest
  const inMailList = inList && view !== 'drafts'
  const toggleUnread = () =>
    setFilters((current) => ({ ...current, unread: current.unread ? undefined : true }))
  const toggleDensity = () =>
    setDensity((current) => (current === 'compact' ? 'comfortable' : 'compact'))
  const createFolder = () => setFolderDialog({ operation: 'create', accountId: route.account })
  useShortcutHandlers(
    shortcuts.bindings,
    {
      commandMenu: {
        run: () => setPaletteOpen((p) => !p),
        enabled: !composer,
        ignoreInputs: false,
      },
      settings: { run: () => openSettings(), ignoreInputs: false },
      toggleSidebar: { run: () => setCollapsed((c) => !c) },
      compose: { run: () => void compose() },
      search: { run: focusSearch },
      refresh: {
        run: () => void refresh(),
        enabled: true,
        // F5 must refresh mail instead of reloading the app even when search has focus.
        // Keep custom letter bindings quiet while typing; modifier chords remain available.
        ignoreInputs: (binding) =>
          !binding.every((chord) =>
            /(^|\+)(Mod|Ctrl|Control|Meta|Alt)\+|^(Shift\+)?F\d+$/.test(chord),
          ),
      },
      filter: { run: () => setFilterOpen(true), enabled: inMailList },
      toggleUnread: { run: toggleUnread, enabled: inMailList },
      toggleDensity: { run: toggleDensity, enabled: inMailList },
      createFolder: { run: createFolder, enabled: !blocked && !!accounts.length },
      next: { run: () => step(1) },
      previous: { run: () => step(-1) },
      open: { run: openFocused },
      back: {
        run: () => {
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
      },
      select: {
        run: () => {
          if (focused) toggle(focused)
        },
        enabled: inList,
      },
      selectRange: {
        run: () => {
          if (focused) toggle(focused, true)
        },
        enabled: inList,
      },
      selectAll: {
        run: () => {
          if (view === 'drafts')
            return setDraftSelected(new Set(draftItems.filter(deletable).map((item) => item.key)))
          setSelected(new Set(conversations.map((c) => c.key)))
          setAllMatching(false)
        },
        enabled: inList,
      },
      archive: { run: () => void act('archive'), enabled: canAct },
      trash: { run: trashKey, enabled: canTrash },
      spam: { run: () => void act('spam'), enabled: canAct },
      notSpam: { run: () => void act('notSpam'), enabled: canAct && view !== 'drafts' },
      restore: { run: () => void act('restore'), enabled: canAct && view !== 'drafts' },
      shortcuts: { run: () => setHelp(true) },
      unread: { run: () => void act('unread'), enabled: canAct },
      read: { run: () => void act('read'), enabled: canAct },
      star: { run: toggleStar, enabled: canAct },
      move: { run: () => openMove(targets()), enabled: canAct && !allMatching },
      undo: { run: () => void undo(), enabled: !blocked && canUndo },
      reply: { run: () => latest && void compose(latest), enabled: inThread },
      replyAll: { run: () => latest && void compose(latest, 'replyAll'), enabled: inThread },
      forward: { run: () => latest && void compose(latest, 'forward'), enabled: inThread },
      unsubscribe: {
        run: () => void unsubscribe(),
        enabled: !blocked && unsubscribeState === 'available',
      },
      goInbox: { run: () => go({ view: 'inbox' }) },
      goStarred: { run: () => go({ view: 'starred' }) },
      goSent: { run: () => go({ view: 'sent' }) },
      goDrafts: { run: () => go({ view: 'drafts' }) },
      goArchive: { run: () => go({ view: 'archive' }) },
      goSpam: { run: () => go({ view: 'junk' }) },
      goTrash: { run: () => go({ view: 'trash' }) },
      goAll: { run: () => go({ view: 'all' }) },
    },
    !blocked,
  )
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
  const commandTarget = view !== 'drafts' && (route.thread || selected.size || focused)
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
          key: keys('archive'),
          run: () => void act('archive'),
          ...limited('archive'),
        },
        {
          id: 'trash',
          label: 'Move to trash',
          icon: Trash2,
          key: keys('trash'),
          keywords: 'delete',
          run: () => void act('trash'),
          ...limited('trash'),
        },
        {
          id: 'read',
          label: 'Mark as read',
          icon: MailOpen,
          key: keys('read'),
          run: () => void act('read'),
        },
        {
          id: 'unread',
          label: 'Mark as unread',
          icon: Mail,
          key: keys('unread'),
          run: () => void act('unread'),
        },
        {
          id: 'star',
          label: 'Star or unstar',
          icon: Star,
          key: keys('star'),
          keywords: 'flag favorite',
          run: toggleStar,
        },
        ...(!allMatching
          ? [
              {
                id: 'move',
                label: 'Move to folder…',
                icon: FolderInput,
                key: keys('move'),
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
          key: keys('spam'),
          keywords: 'junk',
          run: () => void act('spam'),
          ...limited('spam'),
        },
        {
          id: 'not-spam',
          label: 'Not spam',
          icon: ShieldCheck,
          key: keys('notSpam'),
          keywords: 'junk',
          run: () => void act('notSpam'),
          ...limited('notSpam'),
        },
        {
          id: 'restore',
          label: 'Restore to inbox',
          icon: Inbox,
          key: keys('restore'),
          keywords: 'recover unarchive',
          run: () => void act('restore'),
          ...limited('restore'),
        },
        ...(latest && route.thread
          ? [
              {
                id: 'reply',
                label: 'Reply',
                icon: Reply,
                key: keys('reply'),
                run: () => void compose(latest),
              },
              {
                id: 'reply-all',
                label: 'Reply all',
                icon: ReplyAll,
                key: keys('replyAll'),
                run: () => void compose(latest, 'replyAll'),
              },
              {
                id: 'forward',
                label: 'Forward',
                icon: Forward,
                key: keys('forward'),
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
                key: keys('unsubscribe'),
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
            key: keys('undo'),
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
      key: keys('compose'),
      keywords: 'new write email',
      run: () => void compose(),
    },
    {
      id: 'search-mail',
      group: 'Mail',
      label: 'Search mail',
      icon: Search,
      key: keys('search'),
      keywords: 'find',
      run: focusSearch,
    },
    {
      id: 'refresh',
      group: 'Mail',
      label: 'Check for new mail',
      icon: RefreshCw,
      key: keys('refresh'),
      keywords: 'refresh sync reload',
      run: () => void refresh(),
    },
    ...(view !== 'drafts' && !route.thread
      ? [
          {
            id: 'filter',
            group: 'Mail',
            label: 'Filter conversations…',
            icon: SlidersHorizontal,
            key: keys('filter'),
            run: () => setFilterOpen(true),
          },
          {
            id: 'unread-view',
            group: 'Mail',
            label: filters.unread ? 'Show all messages' : 'Show only unread messages',
            icon: Mail,
            key: keys('toggleUnread'),
            keywords: 'filter',
            run: toggleUnread,
          },
        ]
      : []),
    ...views.map((v) => ({
      id: 'view-' + v.id,
      group: 'Go to',
      label: v.title,
      icon: v.icon,
      key: v.shortcut && keys(v.shortcut),
      keywords: 'go open view ' + (v.id === 'junk' ? 'junk' : ''),
      run: () => go({ view: v.id }),
    })),
    {
      id: 'view-all',
      group: 'Go to',
      label: 'All mail',
      icon: Mail,
      key: keys('goAll'),
      keywords: 'go open view',
      run: () => go({ view: 'all' }),
    },
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
      key: keys('createFolder'),
      keywords: 'new folder',
      run: createFolder,
      disabled: !accounts.length,
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
      key: keys('toggleDensity'),
      keywords: 'display rows spacing list',
      run: toggleDensity,
    },
    {
      id: 'sidebar',
      group: 'Preferences',
      label: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      icon: collapsed ? PanelLeftOpen : PanelLeftClose,
      key: keys('toggleSidebar'),
      keywords: 'navigation panel hide show',
      run: () => setCollapsed(!collapsed),
    },
    {
      id: 'settings',
      group: 'Preferences',
      label: 'Settings',
      icon: SettingsIcon,
      key: keys('settings'),
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
      key: keys('shortcuts'),
      keywords: 'help keys hotkeys',
      run: () => setHelp(true),
    },
    {
      id: 'shortcut-settings',
      group: 'Help',
      label: 'Customize keyboard shortcuts',
      icon: Keyboard,
      keywords: 'hotkeys keys bindings change edit',
      run: () => openSettings('shortcuts'),
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
  // Picked days are stored as UTC midnight; reading them in UTC keeps the day that was chosen.
  const chipDate = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const selectedCount = allMatching ? total : selected.size
  // Search results can come from anywhere, so they offer every action.
  const listView: View = route.q ? 'all' : view
  const selectedConversations = conversations.filter((c) => selected.has(c.key))
  const selectionStarred =
    !allMatching && !!selectedConversations.length && selectedConversations.every((c) => c.starred)
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
    <div
      className={cn(
        'app-shell flex h-full min-w-0 pt-[max(8px,var(--titlebar-height))] pb-2 pr-2 pl-0 bg-sidebar',
        '[--row-height:64px] [--rail:224px]',
        '[&.sidebar-collapsed]:[--rail:64px] [&.density-compact]:[--row-height:44px]',
        'max-[1100px]:[&:not(.sidebar-collapsed)]:[--rail:204px] max-[700px]:[&:not(.sidebar-collapsed)]:[--rail:188px]',
        collapsed && 'sidebar-collapsed',
        'density-' + density,
      )}
    >
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
      <main className="main-content @container/mail shadow-[0_2px_8px_#0000000a] relative flex-1 min-w-0 flex flex-col bg-background border border-solid border-border-strong rounded-xl overflow-hidden">
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
              messages={thread.data.filter(
                (m) => !discarding.has('server:' + scopeKey(m.accountId, m.id)),
              )}
              view={route.q ? 'all' : view}
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
              onEditDraft={(message) => void openDraft(threadDraft(message))}
              onDiscardDraft={(message) => {
                const item = threadDraft(message)
                if (deletable(item)) discardDraftItems([item])
                else notify('Check this message’s delivery status before deleting the draft.')
              }}
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
              <Button onClick={back}>Back to {title.toLowerCase()}</Button>
            </EmptyState>
          )
        ) : (
          <>
            <div
              className={cn(
                'list-heading flex items-center justify-between pt-5.25 pb-4.75 px-7 shrink-0 gap-4 [&_h1]:m-0 [&_h1]:flex',
                '[&_h1]:items-center [&_h1]:gap-2.5 [&_h1]:text-[22px] [&_h1]:tracking-[-0.65px] [&_h1]:leading-[1.3]',
                '[&_h1]:font-semibold [&_h1>span]:text-[12px] [&_h1>span]:tracking-[0] [&_h1>span]:font-medium',
                '[&_h1>span]:text-muted [&_h1>span]:bg-surface [&_h1>span]:border [&_h1>span]:border-solid',
                '[&_h1>span]:border-border [&_h1>span]:py-[2px] [&_h1>span]:px-1.75 [&_h1>span]:rounded-md',
                '[&_h1>span]:tabular-nums [&_p]:text-muted [&_p]:text-[12px] [&_p]:mt-1.75 [&_p]:mb-0 [&_p]:mx-0',
                '@max-[900px]/mail:pl-5.5 @max-[900px]/mail:pr-5.5 @max-[680px]/mail:pt-5 @max-[680px]/mail:pb-4.25',
                '@max-[680px]/mail:px-5 @max-[440px]/mail:[&_h1]:text-[21px]',
              )}
            >
              <div className="list-title min-w-0">
                <div className="list-eyebrow [&_svg]:text-faint flex items-center gap-1.75 text-[11px] text-muted mb-1.5">
                  Mail <ChevronRight size={10} />
                  <Dropdown
                    trigger={
                      <button
                        className={cn(
                          'account-switcher inline-flex items-center gap-1.5 py-[2px] px-1.25 my-[-2px] -mx-1.25 border-0 rounded-xs',
                          'bg-none bg-transparent text-[inherit] min-w-0 [&>span:not(.account-mark)]:overflow-hidden',
                          '[&>span:not(.account-mark)]:text-ellipsis [&>span:not(.account-mark)]:whitespace-nowrap hover:text-foreground',
                          'hover:bg-hover data-popup-open:text-foreground data-popup-open:bg-hover',
                        )}
                        aria-label="Switch account"
                      >
                        {account && <AccountMark account={account} size={16} />}
                        <span>{account?.name || 'All accounts'}</span>
                        <ChevronDown size={11} />
                      </button>
                    }
                  >
                    <div className="account-menu [&_.menu-item]:min-h-12 [&_.menu-item]:gap-3 w-62.5 max-w-[calc(100vw_-_40px)] max-h-[min(420px,_65vh)] overflow-y-auto">
                      <div className="menu-label py-1.75 px-2.5 text-[11px] text-muted">
                        Mail accounts
                      </div>
                      <MenuItem onClick={() => go({ view, q: route.q })}>
                        <Inbox size={15} />
                        <span
                          className={cn(
                            'account-menu-label [&_strong]:block [&_strong]:overflow-hidden [&_strong]:text-ellipsis',
                            '[&_strong]:whitespace-nowrap [&_small]:block [&_small]:overflow-hidden [&_small]:text-ellipsis',
                            '[&_small]:whitespace-nowrap [&_strong]:font-medium [&_small]:text-muted [&_small]:text-[10px]',
                            '[&_small]:mt-[2px] flex-1 min-w-0',
                          )}
                        >
                          <strong>All accounts</strong>
                          <small>Unified inbox</small>
                        </span>
                        {!account && (
                          <Check size={14} className="account-menu-check text-primary" />
                        )}
                      </MenuItem>
                      <div className="account-menu-divider h-[1px] m-1.25 bg-border" />
                      {accounts.map((item) => (
                        <MenuItem
                          key={item.id}
                          onClick={() => go({ view, q: route.q, account: item.id })}
                        >
                          <AccountMark account={item} size={28} />
                          <span
                            className={cn(
                              'account-menu-label [&_strong]:block [&_strong]:overflow-hidden [&_strong]:text-ellipsis',
                              '[&_strong]:whitespace-nowrap [&_small]:block [&_small]:overflow-hidden [&_small]:text-ellipsis',
                              '[&_small]:whitespace-nowrap [&_strong]:font-medium [&_small]:text-muted [&_small]:text-[10px]',
                              '[&_small]:mt-[2px] flex-1 min-w-0',
                            )}
                          >
                            <strong>{item.name}</strong>
                            <small>{item.email}</small>
                          </span>
                          {item.id === account?.id && (
                            <Check size={14} className="account-menu-check text-primary" />
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
              <div className="list-heading-actions flex items-center gap-1.25 @max-[680px]/mail:gap-[2px]">
                <IconButton
                  label="Refresh mail"
                  shortcut={keys('refresh')}
                  onClick={() => void refresh()}
                >
                  <RefreshCw
                    size={15}
                    className={cn(
                      mail.isFetching && !mail.isFetchingNextPage && 'spin animate-spin',
                    )}
                  />
                </IconButton>
                <IconButton label="Search mail" shortcut={keys('search')} onClick={focusSearch}>
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
                    <div className="menu-label py-1.75 px-2.5 text-[11px] text-muted">
                      Message density
                    </div>
                    <MenuItem onClick={() => setDensity('comfortable')}>
                      <span className="menu-check w-3.75 inline-flex text-primary">
                        {density === 'comfortable' && <Check size={14} />}
                      </span>
                      Comfortable
                    </MenuItem>
                    <MenuItem onClick={() => setDensity('compact')}>
                      <span className="menu-check w-3.75 inline-flex text-primary">
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
                className={cn(
                  'mail-search mt-0 mb-4 mx-7 flex items-center gap-2.5 border border-solid border-border-strong bg-surface',
                  'py-[3px] pr-2 pl-3.25 rounded-[7px] text-muted [&_input]:border-0 [&_input]:bg-none [&_input]:bg-transparent',
                  '[&_input]:py-1.75 [&_input]:px-0 [&_input]:text-[13px] focus-within:border-primary-solid',
                  'focus-within:shadow-[0_0_0_3px_var(--accent-tint)] [&_input:focus-visible]:outline-none @max-[680px]/mail:ml-5',
                  '@max-[680px]/mail:mr-5',
                )}
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
              <div
                className="active-filters flex flex-wrap items-center gap-1.5 pt-0 pb-3.5 px-7 @max-[680px]/mail:pl-5 @max-[680px]/mail:pr-5"
                aria-label="Active filters"
              >
                {filterChips.map(([key, value]) => (
                  <button
                    key={key}
                    className={cn(
                      'filter-chip [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap inline-flex items-center',
                      'gap-2 max-w-65 py-1 px-2 text-[11px] text-primary border border-solid border-primary/25 bg-primary-tint',
                      'rounded-sm',
                    )}
                    aria-label={'Remove ' + (filterLabels[key] || key) + ' filter'}
                    onClick={() => setFilters((current) => ({ ...current, [key]: undefined }))}
                  >
                    <span>
                      {filterLabels[key] || key}
                      {typeof value === 'string' &&
                        ': ' + (key === 'after' || key === 'before' ? chipDate(value) : value)}
                    </span>
                    <X size={12} />
                  </button>
                ))}
                <button
                  className="clear-filters border-0 bg-none bg-transparent text-muted text-[11px] py-1 px-2 hover:text-foreground"
                  onClick={() => setFilters({})}
                >
                  Clear all
                </button>
              </div>
            )}
            {view !== 'drafts' && (
              <div
                className={cn(
                  'list-toolbar flex items-center gap-4 h-11.5 py-0 px-7 border-b border-solid border-b-border shrink-0',
                  '@max-[900px]/mail:pl-5.5 @max-[900px]/mail:pr-5.5 @max-[680px]/mail:py-0 @max-[680px]/mail:px-5',
                  '@max-[680px]/mail:gap-3.5',
                )}
              >
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
                <div
                  className={cn(
                    'list-tabs flex gap-5 h-full [&_button]:bg-none [&_button]:bg-transparent [&_button]:border-0',
                    '[&_button]:border-b-2 [&_button]:border-solid [&_button]:border-b-transparent [&_button]:py-0',
                    '[&_button]:px-[1px] [&_button]:text-[12px] [&_button]:text-muted [&_button:hover]:text-foreground',
                    '[&_button.active]:text-foreground [&_button.active]:border-b-primary [&_button.active]:font-medium',
                    '@max-[440px]/mail:gap-4',
                  )}
                >
                  <button
                    aria-pressed={!filters.unread}
                    className={cn(!filters.unread && 'active')}
                    onClick={() => setFilters((f) => ({ ...f, unread: undefined }))}
                  >
                    All messages
                  </button>
                  <button
                    aria-pressed={!!filters.unread}
                    className={cn(filters.unread && 'active')}
                    title={
                      'Show only unread conversations' +
                      (keys('toggleUnread') ? ' · ' + keys('toggleUnread') : '')
                    }
                    onClick={() => setFilters((f) => ({ ...f, unread: true }))}
                  >
                    Unread
                  </button>
                </div>
                <div className="list-toolbar-actions flex items-center gap-4.5 ml-auto [&>.button]:font-normal @max-[680px]/mail:gap-2.5">
                  <Button
                    variant="ghost"
                    size="small"
                    title={'Filter conversations' + (keys('filter') ? ' · ' + keys('filter') : '')}
                    onClick={() => setFilterOpen(true)}
                  >
                    <SlidersHorizontal size={13} />
                    Filter
                    {hasFilters && (
                      <span className="filter-dot bg-primary w-1.25 h-1.25 rounded-full" />
                    )}
                  </Button>
                </div>
              </div>
            )}
            {!!selected.size && view !== 'drafts' && (
              <div
                className={cn(
                  'selection-bar absolute z-10 bottom-12.5 left-[50%] transform-[translateX(-50%)] flex items-center gap-1.25',
                  'py-2.5 px-3 max-w-[calc(100%_-_24px)] whitespace-nowrap border border-solid border-border-strong rounded-xl',
                  'bg-raised shadow-[0_8px_28px_#0003,_0_2px_5px_#0002] animate-[selection-appear_140ms_ease-out]',
                  '@max-[440px]/mail:gap-[2px] @max-[440px]/mail:p-2 @max-[440px]/mail:[&_.toolbar-divider]:my-0',
                  '@max-[440px]/mail:[&_.toolbar-divider]:mx-[2px]',
                )}
                role="region"
                aria-label="Selection actions"
              >
                <div className="selection-summary flex flex-col gap-[2px] min-w-20.5 py-0 px-1.5 @max-[440px]/mail:min-w-18.5 @max-[440px]/mail:py-0 @max-[440px]/mail:px-1">
                  <span
                    className="selection-count text-[12px] text-foreground font-medium tabular-nums"
                    role="status"
                  >
                    {selectedCount.toLocaleString()} selected
                  </span>
                  {!allMatching && total > selected.size && (
                    <button
                      className="border-0 bg-none bg-transparent text-primary text-[11px] p-0 text-left hover:underline"
                      disabled={busy}
                      onClick={() => setAllMatching(true)}
                    >
                      Select all {total.toLocaleString()}
                    </button>
                  )}
                </div>
                <span className="toolbar-divider w-[1px] h-4.25 bg-border-strong my-0 mx-1" />
                {offersAction(listView, 'archive') && (
                  <HintIconButton
                    label="Archive selected"
                    shortcut={keys('archive')}
                    disabled={busy}
                    hint={unavailable('archive')}
                    onClick={() => void act('archive')}
                  >
                    <Archive size={16} />
                  </HintIconButton>
                )}
                <IconButton
                  label="Mark selected as read"
                  shortcut={keys('read')}
                  disabled={busy}
                  onClick={() => void act('read')}
                >
                  <MailOpen size={16} />
                </IconButton>
                {offersAction(listView, 'trash') && (
                  <HintIconButton
                    label="Move selected to trash"
                    shortcut={keys('trash')}
                    disabled={busy}
                    hint={unavailable('trash')}
                    onClick={() => void act('trash')}
                  >
                    <Trash2 size={16} />
                  </HintIconButton>
                )}
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
                  <MenuItem onClick={() => void act('unread')}>
                    <Mail size={14} />
                    Mark as unread
                    <ShortcutHint id="unread" className="menu-shortcut ml-auto" />
                  </MenuItem>
                  <MenuItem onClick={() => void act(selectionStarred ? 'unstar' : 'star')}>
                    <Star size={14} />
                    {selectionStarred ? 'Remove star' : 'Star'}
                    <ShortcutHint id="star" className="menu-shortcut ml-auto" />
                  </MenuItem>
                  <MenuItem
                    onClick={() => openMove(targets())}
                    disabled={allMatching || !!unavailable('move')}
                  >
                    <FolderInput size={14} />
                    Move to folder
                    <ShortcutHint id="move" className="menu-shortcut ml-auto" />
                  </MenuItem>
                  {offersAction(listView, 'spam') && (
                    <MenuItem onClick={() => void act('spam')} disabled={!!unavailable('spam')}>
                      <ShieldX size={14} />
                      Mark as spam
                      <ShortcutHint id="spam" className="menu-shortcut ml-auto" />
                    </MenuItem>
                  )}
                  {offersAction(listView, 'notSpam') && (
                    <MenuItem
                      onClick={() => void act('notSpam')}
                      disabled={!!unavailable('notSpam')}
                    >
                      <ShieldCheck size={14} />
                      Not spam
                      <ShortcutHint id="notSpam" className="menu-shortcut ml-auto" />
                    </MenuItem>
                  )}
                  {offersAction(listView, 'restore') && (
                    <MenuItem
                      onClick={() => void act('restore')}
                      disabled={!!unavailable('restore')}
                    >
                      <Inbox size={14} />
                      Restore to inbox
                      <ShortcutHint id="restore" className="menu-shortcut ml-auto" />
                    </MenuItem>
                  )}
                  {offersAction(listView, 'destroy') && (
                    <MenuItem
                      danger
                      onClick={() => void act('destroy')}
                      disabled={!!unavailable('destroy')}
                    >
                      <Trash2 size={14} />
                      Delete permanently
                    </MenuItem>
                  )}
                  {[
                    ...new Set([
                      unavailable('move'),
                      offersAction(listView, 'destroy') && unavailable('destroy'),
                    ]),
                  ]
                    .filter(Boolean)
                    .map((reason) => (
                      <p
                        className="menu-note max-w-60 mt-1 mb-0 mx-0 pt-1.75 pb-1.25 px-2.5 border-t border-solid border-t-border text-[11px] leading-[1.5] text-muted"
                        key={String(reason)}
                      >
                        {reason}
                      </p>
                    ))}
                </Dropdown>
                <span className="toolbar-divider w-[1px] h-4.25 bg-border-strong my-0 mx-1" />
                <IconButton
                  label="Clear selection"
                  shortcut={keys('back')}
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
              <div
                className={cn(
                  'connection-banner [&_button]:ml-auto [&_button]:border-0 [&_button]:bg-none [&_button]:bg-transparent',
                  '[&_button]:text-primary py-2.25 px-7.5 text-[11px] flex items-center gap-2.25 text-secondary bg-primary-tint',
                )}
              >
                <WifiOff size={13} />
                {mail.isError
                  ? friendlyError(mail.error)
                  : 'Some accounts are unavailable. Showing mail from connected accounts.'}
                <button onClick={() => void refresh()}>Retry</button>
              </div>
            )}
            {!!incomplete.length && view !== 'drafts' && (
              <div
                className={cn(
                  'indexing-notice flex flex-wrap items-center justify-between gap-[4px_14px] py-2 px-7 border-b border-solid',
                  'border-b-border text-[11px] text-muted @max-[680px]/mail:pl-5 @max-[680px]/mail:pr-5',
                )}
                role="status"
              >
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
              <div className="draft-list flex-1 overflow-auto">
                <SubmissionList
                  submissions={pendingSends.filter(
                    (s) => !route.account || s.accountId === route.account,
                  )}
                  accounts={accounts}
                  onOpenDraft={setComposer}
                  notify={notify}
                />
                {!!pendingSends.length && !!draftItems.length && (
                  <h2 className="draft-section-label m-0 pt-4.5 pb-1.5 px-8 text-[11px] font-medium text-muted @max-[680px]/mail:pl-5 @max-[680px]/mail:pr-5">
                    Drafts
                  </h2>
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
                  <div className="load-more flex items-center justify-center gap-2 text-[12px] text-muted p-3.75">
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
              <div
                className={cn(
                  'mail-list flex-1 overflow-auto min-h-0 outline-none [overflow-anchor:none] [scrollbar-gutter:stable] pb-4',
                  'focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong)] focus-visible:rounded-none [&:has(.selected)]:pb-22',
                  '[&:has(.selected)_.row-selector_.checkbox]:opacity-100 [&:has(.selected)_.unread-dot]:opacity-0 list-skeleton',
                  '[&_.skeleton-row:nth-child(n+6)]:opacity-60 [&_.skeleton-row:nth-child(n+8)]:opacity-30',
                )}
                aria-busy="true"
                aria-label="Loading mail"
              >
                {Array.from({ length: 9 }, (_, i) => (
                  <div
                    className={cn(
                      'mail-row flex items-center h-[var(--row-height)] py-0 pr-5 pl-7 gap-4 border-b border-solid border-b-border',
                      'text-[13px] relative [&.unread]:bg-[color-mix(in_srgb,_var(--surface)_32%,_var(--bg))]',
                      '[&.focused]:shadow-[inset_2px_0_var(--accent)] [&.focused]:bg-selected [&.selected]:bg-selected',
                      '[&:hover_.row-selector_.checkbox]:opacity-100 [&.selected_.row-selector_.checkbox]:opacity-100',
                      '[&:hover_.unread-dot]:opacity-0 [&.selected_.unread-dot]:opacity-0 [&:hover_.row-star]:opacity-100',
                      '[&:focus-within_.row-star]:opacity-100 [&:hover_.row-quick-actions]:opacity-100',
                      '[&:hover_.row-quick-actions]:pointer-events-auto [&:focus-within_.row-quick-actions]:opacity-100',
                      '[&:focus-within_.row-quick-actions]:pointer-events-auto @max-[900px]/mail:gap-3 @max-[900px]/mail:pl-5.5',
                      '@max-[900px]/mail:pr-3.5 @max-[680px]/mail:py-0 @max-[680px]/mail:pr-4 @max-[680px]/mail:pl-5',
                      '@max-[680px]/mail:gap-3 @max-[680px]/mail:[.density-comfortable_&]:grid',
                      '@max-[680px]/mail:[.density-comfortable_&]:grid-cols-[16px_minmax(0,_1fr)_auto]',
                      '@max-[680px]/mail:[.density-comfortable_&]:grid-rows-[22px_20px]',
                      '@max-[680px]/mail:[.density-comfortable_&]:gap-[2px_12px]',
                      '@max-[680px]/mail:[.density-comfortable_&]:content-center skeleton-row cursor-default pointer-events-none',
                      'hover:bg-none hover:bg-transparent [&>.skeleton-line:first-of-type]:shrink-0',
                      '[&>.skeleton-line:first-of-type]:w-30 [&_.row-content]:gap-2.25',
                      '[.density-compact_&_.skeleton-line.faint]:hidden',
                    )}
                    key={i}
                  >
                    <span
                      className={cn(
                        'row-selector relative w-4 shrink-0 h-6 flex items-center justify-center [&_.checkbox]:absolute',
                        '[&_.checkbox]:opacity-0 [&:focus-within_.checkbox]:opacity-100 [&:focus-within_.unread-dot]:opacity-0',
                        '@max-[680px]/mail:[.density-comfortable_&]:col-start-1 @max-[680px]/mail:[.density-comfortable_&]:row-start-1',
                        '@max-[680px]/mail:[.density-comfortable_&]:row-end-3',
                      )}
                    />
                    <span
                      className={cn(
                        'skeleton-avatar block',
                        'bg-[linear-gradient(_90deg,_var(--skeleton)_0%,_color-mix(in_srgb,_var(--skeleton)_45%,_transparent)_50%,_var(--skeleton)_100%_)]',
                        '[background-size:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] w-7 h-7 rounded-[7px] shrink-0 -mr-1.5',
                      )}
                    />
                    <span
                      className={cn(
                        'skeleton-line block h-2.5 rounded-sm',
                        'bg-[linear-gradient(_90deg,_var(--skeleton)_0%,_color-mix(in_srgb,_var(--skeleton)_45%,_transparent)_50%,_var(--skeleton)_100%_)]',
                        '[background-size:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] [&.faint]:opacity-55',
                      )}
                      style={{ width: 120 + ((i * 37) % 50) }}
                    />
                    <span
                      className={cn(
                        'row-content flex-1 min-w-0 flex flex-col gap-[3px] overflow-hidden whitespace-nowrap',
                        '[.density-compact_&]:flex-row [.density-compact_&]:gap-3 [.density-compact_&]:items-baseline',
                        '@max-[680px]/mail:[.density-comfortable_&]:col-start-2 @max-[680px]/mail:[.density-comfortable_&]:col-end-4',
                        '@max-[680px]/mail:[.density-comfortable_&]:row-start-2 @max-[680px]/mail:[.density-comfortable_&]:flex-row',
                        '@max-[680px]/mail:[.density-comfortable_&]:gap-2.5 @max-[680px]/mail:[.density-comfortable_&]:items-baseline',
                      )}
                    >
                      <span
                        className={cn(
                          'skeleton-line block h-2.5 rounded-sm',
                          'bg-[linear-gradient(_90deg,_var(--skeleton)_0%,_color-mix(in_srgb,_var(--skeleton)_45%,_transparent)_50%,_var(--skeleton)_100%_)]',
                          '[background-size:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] [&.faint]:opacity-55',
                        )}
                        style={{ width: 40 + ((i * 23) % 35) + '%' }}
                      />
                      <span
                        className={cn(
                          'skeleton-line block h-2.5 rounded-sm',
                          'bg-[linear-gradient(_90deg,_var(--skeleton)_0%,_color-mix(in_srgb,_var(--skeleton)_45%,_transparent)_50%,_var(--skeleton)_100%_)]',
                          '[background-size:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] [&.faint]:opacity-55 faint',
                        )}
                        style={{ width: 55 + ((i * 17) % 30) + '%' }}
                      />
                    </span>
                    <span
                      className={cn(
                        'skeleton-line block h-2.5 rounded-sm',
                        'bg-[linear-gradient(_90deg,_var(--skeleton)_0%,_color-mix(in_srgb,_var(--skeleton)_45%,_transparent)_50%,_var(--skeleton)_100%_)]',
                        '[background-size:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] [&.faint]:opacity-55',
                      )}
                      style={{ width: 44 }}
                    />
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
                    keys,
                  })}
                >
                  {hasSearchFilters && (
                    <Button onClick={() => setFilters({})}>Clear filters</Button>
                  )}
                  {view === 'inbox' && !route.q && !hasFilters && keys('compose') && (
                    <span className="empty-hint inline-flex items-center gap-2 text-[12px] text-faint">
                      <ShortcutHint id="compose" /> Write a message
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
                view={listView}
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
            <footer
              className={cn(
                'list-footer flex items-center justify-between border-t border-solid border-t-border min-h-8.25 py-0 px-6',
                'text-muted text-[10px] gap-4 [&>span]:flex [&>span]:items-center [&>span]:gap-1.5 [&_kbd]:h-4.25',
                '[&_kbd]:min-w-4.25 [&_kbd]:py-0 [&_kbd]:px-[3px] [&_kbd]:text-[9px] @max-[900px]/mail:py-0',
                '@max-[900px]/mail:px-5',
              )}
            >
              <span role="status">
                {busy ? (
                  <>
                    <Spinner size={11} />
                    {progress || 'Updating…'}
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        'connection-dot w-1.25 h-1.25 rounded-full bg-success inline-block shrink-0',
                        accounts.some((a) => a.status !== 'connected') &&
                          'connection-pending bg-danger',
                      )}
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
                className={cn(
                  'footer-shortcuts flex items-center gap-1.5 bg-none bg-transparent border-0 text-muted text-[10px] py-1 px-0',
                  'hover:text-foreground [&>span:not(.shortcut-keys)]:mr-2.25 @max-[900px]/mail:[&_span]:hidden',
                  '@max-[440px]/mail:[&>.shortcut-keys:not(.footer-help-keys)]:hidden',
                )}
                onClick={() => setHelp(true)}
                aria-label="Show keyboard shortcuts"
              >
                <ShortcutHint id="next" />
                <ShortcutHint id="previous" />
                <span>Navigate</span>
                <ShortcutHint id="open" />
                <span>Open</span>
                <ShortcutHint id="shortcuts" className="footer-help-keys" />
                <span>Shortcuts</span>
              </button>
            </footer>
          </>
        )}
      </main>
      {toast && (
        <div
          className={cn(
            'toast fixed bottom-5.75 left-[calc(50%+var(--rail)_/_2_-_4px)] transform-[translateX(-50%)] z-150 flex gap-3.25',
            'items-center max-w-[75vw] bg-raised border border-solid border-border-strong shadow-popup py-2.75 px-3.75',
            'rounded-lg text-[12px] [&>svg]:text-primary [&>span]:max-w-150 [&_button]:border-0 [&_button]:bg-none',
            '[&_button]:bg-transparent [&_button]:text-primary [&_button]:text-[11px] [&_button]:p-[3px]',
            '[&_button:last-child]:text-muted max-[700px]:max-w-[calc(100vw_-_var(--rail)_-_32px)]',
            'max-[700px]:w-[max-content] overflow-hidden animate-[toast-in_180ms_cubic-bezier(0.2,_0.9,_0.3,_1.2)]',
            '[&_.toast-undo]:inline-flex [&_.toast-undo]:items-center [&_.toast-undo]:gap-1.5 [&_.toast-undo]:py-[3px]',
            '[&_.toast-undo]:pr-1 [&_.toast-undo]:pl-2 [&_.toast-undo]:rounded-sm [&_.toast-undo]:font-medium',
            '[&_.toast-undo:hover]:bg-primary-tint [&_.toast-dismiss]:grid [&_.toast-dismiss]:place-items-center',
            '[&_.toast-dismiss]:rounded-sm [&_.toast-dismiss]:text-muted [&_.toast-dismiss:hover]:text-foreground',
            '[&_.toast-dismiss:hover]:bg-hover',
            toast.tone === 'error' &&
              'toast-error [&>svg:first-child]:text-danger [&_.toast-timer]:bg-danger/45',
          )}
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
            <button
              className="toast-undo [&_kbd]:h-4 [&_kbd]:min-w-4 [&_kbd]:text-[9px] [&_kbd]:text-primary [&_kbd]:border-primary/35"
              onClick={() => void undo()}
            >
              Undo <ShortcutHint id="undo" />
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
              className="toast-timer absolute left-0 bottom-0 h-[2px] w-full bg-primary/45 origin-left animate-[toast-timer_linear_forwards]"
              style={{ animationDuration: toastDuration + 'ms' }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
      <Suspense
        fallback={
          <div
            className={cn(
              'toast fixed bottom-5.75 left-[calc(50%+var(--rail)_/_2_-_4px)] transform-[translateX(-50%)] z-150 flex gap-3.25',
              'items-center max-w-[75vw] bg-raised border border-solid border-border-strong shadow-popup py-2.75 px-3.75',
              'rounded-lg text-[12px] [&>svg]:text-primary [&>span]:max-w-150 [&_button]:border-0 [&_button]:bg-none',
              '[&_button]:bg-transparent [&_button]:text-primary [&_button]:text-[11px] [&_button]:p-[3px]',
              '[&_button:last-child]:text-muted max-[700px]:max-w-[calc(100vw_-_var(--rail)_-_32px)]',
              'max-[700px]:w-[max-content] overflow-hidden animate-[toast-in_180ms_cubic-bezier(0.2,_0.9,_0.3,_1.2)]',
              '[&_.toast-undo]:inline-flex [&_.toast-undo]:items-center [&_.toast-undo]:gap-1.5 [&_.toast-undo]:py-[3px]',
              '[&_.toast-undo]:pr-1 [&_.toast-undo]:pl-2 [&_.toast-undo]:rounded-sm [&_.toast-undo]:font-medium',
              '[&_.toast-undo:hover]:bg-primary-tint [&_.toast-dismiss]:grid [&_.toast-dismiss]:place-items-center',
              '[&_.toast-dismiss]:rounded-sm [&_.toast-dismiss]:text-muted [&_.toast-dismiss:hover]:text-foreground',
              '[&_.toast-dismiss:hover]:bg-hover',
            )}
            role="status"
          >
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
            settings={settings}
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
        count={allMatching ? total : targets().length}
        onClose={() => setConfirmAction(undefined)}
        onConfirm={(action) => {
          setConfirmAction(undefined)
          void act(action, undefined, undefined, true)
        }}
      />
    </div>
  )
}
