import { useRef, useState, type KeyboardEvent } from 'react'
import { Check, Copy } from '@inlark/ui/icons'

interface Method {
  id: string
  label: string
  note: string
  code: string
  shell: boolean
}

const methods = (version: string): Method[] => [
  {
    id: 'nix',
    label: 'Nix',
    note: 'Installs the launcher, desktop entry, icon and mailto: handler into your profile.',
    code: `nix profile install 'github:inlark/inlark/v${version}#inlark'`,
    shell: true,
  },
  {
    id: 'nixos',
    label: 'NixOS',
    note: 'Add Inlark as a flake input, then enable its module in your system configuration.',
    code: `# flake.nix
inputs.inlark.url = "github:inlark/inlark/v${version}";

# modules of your nixosSystem
inlark.nixosModules.default
{ programs.inlark.enable = true; }`,
    shell: false,
  },
  {
    id: 'appimage',
    label: 'AppImage',
    note: 'Download the AppImage from the latest release, then run it. No installation needed.',
    code: `chmod +x Inlark-${version}-x86_64.AppImage\n./Inlark-${version}-x86_64.AppImage`,
    shell: true,
  },
  {
    id: 'deb',
    label: 'Debian · Ubuntu',
    note: 'Download the .deb from the latest release and install it with apt.',
    code: `sudo apt install ./Inlark-${version}-amd64.deb`,
    shell: true,
  },
  {
    id: 'rpm',
    label: 'Fedora',
    note: 'Download the .rpm from the latest release and install it with dnf.',
    code: `sudo dnf install ./Inlark-${version}-x86_64.rpm`,
    shell: true,
  },
]

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

export function Install({ version, releases }: { version: string; releases: string }) {
  const list = methods(version)
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const method = list[active]

  const select = (index: number) => {
    setActive(index)
    setCopied(false)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : -1
    if (!delta && edge < 0) return
    event.preventDefault()
    const next = edge >= 0 ? edge : (active + delta + list.length) % list.length
    select(next)
    tabs.current[next]?.focus()
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(method.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div
        role="tablist"
        aria-label="Installation method"
        className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3"
        onKeyDown={onKeyDown}
      >
        {list.map((m, i) => (
          <button
            key={m.id}
            ref={(el) => {
              tabs.current[i] = el
            }}
            role="tab"
            id={'install-tab-' + m.id}
            aria-selected={i === active}
            aria-controls="install-panel"
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
            className={
              'relative shrink-0 rounded-t-lg px-3.5 pt-2 pb-3 text-sm whitespace-nowrap transition-colors ' +
              (i === active
                ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-lavender'
                : 'text-ink-3 hover:text-ink-2')
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <div
        id="install-panel"
        role="tabpanel"
        aria-labelledby={'install-tab-' + method.id}
        className="p-5 sm:p-6"
      >
        <p className="text-[0.95rem] leading-relaxed text-ink-2">
          {method.note}{' '}
          {!method.id.startsWith('nix') && (
            <a href={releases} className="text-lavender underline-offset-4 hover:underline">
              Open releases ↗
            </a>
          )}
        </p>
        <div className="relative mt-4 rounded-xl border border-line bg-black/40">
          <pre className="min-h-[11.5rem] overflow-x-auto p-4 pr-14 font-mono text-[0.8rem] leading-[1.75] text-ink">
            <code>
              {method.code.split('\n').map((line, i) => (
                <span key={i} className="block">
                  {method.shell && <span className="mr-3 text-ink-3 select-none">$</span>}
                  {method.shell ? line : line ? highlight(line) : ' '}
                </span>
              ))}
              {method.shell && (
                <span className="block select-none" aria-hidden="true">
                  <span className="mr-3 text-ink-3">$</span>
                  <span className="terminal-caret" />
                </span>
              )}
            </code>
          </pre>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copied' : 'Copy to clipboard'}
            className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            {copied ? <Check size={15} className="text-leaf" /> : <Copy size={15} />}
          </button>
          <span className="sr-only" role="status">
            {copied ? 'Copied to clipboard' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
