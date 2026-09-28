import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Tooltip } from '@base-ui/react/tooltip'
import { Menu } from '@base-ui/react/menu'
import { cn } from './lib/utils'
export { cn } from './lib/utils'
import { X, LoaderCircle } from './icons'
export function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'default' | 'icon' | 'small'
}) {
  return (
    <button
      type="button"
      className={cn('button', 'button-' + variant, 'button-' + size, className)}
      {...props}
    />
  )
}
export function IconButton({
  label,
  shortcut,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<Button size="icon" variant="ghost" aria-label={label} {...props} />}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={7}>
          <Tooltip.Popup className="tooltip">
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  popupRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  popupRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup ref={popupRef} className={cn('modal', className)}>
          <div className="modal-heading">
            <div>
              <Dialog.Title className="modal-title">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="modal-description">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon" aria-label="Close dialog" />}>
              <X size={16} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
export function Dropdown({
  trigger,
  children,
  container,
  className,
}: {
  trigger: React.ReactElement
  children: React.ReactNode
  container?: React.RefObject<HTMLElement | null>
  className?: string
}) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal container={container}>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className={cn('dropdown', className)}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
export function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <Menu.Item
      className={cn('menu-item', danger && 'danger')}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Menu.Item>
  )
}
export const TooltipProvider = Tooltip.Provider
export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} aria-label="Loading" />
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.4} />
      </div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}
export function Avatar({
  name,
  color,
  size = 32,
  image,
}: {
  name: string
  color?: string
  size?: number
  image?: string | null
}) {
  const [imageFailed, setImageFailed] = React.useState(false)
  React.useEffect(() => setImageFailed(false), [image])
  const letters =
    name
      .trim()
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase() || '?'
  return (
    <span
      className="avatar"
      style={
        {
          '--avatar-color': color || '#a69aef',
          width: size,
          height: size,
          fontSize: size < 30 ? 10 : 12,
        } as React.CSSProperties
      }
    >
      {image && !imageFailed ? (
        <img src={image} alt="" onError={() => setImageFailed(true)} />
      ) : (
        letters
      )}
    </span>
  )
}
export { Select, type SelectOption } from './components/select'
export { Checkbox } from './components/checkbox'
export { Switch } from './components/switch'
export { DatePicker } from './components/date-picker'
