import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Mail,
  Reply,
  RefreshCw,
  Star,
  Trash2,
} from '@inlark/ui/icons'
import { accountById, inbox, type Conversation } from '../data/mail'
import { AccountMark, MailRow, SenderTile } from './mail/MailRow'

type Command =
  'next' | 'previous' | 'open' | 'close' | 'archive' | 'trash' | 'star' | 'unread' | 'undo'

interface Snapshot {
  items: Conversation[]
  focus: number
  open: boolean
}

interface State extends Snapshot {
  history: Snapshot[]
  toast?: { id: number; text: string; undoable: boolean }
}

const start: State = {
  items: inbox.slice(0, 7).map((c) => ({ ...c })),
  focus: 0,
  open: false,
  history: [],
}

const clamp = (value: number, length: number) => Math.max(0, Math.min(value, length - 1))
const snapshot = ({ items, focus, open }: State): Snapshot => ({ items, focus, open })
const say = (state: State, text: string, undoable = true) => ({
  id: (state.toast?.id ?? 0) + 1,
  text,
  undoable,
})

type Action = Command | 'reset' | { focus: number }

function reduce(state: State, command: Action): State {
  if (typeof command === 'object')
    return { ...state, focus: clamp(command.focus, state.items.length) }
  if (command === 'reset') return { ...start, toast: say(state, 'Demo inbox restored', false) }
  if (command === 'undo') {
    const previous = state.history.at(-1)
    if (!previous) return { ...state, toast: say(state, 'Nothing to undo', false) }
    return { ...previous, history: state.history.slice(0, -1), toast: say(state, 'Undone', false) }
  }
  const current = state.items[state.focus]
  if (!current) return state
  const saved = [...state.history, snapshot(state)].slice(-20)
  const markRead = (items: Conversation[], index: number) =>
    items.map((c, i) => (i === index ? { ...c, unread: false } : c))

  switch (command) {
    case 'next':
    case 'previous': {
      const focus = clamp(state.focus + (command === 'next' ? 1 : -1), state.items.length)
      return { ...state, focus, items: state.open ? markRead(state.items, focus) : state.items }
    }
    case 'open':
      return { ...state, open: true, items: markRead(state.items, state.focus) }
    case 'close':
      return { ...state, open: false }
    case 'archive':
    case 'trash': {
      const items = state.items.filter((_, i) => i !== state.focus)
      const focus = clamp(state.focus, items.length)
      return {
        items: state.open && items.length ? markRead(items, focus) : items,
        focus,
        open: state.open && items.length > 0,
        history: saved,
        toast: say(state, command === 'archive' ? 'Archived' : 'Moved to trash'),
      }
    }
    case 'star': {
      const items = state.items.map((c, i) =>
        i === state.focus ? { ...c, starred: !c.starred } : c,
      )
      return {
        ...state,
        items,
        history: saved,
        toast: say(state, current.starred ? 'Unstarred' : 'Starred'),
      }
    }
    case 'unread': {
      const items = state.items.map((c, i) => (i === state.focus ? { ...c, unread: true } : c))
      return { ...state, items, open: false, history: saved, toast: say(state, 'Marked as unread') }
    }
  }
}

const keymap: Record<string, Command> = {
  j: 'next',
  k: 'previous',
  o: 'open',
  enter: 'open',
  escape: 'close',
  e: 'archive',
  '#': 'trash',
  s: 'star',
  u: 'unread',
  z: 'undo',
}

const legend: {
  title: string
  keys: { command: Command; key: string; label: string; short: string }[]
}[] = [
  {
    title: 'Move',
    keys: [
      { command: 'next', key: 'J', label: 'Next conversation', short: 'Next' },
      { command: 'previous', key: 'K', label: 'Previous conversation', short: 'Previous' },
      { command: 'open', key: '↵', label: 'Open', short: 'Open' },
      { command: 'close', key: 'Esc', label: 'Back to the list', short: 'Back' },
    ],
  },
  {
    title: 'Triage',
    keys: [
      { command: 'archive', key: 'E', label: 'Archive', short: 'Archive' },
      { command: 'trash', key: '#', label: 'Move to trash', short: 'Trash' },
      { command: 'star', key: 'S', label: 'Star or unstar', short: 'Star' },
      { command: 'unread', key: 'U', label: 'Mark as unread', short: 'Unread' },
      { command: 'undo', key: 'Z', label: 'Undo', short: 'Undo' },
    ],
  },
]

export function KeyboardDemo() {
  const [state, dispatch] = useReducer(reduce, start)
  const [pressed, setPressed] = useState<Command>()
  const [leaving, setLeaving] = useState<string>()
  const [visible, setVisible] = useState(false)
  const [touched, setTouched] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const latest = useRef(state)
  latest.current = state
  const pending = useRef<{ timer: number; command: Command }>(undefined)

  // A row being archived finishes leaving before the next key applies, so fast typing is never lost.
  const settle = () => {
    if (!pending.current) return
    window.clearTimeout(pending.current.timer)
    dispatch(pending.current.command)
    pending.current = undefined
    setLeaving(undefined)
  }

  const run = (command: Command) => {
    setTouched(true)
    setPressed(command)
    window.setTimeout(() => setPressed((p) => (p === command ? undefined : p)), 180)
    const wasPending = !!pending.current
    settle()
    const current = latest.current.items[latest.current.focus]
    // Let the row slide away before the list closes the gap.
    if (
      (command === 'archive' || command === 'trash') &&
      current &&
      !latest.current.open &&
      !wasPending
    ) {
      setLeaving(current.id)
      pending.current = { command, timer: window.setTimeout(settle, 190) }
      return
    }
    dispatch(command)
  }

  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.45,
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      const inside = !!root.current?.contains(target)
      if (!visible && !inside) return
      const key = event.key.toLowerCase()
      const command = keymap[key]
      if (!command) return
      // Enter and Escape keep their usual meaning on links and buttons elsewhere on the page.
      if (
        (key === 'enter' || key === 'escape') &&
        target !== document.body &&
        target !== listRef.current
      )
        return
      event.preventDefault()
      run(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  const current = state.items[state.focus]

  return (
    <div ref={root} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
      <div className="demo-frame @container">
        <div className="app h-full">
          <div
            ref={listRef}
            tabIndex={0}
            role="group"
            aria-roledescription="Interactive inbox demo"
            aria-label="Demo inbox. Press J and K to move, Enter to open, E to archive, S to star, Z to undo."
            className="app-main relative h-full rounded-[14px] outline-none"
          >
            {state.open && current ? (
              <Reader
                conversation={current}
                position={state.focus + 1}
                total={state.items.length}
              />
            ) : (
              <List
                items={state.items}
                focus={state.focus}
                leaving={leaving}
                onPick={(index) => {
                  setTouched(true)
                  if (index === state.focus) run('open')
                  else dispatch({ focus: index })
                }}
                onReset={() => dispatch('reset')}
              />
            )}
            {!touched && (
              <div className="demo-hint pointer-events-none absolute top-3 right-4 flex items-center gap-2 rounded-full border border-(--border-strong) bg-(--raised) py-1 pr-3 pl-1.5 text-[11.5px] text-(--secondary)">
                <span className="app-kbd text-(--text-strong) pointer-coarse:hidden">J</span>
                <span className="pointer-coarse:hidden">Press J to start</span>
                <span className="hidden pl-1.5 pointer-coarse:inline">Tap a key below to try</span>
              </div>
            )}
            <Toast
              toast={state.toast}
              canUndo={state.history.length > 0}
              onUndo={() => run('undo')}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-7 lg:block lg:pt-2">
        {legend.map((group) => (
          <div key={group.title} className="lg:mb-7">
            <div className="eyebrow mb-3 text-ink-3">{group.title}</div>
            <ul className="flex flex-col gap-1">
              {group.keys.map((item) => (
                <li key={item.command}>
                  <button
                    type="button"
                    onClick={() => run(item.command)}
                    className={
                      'shortcut group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[0.95rem] text-ink-2 transition-colors hover:bg-ink/[0.04] hover:text-ink' +
                      (pressed === item.command ? ' is-pressed' : '')
                    }
                  >
                    <span className="flex min-w-10 sm:min-w-14">
                      <kbd className="kbd text-[0.95rem]">{item.key}</kbd>
                    </span>
                    <span className="sm:hidden">{item.short}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="col-span-2 border-t border-line pt-5 text-sm leading-relaxed text-ink-3 lg:mt-7">
          In the app, <Key>C</Key> composes, <Key>R</Key> <Key>A</Key> <Key>F</Key> reply, reply all
          and forward, <Key>/</Key> searches, <Key>G</Key> <Key>I</Key> goes to the inbox and{' '}
          <Key>Ctrl</Key> <Key>K</Key> finds everything else.
        </p>
      </div>
    </div>
  )
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="kbd mx-px align-[0.1em] text-[0.8rem]">{children}</kbd>
}

function List({
  items,
  focus,
  leaving,
  onPick,
  onReset,
}: {
  items: Conversation[]
  focus: number
  leaving?: string
  onPick: (index: number) => void
  onReset: () => void
}) {
  const unread = items.filter((c) => c.unread).length
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 border-b border-(--border) px-5 py-3.5">
        <h3 className="text-[15px] font-semibold text-(--text-strong)">Inbox</h3>
        <span className="rounded-[5px] border border-(--border-strong) px-1.5 text-[10.5px] text-(--muted)">
          {unread ? unread + ' unread' : 'All read'}
        </span>
        <span className="ml-auto text-(--muted)">
          <RefreshCw size={14} />
        </span>
      </header>
      {items.length ? (
        <div className="flex-1 overflow-hidden">
          {items.map((c, i) => (
            <div
              key={c.id}
              className={'demo-row' + (leaving === c.id ? ' is-leaving' : '')}
              onClick={() => onPick(i)}
            >
              <MailRow conversation={c} focused={i === focus} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-(--surface) text-(--accent)">
              <Mail size={20} />
            </div>
            <p className="text-[15px] font-medium text-(--text-strong)">You’re all caught up</p>
            <p className="mt-1 text-[12px] text-(--muted)">
              Press <span className="app-kbd">Z</span> to undo, or{' '}
              <button type="button" onClick={onReset} className="text-(--accent) hover:underline">
                refill the inbox
              </button>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Reader({
  conversation: c,
  position,
  total,
}: {
  conversation: Conversation
  position: number
  total: number
}) {
  const account = accountById[c.account]
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-(--border) px-4 py-2.5 text-(--muted)">
        <span className="flex items-center gap-1.5 text-[12px] text-(--secondary)">
          <ArrowLeft size={14} /> Inbox <span className="app-kbd ml-1">Esc</span>
        </span>
        <span className="h-4 w-px bg-(--border-strong)" />
        <Archive size={15} />
        <Trash2 size={15} />
        <Star
          size={15}
          className={c.starred ? 'text-(--star)' : ''}
          fill={c.starred ? 'currentColor' : 'none'}
        />
        <span className="ml-auto flex items-center gap-3 text-[11px]">
          {position} of {total}
          <ChevronUp size={14} />
          <ChevronDown size={14} />
        </span>
      </header>
      <article className="demo-reader flex-1 overflow-hidden px-8 pt-6">
        <div className="flex items-center gap-2 text-[11px] text-(--muted)">
          <AccountMark account={account} size={13} /> {account.name}
          <span className="text-(--faint)">·</span> Conversation
        </div>
        <h3 className="mt-2 text-[20px] font-semibold tracking-[-0.01em] text-(--text-strong)">
          {c.subject}
        </h3>
        <div className="mt-5 flex items-center gap-3 border-t border-(--border) pt-5">
          <SenderTile name={c.sender} tint={c.tint} />
          <div className="text-[12.5px]">
            <span className="font-medium text-(--text-strong)">{c.sender}</span>
            <span className="ml-2 text-(--muted)">to {account.email}</span>
          </div>
          <span className="ml-auto text-[11px] text-(--muted)">Today · {c.time}</span>
        </div>
        <div className="mt-4 flex flex-col gap-3 pl-[34px] text-[13px] leading-[1.65] whitespace-pre-line text-(--text)">
          {(c.body ?? [c.preview]).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="mt-6 ml-[34px] flex items-center gap-2.5 rounded-[10px] border border-(--border-strong) bg-(--surface) px-4 py-3 text-[12.5px] text-(--secondary)">
          <Reply size={15} /> Reply to {c.sender.split(' ')[0]}
          <span className="app-kbd ml-auto">R</span>
        </div>
      </article>
    </div>
  )
}

function Toast({
  toast,
  canUndo,
  onUndo,
}: {
  toast?: State['toast']
  canUndo: boolean
  onUndo: () => void
}) {
  const [hidden, setHidden] = useState<number>()
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setHidden(toast.id), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center"
      role="status"
    >
      {toast && hidden !== toast.id && (
        <div
          key={toast.id}
          className="demo-toast pointer-events-auto flex items-center gap-3 rounded-[9px] border border-(--border-strong) bg-(--raised) py-2 pr-2 pl-3.5 text-[12px] text-(--text-strong) shadow-[0_18px_50px_var(--shadow)]"
        >
          {toast.text}
          {toast.undoable && canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-(--accent) hover:bg-(--hover)"
            >
              Undo <span className="app-kbd">Z</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
