import { useRef, useState, type RefObject } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ImageRemove, ImageUpload, Shuffle } from '@inlark/ui/icons'
import { MenuItem, cn } from '@inlark/ui'
import type { AccountAppearance } from '@inlark/core'
import { AccountTile } from './AccountMark'
import { accountImage, accountImageTypes } from './account-image'

/**
 * Lets the user replace an account's generated avatar with a picture of their own, or shuffle the
 * pattern. A picture can also be dropped onto the avatar.
 */
export function AccountAvatarPicker({
  name,
  email,
  value,
  onChange,
  onError,
  portalContainer,
}: {
  name: string
  email: string
  value: AccountAppearance
  onChange: (appearance: AccountAppearance) => void
  onError: (error: unknown) => void
  portalContainer?: RefObject<HTMLElement | null>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const choose = (file?: File) => {
    if (file) accountImage(file).then((image) => onChange({ ...value, image }), onError)
  }
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <button
              type="button"
              className={cn('account-tile-button', dragging && 'dragging')}
              aria-label={'Change avatar for ' + name}
              title="Change avatar"
              onDragOver={(e) => {
                if (![...e.dataTransfer.items].some((item) => item.kind === 'file')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                choose(e.dataTransfer.files[0])
              }}
            />
          }
        >
          <AccountTile account={{ ...value, email }} />
        </Menu.Trigger>
        <Menu.Portal container={portalContainer}>
          <Menu.Positioner sideOffset={6} align="start" className="account-avatar-menu z-130">
            <Menu.Popup className="dropdown">
              <MenuItem onClick={() => input.current?.click()}>
                <ImageUpload size={15} />
                {value.image ? 'Replace picture…' : 'Upload picture…'}
              </MenuItem>
              {value.image ? (
                <MenuItem onClick={() => onChange({ ...value, image: undefined })}>
                  <ImageRemove size={15} />
                  Remove picture
                </MenuItem>
              ) : (
                <MenuItem
                  onClick={() => onChange({ ...value, seed: crypto.randomUUID().slice(0, 8) })}
                >
                  <Shuffle size={15} />
                  Shuffle pattern
                </MenuItem>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <input
        ref={input}
        type="file"
        accept={accountImageTypes}
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )
}
