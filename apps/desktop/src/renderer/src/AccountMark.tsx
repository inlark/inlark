import { useEffect, useState, type CSSProperties } from 'react'
import BoringAvatar from 'boring-avatars'
import { avatarColors, type AccountAppearance } from '@inlark/core'
import { cn } from '@inlark/ui'

type Appearance = AccountAppearance & { email: string }

/** The account's picture, or a marble pattern generated from its address until one is chosen. */
export function AccountMark({
  account,
  size = 16,
  className,
  title,
}: {
  account: Appearance
  size?: number
  className?: string
  title?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [account.image])
  return (
    <span
      className={cn(
        'account-mark [--mark-size:16px] [--mark-ring:rgb(255_255_255_/_0.08)] relative w-[var(--mark-size)]',
        'h-[var(--mark-size)] shrink-0 inline-flex rounded-full overflow-hidden light:[--mark-ring:rgb(0_0_0_/_0.08)]',
        "after:content-[''] after:absolute after:inset-0 after:rounded-[inherit]",
        'after:shadow-[inset_0_0_0_1px_var(--mark-ring)] after:pointer-events-none [&>svg]:block [&>svg]:w-full',
        '[&>svg]:h-full [&>svg]:object-cover [&>img]:block [&>img]:w-full [&>img]:h-full [&>img]:object-cover',
        '[&.disconnected]:opacity-40',
        className,
      )}
      title={title}
      style={{ '--mark-size': size + 'px' } as CSSProperties}
    >
      {account.image && !imageFailed ? (
        <img src={account.image} alt="" draggable={false} onError={() => setImageFailed(true)} />
      ) : (
        <BoringAvatar
          variant="marble"
          name={account.seed || account.email}
          colors={avatarColors}
          size={size}
          square
          aria-hidden
        />
      )}
    </span>
  )
}

/** The larger avatar used in settings. */
export function AccountTile({ account, size = 34 }: { account: Appearance; size?: number }) {
  return <AccountMark account={account} size={size} />
}
