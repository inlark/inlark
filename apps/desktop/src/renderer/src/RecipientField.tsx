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
    <div className="compose-field recipient-field" onClick={() => input.current?.focus()}>
      <label htmlFor={id}>{label}</label>
      <div className="recipient-chips">
        {chips.map((chip, i) => (
          <span
            key={chip.email + i}
            className={'recipient-chip' + (valid(chip.email) ? '' : ' invalid')}
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
        <div className="recipient-suggestions" role="listbox" id={listId}>
          {matches.map((match, i) => (
            <button
              type="button"
              key={match.email}
              id={listId + '-' + i}
              role="option"
              aria-selected={i === highlighted}
              className={i === highlighted ? 'active' : ''}
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
