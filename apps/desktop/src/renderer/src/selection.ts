/**
 * Where a step of `delta` from `current` lands in a list of `count`, staying inside it. With
 * nothing current (`-1`) any step lands on the first item, and at either end a step outward
 * lands where it started.
 */
export const stepIndex = (count: number, current: number, delta: number) =>
  Math.max(0, Math.min(count - 1, current + delta))

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
