import { ChevronRight, Download as DownloadIcon } from '@inlark/ui/icons'
import {
  builds,
  downloadFor,
  osNames,
  type Build,
  type BuildId,
  type Os,
  type Release,
} from '../../data/release'
import { OsIcon } from './icons'

export const formatSize = (bytes: number) => `${Math.round(bytes / 1e6)} MB`

/** Every build of the release, for when the guess was wrong or someone downloads for another machine. */
export function Builds({
  release,
  selected,
  onChoose,
}: {
  release: Release
  selected: BuildId | null
  onChoose: (build: Build) => void
}) {
  const group = (os: Os) => (
    <div key={os} className="card p-2">
      <p className="flex items-center gap-2.5 px-3 pt-2.5 pb-3 text-sm font-medium text-ink">
        <OsIcon os={os} size={17} className="text-ink-2" />
        {osNames[os]}
      </p>
      <ul className="space-y-0.5">
        {builds
          .filter((b) => b.os === os)
          .map((build) => {
            const download = downloadFor(release, build)
            const active = build.id === selected
            const content = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.92rem] text-ink">{build.label}</span>
                  <span className="block truncate text-[0.8rem] text-ink-3">
                    {build.detail}
                    {download.size ? ' · ' + formatSize(download.size) : ''}
                  </span>
                </span>
                <span
                  className={
                    'grid size-8 shrink-0 place-items-center rounded-lg transition-colors ' +
                    (active
                      ? 'bg-lavender/15 text-lavender'
                      : 'text-ink-3 group-hover:bg-white/[0.06] group-hover:text-ink')
                  }
                >
                  {build.file ? <DownloadIcon size={16} /> : <ChevronRight size={16} />}
                </span>
              </>
            )
            const className =
              'group flex w-full items-center gap-3 rounded-[0.8rem] px-3 py-2.5 text-left transition-colors ' +
              (active ? 'bg-white/[0.05] ring-1 ring-white/[0.07]' : 'hover:bg-white/[0.035]')
            return (
              <li key={build.id}>
                {build.file ? (
                  <a
                    href={download.url}
                    className={className}
                    aria-current={active || undefined}
                    onClick={() => onChoose(build)}
                  >
                    {content}
                    <span className="sr-only">
                      Download for {osNames[os]}, {build.label}
                    </span>
                  </a>
                ) : (
                  <button
                    type="button"
                    className={className}
                    aria-current={active || undefined}
                    onClick={() => onChoose(build)}
                  >
                    {content}
                    <span className="sr-only">Show {build.label} instructions</span>
                  </button>
                )}
              </li>
            )
          })}
      </ul>
    </div>
  )

  // macOS and Windows share a column, which balances the longer list of Linux formats.
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        {group('mac')}
        {group('windows')}
      </div>
      {group('linux')}
    </div>
  )
}
