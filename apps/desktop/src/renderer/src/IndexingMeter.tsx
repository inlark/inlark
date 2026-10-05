import type { IndexingProgress } from '@inlark/core'

/** “Indexing mail · 12,340 of 50,000” with a slim bar; quiet, since indexing needs no action. */
export function IndexingMeter({
  indexing,
  label = 'Indexing mail',
}: {
  indexing: IndexingProgress
  label?: string
}) {
  const total = Math.max(indexing.total, indexing.indexed)
  const ratio = total ? indexing.indexed / total : 0
  return (
    <span className="indexing-meter inline-flex items-center gap-2.5 tabular-nums">
      <span>
        {label} · {indexing.indexed.toLocaleString()} of {total.toLocaleString()}
      </span>
      <span
        className="indexing-bar relative w-18 h-[3px] shrink-0 rounded-[2px] bg-border-strong overflow-hidden"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={indexing.indexed}
      >
        <span style={{ width: Math.round(ratio * 100) + '%' }} />
      </span>
    </span>
  )
}
