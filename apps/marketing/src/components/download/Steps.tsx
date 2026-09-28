import type { CSSProperties, ReactNode } from 'react'
import { Check, Search } from '@inlark/ui/icons'
import { osNames, type Download } from '../../data/release'
import { CodeBlock } from './CodeBlock'
import { AppTile, OsIcon } from './icons'

interface Step {
  title: string
  body: ReactNode
  visual: ReactNode
}

const Name = ({ children }: { children: ReactNode }) => (
  <span className="font-medium text-ink">{children}</span>
)
const Path = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-[0.85em] break-all text-ink">
    {children}
  </code>
)

const connect: Step = {
  title: 'Connect your mail',
  body: 'Enter your address and Inlark looks up your server’s settings, or enter them yourself. Add as many accounts as you like.',
  visual: <ConnectVisual />,
}

function steps({ build, file }: Download, version: string): Step[] {
  switch (build.id) {
    case 'mac-arm64':
    case 'mac-x64':
      return [
        {
          title: 'Move it to Applications',
          body: (
            <>
              Open <Path>{file}</Path> from your Downloads, then drag Inlark onto the Applications
              folder.
            </>
          ),
          visual: <DragVisual />,
        },
        {
          title: 'Allow it to open',
          body: (
            <>
              Inlark isn’t notarized by Apple yet, so macOS stops it the first time. Go to{' '}
              <Name>System Settings → Privacy & Security</Name> and choose <Name>Open Anyway</Name>.
            </>
          ),
          visual: <GatekeeperVisual />,
        },
        connect,
      ]
    case 'windows':
      return [
        {
          title: 'Run the installer',
          body: (
            <>
              Open <Path>{file}</Path> from your Downloads. It installs Inlark for your account, no
              administrator needed.
            </>
          ),
          visual: <DownloadsVisual file={file!} />,
        },
        {
          title: 'Get past SmartScreen',
          body: (
            <>
              The installer isn’t code-signed yet, so Windows may hold it back. Choose{' '}
              <Name>More info</Name>, then <Name>Run anyway</Name>.
            </>
          ),
          visual: <SmartScreenVisual />,
        },
        connect,
      ]
    case 'appimage':
      return [
        {
          title: 'Make it executable',
          body: 'An AppImage runs without installing anything. Allow it to run once.',
          visual: (
            <CodeBlock
              code={`cd ~/Downloads\nchmod +x ${file}`}
              title="Terminal"
              className="h-full"
            />
          ),
        },
        {
          title: 'Start Inlark',
          body: (
            <>
              Double-click it or run it from a terminal. If nothing happens, your system may need
              FUSE 2: on Ubuntu, install <Path>libfuse2t64</Path>.
            </>
          ),
          visual: <CodeBlock code={`./${file}`} title="Terminal" className="h-full" />,
        },
        connect,
      ]
    case 'deb':
    case 'rpm': {
      const tool = build.id === 'deb' ? 'apt' : 'dnf'
      return [
        {
          title: 'Install the package',
          body: `Install it with ${tool}, or open the file in your software center.`,
          visual: (
            <CodeBlock
              code={`cd ~/Downloads\nsudo ${tool} install ./${file}`}
              title="Terminal"
              className="h-full"
            />
          ),
        },
        {
          title: 'Open Inlark',
          body: (
            <>
              Find it in your app menu, or run <Path>inlark</Path>. It also becomes a handler for
              mailto: links.
            </>
          ),
          visual: <LauncherVisual />,
        },
        connect,
      ]
    }
    case 'nix':
      return [
        {
          title: 'Install from the flake',
          body: 'Adds the launcher, desktop entry, icon and mailto: handler to your profile. Needs flakes enabled.',
          visual: (
            <CodeBlock
              code={`nix profile install 'github:inlark/inlark/v${version}#inlark'`}
              title="Terminal"
              className="h-full"
            />
          ),
        },
        {
          title: 'Open Inlark',
          body: (
            <>
              Find it in your app menu, or run <Path>inlark</Path>.
            </>
          ),
          visual: <LauncherVisual />,
        },
        connect,
      ]
    case 'nixos':
      return [
        {
          title: 'Add the flake',
          body: 'Add Inlark as an input, then enable its module in your system configuration.',
          visual: (
            <CodeBlock
              code={`# flake.nix\ninputs.inlark.url = "github:inlark/inlark/v${version}";\n\n# modules of your nixosSystem\ninlark.nixosModules.default\n{ programs.inlark.enable = true; }`}
              shell={false}
              title="Configuration"
              className="h-full"
            />
          ),
        },
        {
          title: 'Switch to it',
          body: 'Rebuild your system and Inlark appears in your app menu.',
          visual: (
            <CodeBlock code="sudo nixos-rebuild switch" title="Terminal" className="h-full" />
          ),
        },
        connect,
      ]
  }
}

export function Steps({ download, version }: { download: Download; version: string }) {
  const list = steps(download, version)
  const os = download.build.os
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Next</p>
          <h2 className="display mt-4 text-[clamp(2rem,4.2vw,3rem)]">
            Up and running in a minute.
          </h2>
        </div>
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <OsIcon os={os} size={16} />
          {osNames[os]} · {download.build.label}
        </p>
      </div>
      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {list.map((step, i) => (
          <li
            key={download.build.id + i}
            className="card step row-span-2 grid grid-rows-subgrid gap-0 p-2"
            style={{ '--i': i } as CSSProperties}
          >
            <div className="visual relative min-h-48 overflow-hidden rounded-[0.9rem] border border-line bg-black/25 p-3 light:bg-ink/[0.03]">
              {step.visual}
            </div>
            <div className="px-4 pt-5 pb-5">
              <p className="flex items-center gap-3 font-medium text-ink">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink/[0.06] font-mono text-[0.7rem] text-ink-2">
                  {i + 1}
                </span>
                {step.title}
              </p>
              <p className="mt-2.5 text-[0.92rem] leading-relaxed text-ink-2">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {(download.build.id === 'mac-arm64' || download.build.id === 'mac-x64') && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line px-5 py-4 text-sm text-ink-2 lg:flex-row lg:items-center lg:gap-6">
          <p className="shrink-0">
            macOS says Inlark <span className="text-ink">is damaged</span>? Clear the download flag:
          </p>
          <CodeBlock
            code="xattr -dr com.apple.quarantine /Applications/Inlark.app"
            className="min-w-0 flex-1"
          />
        </div>
      )}
    </div>
  )
}

/* ── Illustrations ──────────────────────────────────────────────────────────── */

function DragVisual() {
  return (
    <div className="flex h-full items-center justify-center gap-5" aria-hidden="true">
      <div className="flex flex-col items-center gap-2.5">
        <span className="relative">
          <AppTile size={56} />
          <AppTile size={56} className="drag-ghost absolute inset-0" />
        </span>
        <span className="text-[0.72rem] text-ink-2">Inlark</span>
      </div>
      <svg width="64" height="20" viewBox="0 0 64 20" fill="none" className="text-ink-3">
        <path
          d="M2 10h56m0 0-6-6m6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 5"
        />
      </svg>
      <div className="flex flex-col items-center gap-2.5">
        <span className="folder">
          <span className="grid size-full place-items-center pt-2 text-white/80">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M8 18 12 6l4 12M9.5 14h5" />
            </svg>
          </span>
        </span>
        <span className="text-[0.72rem] text-ink-2">Applications</span>
      </div>
    </div>
  )
}

function GatekeeperVisual() {
  return (
    <div className="app flex h-full items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-[17rem] rounded-[10px] border border-(--border-strong) bg-(--surface) p-3.5 shadow-[0_20px_40px_-20px_var(--shadow-deep)]">
        <p className="text-[10.5px] font-semibold tracking-wide text-(--muted) uppercase">
          Privacy & Security
        </p>
        <div className="mt-3 rounded-[8px] bg-(--raised) p-3">
          <p className="text-[11.5px] leading-snug text-(--text)">
            “Inlark” was blocked to protect your Mac.
          </p>
          <div className="mt-3 flex justify-end">
            <span className="pulse-ring rounded-[6px] bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#1d1d1f] light:bg-[#e3e3e8]">
              Open Anyway
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function DownloadsVisual({ file }: { file: string }) {
  return (
    <div className="app flex h-full items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-[17rem] overflow-hidden rounded-[10px] border border-(--border-strong) bg-(--surface) shadow-[0_20px_40px_-20px_var(--shadow-deep)]">
        <p className="border-b border-(--border) px-3 py-2 text-[11px] font-medium text-(--secondary)">
          Downloads
        </p>
        <div className="p-1.5">
          <div className="flex items-center gap-2.5 rounded-[6px] bg-(--selected) px-2 py-2 shadow-[inset_2px_0_var(--accent)]">
            <AppTile size={22} />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-(--text-strong)">
              {file}
            </span>
            <span className="text-[10px] text-(--muted)">Now</span>
          </div>
          <div className="flex items-center gap-2.5 px-2 py-2 opacity-40">
            <span className="size-[22px] rounded-[6px] bg-(--raised)" />
            <span className="h-1.5 w-24 rounded-full bg-(--hover)" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SmartScreenVisual() {
  return (
    <div className="flex h-full items-center justify-center font-app" aria-hidden="true">
      <div className="w-full max-w-[17rem] rounded-[4px] bg-[#1b4b82] px-3.5 pt-3 pb-3 text-white shadow-[0_20px_40px_-20px_#000] light:shadow-[0_20px_40px_-20px_rgb(22_24_36/0.3)]">
        <p className="text-[13px] leading-tight font-light">Windows protected your PC</p>
        <p className="mt-2 text-[9.5px] leading-snug text-white/75">
          Microsoft Defender SmartScreen prevented an unrecognized app from starting.
        </p>
        <p className="mt-1.5 text-[9.5px] text-white/60">Publisher: Unknown publisher</p>
        <div className="mt-3 flex justify-end gap-1.5">
          <span className="pulse-ring rounded-[2px] border border-white/70 px-2.5 py-1 text-[10px]">
            Run anyway
          </span>
          <span className="rounded-[2px] bg-white/15 px-2.5 py-1 text-[10px]">Don’t run</span>
        </div>
      </div>
    </div>
  )
}

function LauncherVisual() {
  return (
    <div className="app flex h-full items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-[17rem] overflow-hidden rounded-[10px] border border-(--border-strong) bg-(--surface) shadow-[0_20px_40px_-20px_var(--shadow-deep)]">
        <div className="flex items-center gap-2 border-b border-(--border) px-3 py-2.5 text-[12px] text-(--text-strong)">
          <Search size={13} className="text-(--muted)" />
          inl
          <span className="terminal-caret !h-3.5 !w-px" />
        </div>
        <div className="p-1.5">
          <div className="flex items-center gap-2.5 rounded-[6px] bg-(--selected) px-2 py-2">
            <AppTile size={26} />
            <div>
              <p className="text-[12px] text-(--text-strong)">Inlark</p>
              <p className="text-[10px] text-(--muted)">Email client</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConnectVisual() {
  return (
    <div className="app flex h-full items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-[17rem] rounded-[10px] border border-(--border-strong) bg-(--bg) p-3.5 shadow-[0_20px_40px_-20px_var(--shadow-deep)]">
        <p className="text-[12.5px] font-semibold text-(--text-strong)">Connect an account</p>
        <div className="mt-2.5 rounded-[6px] border border-(--accent-solid) bg-(--surface) px-2.5 py-1.5 text-[11.5px] text-(--text-strong)">
          you@yourdomain.com
        </div>
        <div className="found-row mt-2.5 flex items-center gap-2 rounded-[6px] bg-(--surface) px-2.5 py-2">
          <span className="grid size-4 place-items-center rounded-full bg-(--green)/15 text-(--green)">
            <Check size={9} strokeWidth={2.6} />
          </span>
          <span className="text-[11px] text-(--secondary)">Server settings found</span>
        </div>
      </div>
    </div>
  )
}
