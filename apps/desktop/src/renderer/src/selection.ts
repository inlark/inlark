/** Select a visible range while retaining selections outside that range. */
export function selectConversation(
  keys: string[],
  selected: ReadonlySet<string>,
  key: string,
  anchor?: string,
): Set<string> {
  const next = new Set(selected)
  const end = keys.indexOf(key)
  if (end < 0) return next
  const start = anchor ? keys.indexOf(anchor) : -1
  if (start >= 0) {
    for (const item of keys.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(item)
  } else if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
