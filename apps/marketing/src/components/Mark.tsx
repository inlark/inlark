import { useId } from 'react'

/** The Relay II mark with the lit faces of the app icon, inked instead on light surfaces. */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  const id = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="4 16 88 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={id + 'rear'}
          x1="20"
          y1="20"
          x2="39"
          y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: 'var(--mark-rear-1)' }} />
          <stop offset=".47" style={{ stopColor: 'var(--mark-rear-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-rear-3)' }} />
        </linearGradient>
        <linearGradient
          id={id + 'front'}
          x1="48"
          y1="20"
          x2="81"
          y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: 'var(--mark-front-1)' }} />
          <stop offset=".45" style={{ stopColor: 'var(--mark-front-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-front-3)' }} />
        </linearGradient>
      </defs>
      <path d="M8 20h21l21 28-21 28H8l23-28Z" fill={`url(#${id}rear)`} />
      <path d="M37 20h22c12 0 24 11 29 28-5 17-17 28-29 28H37l21-28Z" fill={`url(#${id}front)`} />
    </svg>
  )
}
