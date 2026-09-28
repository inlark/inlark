import { Apple, Terminal, Windows } from '@inlark/ui/icons'
import type { Build, Os } from '../../data/release'
import { Mark } from '../Mark'

/** Tux, drawn in the same outline style as the other platform icons. */
export function Tux({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.6 19.6C7.3 18.4 6.5 16.8 6.5 15c0-1.7.8-3 1.7-4.2.6-.8.9-1.6.9-2.6V7c0-2.3 1.2-4.25 2.9-4.25S14.9 4.7 14.9 7v1.2c0 1 .3 1.8.9 2.6.9 1.2 1.7 2.5 1.7 4.2 0 1.8-.8 3.4-2.1 4.6" />
      <path d="M10.1 11.6c-.8.9-1.3 2-1.3 3.3 0 2 1.3 3.35 3.2 3.35s3.2-1.35 3.2-3.35c0-1.3-.5-2.4-1.3-3.3" />
      <path d="M11 8.75h2l-1 .9Z" />
      <path d="M5 20.6c.9-.9 2-1.5 3.3-1.6.6 0 1 .4 1 .9 0 .8-.9 1.35-2.1 1.35-1 0-1.7-.2-2.2-.65ZM19 20.6c-.9-.9-2-1.5-3.3-1.6-.6 0-1 .4-1 .9 0 .8.9 1.35 2.1 1.35 1 0 1.7-.2 2.2-.65Z" />
      <circle cx="11" cy="6.6" r=".2" fill="currentColor" />
      <circle cx="13" cy="6.6" r=".2" fill="currentColor" />
    </svg>
  )
}

export function OsIcon({
  os,
  size = 20,
  className,
}: {
  os: Os
  size?: number
  className?: string
}) {
  if (os === 'mac') return <Apple size={size} className={className} />
  if (os === 'windows') return <Windows size={size} className={className} />
  return <Tux size={size} className={className} />
}

export function BuildIcon({ build, size = 20 }: { build: Build; size?: number }) {
  return build.file ? <OsIcon os={build.os} size={size} /> : <Terminal size={size} />
}

/** The app icon: the mark on its lit indigo tile. */
export function AppTile({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={
        'grid shrink-0 place-items-center scheme-dark bg-linear-to-br from-[#6268ef] via-[#484bd3] to-[#292397] shadow-[0_16px_50px_-10px_#484bd3,inset_0_1px_0_#ffffff40] ' +
        className
      }
      style={{ width: size, height: size, borderRadius: size * 0.29 }}
    >
      <Mark size={Math.round(size * 0.47)} />
    </span>
  )
}
