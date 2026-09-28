import { useSyncExternalStore } from 'react'

const subscribe = (callback: () => void) => {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
const snapshot = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

/** The theme actually applied to the document, after resolving “System”. */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, snapshot, () => 'dark')
}

/** Reads the current value of a theme token such as `--text`. */
export const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
