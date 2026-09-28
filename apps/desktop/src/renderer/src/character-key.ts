import { useEffect, useRef } from 'react'

const typing = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable)

/**
 * Binds a shortcut to the character a key produces rather than its position, so `?`, `#` and
 * `!` work on every keyboard layout whether or not they need Shift.
 */
export function useCharacterKey(characters: string, handler: () => void, enabled = true) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!enabled) return
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !characters.includes(event.key) ||
        typing(document.activeElement)
      )
        return
      event.preventDefault()
      latest.current()
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [characters, enabled])
}
