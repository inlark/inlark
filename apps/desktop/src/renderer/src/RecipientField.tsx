import { cn } from '@inlark/ui'
import { useId, useRef, useState, type ReactNode } from 'react'
import { X } from '@inlark/ui/icons'
import { parseAddresses, type Address } from '@inlark/core'
import { Avatar } from '@inlark/ui'

const valid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const same = (a: Address, b: Address) => a.email.toLowerCase() === b.email.toLowerCase()
const format = (a: Address) => (a.name ? a.name + ' <' + a.email + '>' : a.email)

/**
 * Recipients as removable chips with keyboard autocomplete. Text that has been typed but not yet
 * committed is still reported, so autosave and sending never lose an address.
 */
export function RecipientField({
  id,
  label,
  defaultValue,
  suggestions,
  disabled,
  autoFocus,
  placeholder,
  onChange,
  children,
}: {
  id: string
  label: string
  defaultValue: Address[]
  suggestions: Address[]
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
  onChange: (addresses: Address[]) => void
  children?: ReactNode
}) {
  const [chips, setChips] = useState(defaultValue)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const set = (nextChips: Address[], nextText: string) => {
    setChips(nextChips)
    setText(nextText)
    onChange([...nextChips, ...parseAddresses(nextText)])
  }
  const add = (addresses: Address[]) => {
    const next = [...chips]
    for (const address of addresses) if (!next.some((c) => same(c, address))) next.push(address)
    set(next, '')
    setOpen(false)
  }
  const commit = () => {
    const parsed = parseAddresses(text)
    if (parsed.length) add(parsed)
    return parsed.length > 0
  }
  const query = text.trim().toLowerCase()
  const matches = query
    ? suggestions
        .filter(
          (a) =>
            !chips.some((c) => same(c, a)) &&
            ((a.name || '')
              .toLowerCase()
              .split(/\s+/)
              .some((word) => word.startsWith(query)) ||
              a.email.toLowerCase().startsWith(query) ||
              (query.length > 2 && (a.name + ' ' + a.email).toLowerCase().includes(query))),
        )
        .slice(0, 6)
    : []
  const showing = open && matches.length > 0
  const highlighted = Math.min(active, matches.length - 1)
  return (
    <div
      className={cn(
        'compose-field flex items-center min-h-10.5 border-b border-solid border-b-border gap-2.75 [&>label]:w-10.75',
        '[&>label]:shrink-0 [&>label]:text-[11px] [&>label]:text-muted [&>span]:w-10.75 [&>span]:shrink-0',
        '[&>span]:text-[11px] [&>span]:text-muted [&_input]:flex-1 [&_input]:border-0 [&_input]:py-1.75 [&_input]:px-0',
        '[&_input]:bg-none [&_input]:bg-transparent [&_input]:text-[12px] [&_input]:min-w-0 [&>.select-trigger]:flex-1',
        '[&>.select-trigger]:h-8 [&>.select-trigger]:py-0 [&>.select-trigger]:pr-1 [&>.select-trigger]:pl-0',
        '[&>.select-trigger]:border-0 [&>.select-trigger]:bg-none [&>.select-trigger]:bg-transparent',
        '[&>.select-trigger]:text-foreground [&>.select-trigger]:text-[12px] [&>.select-trigger]:whitespace-normal',
        '[&>.select-trigger:hover:not([data-disabled])]:bg-none',
        '[&>.select-trigger:hover:not([data-disabled])]:bg-transparent [&>button]:text-[11px] [&>button]:bg-none',
        '[&>button]:bg-transparent [&>button]:border-0 [&>button]:text-muted [&>button]:whitespace-nowrap',
        '[&_.subject-input]:font-medium [&_input:focus-visible]:outline-none',
        '[&>.select-trigger:focus-visible]:outline-none focus-within:border-b-primary-solid',
        '[&>.compose-cc-toggle]:self-start [&>.compose-cc-toggle]:mt-2.25 [&>.compose-cc-toggle]:py-0',
        '[&>.compose-cc-toggle]:px-[2px] [&>.compose-cc-toggle:hover]:text-foreground recipient-field relative',
        'cursor-text py-1 px-0',
      )}
      onClick={() => input.current?.focus()}
    >
      <label htmlFor={id}>{label}</label>
      <div className="recipient-chips [&_input]:flex-1 [&_input]:min-w-30 [&_input]:py-1.25 [&_input]:px-0 flex-1 min-w-0 flex flex-wrap items-center gap-1">
        {chips.map((chip, i) => (
          <span
            key={chip.email + i}
            className={cn(
              'recipient-chip inline-flex items-center gap-[3px] h-6 max-w-65 py-0 pr-1 pl-2 overflow-hidden text-[12px]',
              'whitespace-nowrap text-ellipsis text-foreground bg-hover border border-solid border-border-strong rounded-2xl',
              'cursor-default [&.invalid]:text-danger [&.invalid]:border-danger/45 [&.invalid]:bg-danger/8 [&_button]:grid',
              '[&_button]:place-items-center [&_button]:w-4 [&_button]:h-4 [&_button]:p-0 [&_button]:border-0',
              '[&_button]:rounded-full [&_button]:bg-none [&_button]:bg-transparent [&_button]:text-muted',
              '[&_button:hover]:text-strong [&_button:hover]:bg-border-strong',
              valid(chip.email) ? '' : ' invalid',
            )}
            title={valid(chip.email) ? chip.email : chip.email + ' is not a valid address'}
            onDoubleClick={() => {
              if (disabled) return
              set(
                chips.filter((_, index) => index !== i),
                format(chip),
              )
              input.current?.focus()
            }}
          >
            {chip.name || chip.email}
            {!disabled && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={'Remove ' + (chip.name || chip.email)}
                onClick={(event) => {
                  event.stopPropagation()
                  set(
                    chips.filter((_, index) => index !== i),
                    text,
                  )
                }}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={input}
          id={id}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={chips.length ? '' : placeholder}
          value={text}
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing ? listId + '-' + highlighted : undefined}
          onChange={(event) => {
            set(chips, event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onBlur={() => {
            commit()
            setOpen(false)
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text')
            if (/[,;\n]/.test(pasted)) {
              event.preventDefault()
              add(parseAddresses(text + pasted.replace(/\n/g, ',')))
            }
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (showing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((highlighted + step + matches.length) % matches.length)
            } else if ((event.key === 'Enter' || event.key === 'Tab') && showing) {
              event.preventDefault()
              add([matches[highlighted]])
            } else if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
              if (text.trim()) {
                event.preventDefault()
                commit()
              }
            } else if (event.key === 'Tab' && text.trim()) {
              commit()
            } else if (event.key === 'Backspace' && !text && chips.length) {
              event.preventDefault()
              const last = chips[chips.length - 1]
              set(chips.slice(0, -1), format(last))
            } else if (event.key === 'Escape' && showing) {
              event.stopPropagation()
              event.preventDefault()
              setOpen(false)
            }
          }}
        />
      </div>
      {children}
      {showing && (
        <div
          className={cn(
            'recipient-suggestions [&_button]:flex [&_button]:items-center [&_button]:gap-2.5 [&_button]:w-full',
            '[&_button]:py-1.5 [&_button]:px-2 [&_button]:text-left [&_button]:border-0 [&_button]:rounded-sm',
            '[&_button]:bg-none [&_button]:bg-transparent [&_button.active]:bg-hover [&_span:not(.avatar)]:min-w-0',
            '[&_strong]:block [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap',
            '[&_small]:block [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap',
            '[&_strong]:text-[12px] [&_strong]:font-medium [&_small]:text-[11px] [&_small]:text-muted absolute z-5',
            'top-[calc(100%+4px)] left-10.75 w-[min(360px,_calc(100%_-_43px))] p-1 bg-raised border border-solid',
            'border-border-strong rounded-lg shadow-popup',
          )}
          role="listbox"
          id={listId}
        >
          {matches.map((match, i) => (
            <button
              type="button"
              key={match.email}
              id={listId + '-' + i}
              role="option"
              aria-selected={i === highlighted}
              className={cn(i === highlighted && 'active')}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => {
                add([match])
                input.current?.focus()
              }}
            >
              <Avatar name={match.name || match.email} size={24} />
              <span>
                <strong>{match.name || match.email}</strong>
                {match.name && <small>{match.email}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
