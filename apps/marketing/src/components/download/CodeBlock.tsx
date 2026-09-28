import { useState } from 'react'
import { Check, Copy } from '@inlark/ui/icons'

/** Quoted strings stand out in the Nix snippet and comments recede; everything else stays quiet. */
function highlight(line: string) {
  if (line.startsWith('#')) return <span className="text-ink-3">{line}</span>
  return line.split(/("[^"]*")/g).map((part, i) =>
    part.startsWith('"') ? (
      <span key={i} className="text-dawn">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Shows a confirmation for a moment after something was copied. */
export function useCopied() {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    if (!(await copyText(text))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return [copied, copy] as const
}

export function CodeBlock({
  code,
  shell = true,
  title,
  className = '',
}: {
  code: string
  shell?: boolean
  /** Draws the block as a small terminal window with this title, wrapping long lines. */
  title?: string
  className?: string
}) {
  const [copied, copy] = useCopied()
  // Only the commands are copied, never the prompt or the comments before them.
  const text = shell
    ? code
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
    : code

  const copyButton = (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className={
        'grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink ' +
        (title ? '-mr-1.5 shrink-0' : 'absolute top-2 right-2')
      }
    >
      {copied ? <Check size={15} className="text-leaf" /> : <Copy size={15} />}
    </button>
  )
  const lines = (
    <code>
      {code.split('\n').map((line, i) => {
        const prompt = shell && !line.startsWith('#')
        return (
          // Wrapped commands hang below the prompt, so each command still starts at a $.
          <span
            key={i}
            className={'block ' + (title && prompt ? '-indent-[1.4em] pl-[1.4em]' : '')}
          >
            {prompt && <span className="mr-[0.8em] text-ink-3 select-none">$</span>}
            {line ? highlight(line) : ' '}
          </span>
        )
      })}
    </code>
  )

  return (
    <div
      className={
        'relative flex flex-col overflow-hidden rounded-xl border bg-black/40 light:bg-white ' +
        (title
          ? 'border-line-strong shadow-[0_20px_40px_-20px_#000] light:shadow-[0_20px_40px_-20px_rgb(22_24_36/0.2)] '
          : 'border-line ') +
        className
      }
    >
      {title && (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-ink/[0.025] pl-3 pr-1.5">
          <span className="size-2 rounded-full bg-ink/15" />
          <span className="size-2 rounded-full bg-ink/15" />
          <span className="size-2 rounded-full bg-ink/15" />
          <span className="ml-2 flex-1 truncate font-mono text-[0.68rem] text-ink-3">{title}</span>
          {copyButton}
        </div>
      )}
      <pre
        className={
          'flex-1 py-3.5 font-mono text-[0.76rem] leading-[1.8] text-ink ' +
          (title
            ? 'px-4 whitespace-pre-wrap [overflow-wrap:anywhere]'
            : 'overflow-x-auto pr-12 pl-4')
        }
      >
        {lines}
      </pre>
      {!title && copyButton}
      <span className="sr-only" role="status">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  )
}
