/**
 * Where a step of `delta` from `current` lands in a list of `count`, staying inside it. With
 * nothing current (`-1`) any step lands on the first item, and at either end a step outward
 * lands where it started.
 */
export const stepIndex = (count: number, current: number, delta: number) =>
  Math.max(0, Math.min(count - 1, current + delta))

/**
 * Where focus goes when `removed` conversations leave a list of `keys`. Focus on a conversation
 * that stays, stays. Focus on one that leaves moves to the nearest one left in `direction`, or the
 * other way at the end of the list, so the user carries on from where they were rather than from
 * the top. Nothing is left to focus when every conversation left.
 */
export function focusAfterRemoval(
  keys: readonly string[],
  removed: ReadonlySet<string>,
  current: string,
  direction: 'next' | 'previous',
): string | undefined {
  if (!removed.has(current)) return current
  const index = keys.indexOf(current)
  if (index < 0) return undefined
  const after = keys.slice(index + 1).find((key) => !removed.has(key))
  const before = keys
    .slice(0, index)
    .reverse()
    .find((key) => !removed.has(key))
  return direction === 'next' ? (after ?? before) : (before ?? after)
}

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
