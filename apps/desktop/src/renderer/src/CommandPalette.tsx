import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, CornerDownLeft, Inbox, Search } from '@inlark/ui/icons'
import { Modal } from '@inlark/ui'
import { Wordmark } from '@inlark/ui/components/wordmark'
import type { Account } from '@inlark/core'
import { AccountMark } from './AccountMark'

export interface Command {
  id: string
  label: string
  group: string
  icon: typeof Inbox
  key?: string
  /** Extra words that should find this command, e.g. “dark” for the theme. */
  keywords?: string
  /** Marks the current choice among alternatives such as themes. */
  checked?: boolean
  /** Shown in place of the icon for account commands. */
  account?: Account
  /** A short explanation below the label, e.g. why the command is unavailable. */
  description?: string
  /** Shown dimmed; running it should explain why rather than act. */
  disabled?: boolean
  run: () => void
}

/**
 * Every typed word must start a word in the label or keywords (or appear inside one, for
 * longer words). Label matches outrank keyword matches, and earlier matches rank higher.
 */
export function rank(command: Pick<Command, 'label' | 'keywords'>, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  const label = command.label.toLowerCase()
  const extra = (command.keywords || '').toLowerCase()
  let score = 0
  for (const word of words) {
    const starts = (text: string) => {
      const at = text.search(
        new RegExp('(^|[\\s/·“-])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )
      return at < 0 ? -1 : at
    }
    const inLabel = starts(label)
    if (inLabel >= 0) score += 100 - Math.min(inLabel, 60)
    else if (starts(extra) >= 0) score += 30
    else if (word.length >= 3 && (label.includes(word) || extra.includes(word))) score += 10
    else return 0
  }
  return score + (label.startsWith(words[0]) ? 50 : 0)
}

export function CommandPalette({
  open,
  onClose,
  onSearch,
  commands,
}: {
  open: boolean
  onClose: () => void
  onSearch: (text: string) => void
  commands: Command[]
}) {
  const [value, setValue] = useState(''),
    [index, setIndex] = useState(0)
  const listId = useId()
  const results = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) {
      setValue('')
      setIndex(0)
    }
  }, [open])
  const query = value.trim()
  const matched = query
    ? commands
        .map((command, order) => ({ command, order, score: rank(command, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((entry) => entry.command)
    : commands
  const options: Command[] = [
    ...matched,
    ...(query
      ? [
          {
            id: 'search',
            group: 'Mail',
            label: 'Search all mail for “' + query + '”',
            icon: Search,
            key: '↵',
            run: () => onSearch(query),
          },
        ]
      : []),
  ]
  const activeIndex = Math.max(0, Math.min(index, options.length - 1))
  useEffect(() => {
    results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, query])
  const run = (i: number) => {
    if (!options[i]) return
    onClose()
    options[i].run()
  }
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Search & commands"
      className="command-modal"
    >
      <div className="command-input">
        <Search size={18} />
        <input
          autoFocus
          placeholder="Type a command or search your mail…"
          value={value}
          aria-label="Search commands or mail"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={options.length ? listId + '-' + activeIndex : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            const step =
              e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
                ? 1
                : e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
                  ? -1
                  : 0
            if (step) {
              e.preventDefault()
              setIndex(options.length ? (activeIndex + step + options.length) % options.length : 0)
            }
            if (e.key === 'Home' && !value) setIndex(0)
            if (e.key === 'End' && !value) setIndex(options.length - 1)
            if (e.key === 'Enter') {
              e.preventDefault()
              run(activeIndex)
            }
          }}
        />
        <button
          className="command-dismiss border-0 bg-none bg-transparent p-0"
          onClick={onClose}
          aria-label="Close search"
        >
          <kbd>Esc</kbd>
        </button>
      </div>
      <div
        className="command-results"
        id={listId}
        role="listbox"
        aria-label="Commands and mail search"
        ref={results}
      >
        {options.map((c, i) => (
          <Fragment key={c.id}>
            {(query ? i === 0 && c.id !== 'search' : options[i - 1]?.group !== c.group) && (
              <div className="command-label" role="presentation">
                {query ? 'Best matches' : c.group}
              </div>
            )}
            {query && c.id === 'search' && i > 0 && (
              <div className="command-label" role="presentation">
                Mail
              </div>
            )}
            <button
              id={listId + '-' + i}
              role="option"
              aria-selected={activeIndex === i}
              aria-disabled={c.disabled || undefined}
              tabIndex={-1}
              className={(activeIndex === i ? 'active' : '') + (c.disabled ? ' unavailable' : '')}
              onMouseMove={() => activeIndex !== i && setIndex(i)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(i)}
            >
              <span className="command-icon">
                {c.account ? <AccountMark account={c.account} size={26} /> : <c.icon size={15} />}
              </span>
              <span className="command-text">
                {c.label}
                {c.description && (
                  <small className="command-description block mt-[2px] text-[11px] text-muted whitespace-normal">
                    {c.description}
                  </small>
                )}
              </span>
              {query && c.id !== 'search' && (
                <span className="command-group text-[11px] text-faint">{c.group}</span>
              )}
              {c.checked && <Check size={14} className="command-check text-primary" />}
              {c.key && (
                <span className="command-keys">
                  {c.key.split(' ').map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              )}
            </button>
          </Fragment>
        ))}
        {!options.length && (
          <div className="command-empty py-5.5 px-3 text-center text-[12px] text-muted">
            No commands
          </div>
        )}
      </div>
      <div className="command-footer border-t border-solid border-t-border py-3 px-5.25 flex gap-2 items-center text-[11px] text-muted">
        <kbd>
          <ArrowUp size={11} />
        </kbd>
        <kbd>
          <ArrowDown size={11} />
        </kbd>{' '}
        Navigate
        <span className="command-enter flex items-center gap-1.75 ml-3">
          <kbd>
            <CornerDownLeft size={11} />
          </kbd>{' '}
          Run
        </span>
        <Wordmark className="command-footer-brand ml-auto text-faint" height={12} />
      </div>
    </Modal>
  )
}
