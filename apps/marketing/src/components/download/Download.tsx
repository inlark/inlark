import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Download as DownloadIcon,
  LoaderCircle,
} from '@inlark/ui/icons'
import {
  buildById,
  downloadFor,
  fetchCurrentRelease,
  osNames,
  type Build,
  type BuildId,
  type Release,
} from '../../data/release'
import { links } from '../../data/links'
import { detectPlatform, isMobile, recommend, type Recommendation } from '../../lib/platform'
import { Builds, formatSize } from './Builds'
import { useCopied } from './CodeBlock'
import { AppTile, BuildIcon } from './icons'
import { Mobile } from './Mobile'
import { Steps } from './Steps'

type Phase =
  /** Before the platform is known. The server-rendered page is in this state. */
  | 'detecting'
  /** Waiting for GitHub to confirm the latest files before starting the download. */
  | 'preparing'
  | 'ready'
  | 'started'

/** Other builds worth offering right under the recommended one, in case the guess was wrong. */
const alternatives: Record<BuildId, BuildId[]> = {
  'mac-arm64': ['mac-x64'],
  'mac-x64': ['mac-arm64'],
  windows: [],
  appimage: ['deb', 'rpm', 'nix'],
  deb: ['appimage', 'rpm', 'nix'],
  rpm: ['appimage', 'deb', 'nix'],
  nix: ['nixos', 'appimage'],
  nixos: ['nix', 'appimage'],
}

const alternativeLabel: Record<BuildId, string> = {
  'mac-arm64': 'Apple silicon Mac?',
  'mac-x64': 'Intel Mac?',
  windows: 'Windows',
  appimage: 'AppImage',
  deb: '.deb',
  rpm: '.rpm',
  nix: 'Nix',
  nixos: 'NixOS',
}

const released = (date: string) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date))

const delay = (seconds: number) => ({ '--delay': seconds + 's' }) as CSSProperties

export function DownloadPage({ initial }: { initial: Release }) {
  const [release, setRelease] = useState(initial)
  const [phase, setPhase] = useState<Phase>('detecting')
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)
  const [selected, setSelected] = useState<BuildId | null>(null)
  const [mobileBuilds, setMobileBuilds] = useState(false)
  const started = useRef(false)
  const [copiedDigest, copyDigest] = useCopied()

  useEffect(() => {
    let cancelled = false
    const live = fetchCurrentRelease()

    live.then((latest) => !cancelled && latest && setRelease(latest))
    if (isMobile()) return

    detectPlatform().then(async (platform) => {
      if (cancelled) return
      const suggestion = recommend(platform)
      setRecommendation(suggestion)
      setSelected(suggestion?.build ?? null)
      if (!suggestion?.auto) return setPhase('ready')

      setPhase('preparing')
      const download = downloadFor((await live) ?? initial, buildById(suggestion.build))
      if (cancelled || started.current) return
      // Only files GitHub confirmed start by themselves. A guessed link could lead to a missing file.
      if (!download.confirmed) return setPhase('ready')
      started.current = true
      setPhase('started')
      window.location.assign(download.url)
    })
    return () => {
      cancelled = true
    }
  }, [initial])

  const build = selected ? buildById(selected) : null
  const download = build ? downloadFor(release, build) : null

  const choose = (next: Build, scroll = true) => {
    started.current = true
    setSelected(next.id)
    setRecommendation((current) => (current?.build === next.id ? current : null))
    setPhase(next.file && downloadFor(release, next).confirmed ? 'started' : 'ready')
    if (!scroll) return
    // A file downloads and its status sits at the top. Commands live in the steps below.
    requestAnimationFrame(() =>
      next.file
        ? window.scrollTo({ top: 0, behavior: 'smooth' })
        : document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' }),
    )
  }

  const meta = [
    `Version ${release.version}`,
    release.publishedAt ? `released ${released(release.publishedAt)}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <div className="mobile-view pt-28 pb-20">
        <Mobile />
        <div className="mx-auto mt-14 max-w-md px-6 text-center">
          <button
            type="button"
            onClick={() => setMobileBuilds((open) => !open)}
            className="text-sm text-ink-3 underline decoration-ink-3/40 underline-offset-4 transition-colors hover:text-ink-2"
            aria-expanded={mobileBuilds}
          >
            {mobileBuilds ? 'Hide downloads' : 'Show the desktop downloads'}
          </button>
        </div>
        {mobileBuilds && (
          <div className="mx-auto mt-8 max-w-6xl px-5">
            <Builds release={release} selected={null} onChoose={() => {}} />
          </div>
        )}
      </div>

      <div className="desktop-view">
        <section className="relative px-5 pt-36 text-center sm:pt-44">
          <div
            key={phase === 'detecting' ? 'pending' : 'resolved'}
            className={'mx-auto max-w-2xl ' + (phase === 'detecting' ? 'pending' : '')}
          >
            <AppTile size={68} className="rise mx-auto" />
            <p className="eyebrow rise mt-9" style={delay(0.06)}>
              {meta}
            </p>
            <h1 className="display rise mt-5 text-[clamp(2.8rem,7vw,5.2rem)]" style={delay(0.12)}>
              {build ? (
                <>
                  Inlark for <em className="dawn-text pr-[0.06em]">{osNames[build.os]}</em>
                </>
              ) : (
                'Download Inlark'
              )}
            </h1>
            <p
              className="rise mx-auto mt-6 max-w-lg text-lg leading-relaxed text-ink-2"
              style={delay(0.18)}
            >
              {phase === 'started'
                ? 'Your download has started. Here’s how to install it.'
                : build
                  ? 'Free and open source, and set up in a minute.'
                  : 'Free and open source for Linux, Windows, and macOS. Choose the build for your computer.'}
            </p>

            {download && (
              <div className="rise mx-auto mt-10 max-w-xl" style={delay(0.24)}>
                <div className="card flex items-center gap-4 p-3 pr-3 text-left sm:p-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-ink/[0.035] text-ink-2">
                    <BuildIcon build={download.build} size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[0.82rem] text-ink">
                      {download.file ?? `Install with ${download.build.label}`}
                    </p>
                    <p className="mt-1 truncate text-sm text-ink-3">
                      {download.build.label}
                      {download.size ? ' · ' + formatSize(download.size) : ''}
                      {download.build.file ? '' : ' · ' + download.build.detail}
                    </p>
                  </div>
                  <HeroAction
                    phase={phase}
                    download={download}
                    onDownload={() => choose(download.build, false)}
                  />
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-ink-3">
                  {phase === 'started' && download.file && (
                    <a
                      href={download.url}
                      className="transition-colors hover:text-ink"
                      onClick={() => choose(download.build, false)}
                    >
                      Didn’t start?{' '}
                      <span className="text-ink-2 underline decoration-ink-3/50 underline-offset-4">
                        Try again
                      </span>
                    </a>
                  )}
                  {alternatives[download.build.id].map((id) => {
                    const other = buildById(id)
                    const link = downloadFor(release, other)
                    const label = alternativeLabel[id]
                    const mac = download.build.os === 'mac'
                    return other.file ? (
                      <a
                        key={id}
                        href={link.url}
                        onClick={() => choose(other, false)}
                        className="transition-colors hover:text-ink"
                      >
                        {mac ? (
                          <>
                            {label}{' '}
                            <span className="text-ink-2 underline decoration-ink-3/50 underline-offset-4">
                              Get the {other.label} build
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-2 underline decoration-ink-3/50 underline-offset-4">
                            {label}
                          </span>
                        )}
                      </a>
                    ) : (
                      <button
                        key={id}
                        type="button"
                        onClick={() => choose(other, false)}
                        className="text-ink-2 underline decoration-ink-3/50 underline-offset-4 transition-colors hover:text-ink"
                      >
                        {label}
                      </button>
                    )
                  })}
                  <a
                    href="#all"
                    className="flex items-center gap-1 transition-colors hover:text-ink"
                  >
                    All downloads <ArrowDown size={13} />
                  </a>
                </div>
                {recommendation?.build === download.build.id && recommendation.note && (
                  <p className="mt-4 text-sm text-ink-3">{recommendation.note}</p>
                )}
                {download.digest && (
                  <button
                    type="button"
                    onClick={() => copyDigest(download.digest!)}
                    className="mt-3 font-mono text-[0.68rem] tracking-wide text-ink-3 transition-colors hover:text-ink-2"
                    title={download.digest}
                  >
                    {copiedDigest ? 'SHA-256 copied' : 'Copy SHA-256 checksum'}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {download && phase !== 'detecting' && (
          <section
            id="install"
            className="mx-auto max-w-6xl -scroll-mt-20 px-5 pt-28 sm:-scroll-mt-24 sm:px-8 sm:pt-36"
          >
            <Steps key={download.build.id} download={download} />
          </section>
        )}

        <section
          id="all"
          className="mx-auto max-w-6xl -scroll-mt-20 px-5 pt-28 sm:-scroll-mt-24 sm:px-8 sm:pt-36"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Every build</p>
              <h2 className="display mt-4 text-[clamp(2rem,4.2vw,3rem)]">
                {build ? 'Something else?' : 'Choose your system.'}
              </h2>
            </div>
            <a
              href={release.url}
              className="flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
            >
              Release notes <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="mt-10">
            <Builds release={release} selected={selected} onChoose={(b) => choose(b)} />
          </div>
          <p className="mt-8 max-w-2xl text-[0.92rem] leading-relaxed text-ink-3">
            <span className="text-dawn">Inlark {release.version} is an early preview.</span> Try it
            alongside your current client while it matures, and{' '}
            <a
              href={links.issues}
              className="text-ink-2 underline decoration-ink-3/50 underline-offset-4 hover:text-ink"
            >
              tell us what breaks
            </a>
            .
          </p>
        </section>
      </div>
    </>
  )
}

function HeroAction({
  phase,
  download,
  onDownload,
}: {
  phase: Phase
  download: ReturnType<typeof downloadFor>
  onDownload: () => void
}) {
  if (!download.build.file)
    return (
      <a href="#install" className="btn btn-ghost h-10 shrink-0 rounded-lg px-3.5 text-sm">
        See steps <ArrowDown size={15} />
      </a>
    )
  if (phase === 'preparing')
    return (
      <span className="flex h-10 shrink-0 items-center gap-2 px-2 text-sm text-ink-2">
        <LoaderCircle size={16} className="animate-spin" /> Starting
      </span>
    )
  if (phase === 'started')
    return (
      <span className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-leaf/10 px-3 text-sm text-leaf">
        <Check size={16} /> Downloading
      </span>
    )
  return (
    <a
      href={download.url}
      onClick={onDownload}
      className="btn btn-primary h-10 shrink-0 rounded-lg px-4 text-sm"
    >
      <DownloadIcon size={16} /> Download
    </a>
  )
}
