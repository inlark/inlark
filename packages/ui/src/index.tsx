import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Tooltip } from '@base-ui/react/tooltip'
import { Menu } from '@base-ui/react/menu'
import { cn } from './lib/utils'
export { cn } from './lib/utils'
import { X, LoaderCircle } from './icons'
const buttonVariants = {
  default: '',
  primary:
    'button-primary bg-primary-solid border-transparent text-white shadow-[inset_0_1px_#ffffff12] [&:hover:not(:disabled)]:bg-[color-mix(in_srgb,_var(--accent-solid)_85%,_white)] [&:hover:not(:disabled)]:border-transparent',
  ghost:
    "button-ghost bg-transparent border-transparent text-secondary [&:hover:not(:disabled)]:border-transparent [&:hover:not(:disabled)]:text-strong [&[aria-disabled='true']:hover]:bg-transparent [&[aria-disabled='true']:hover]:text-secondary",
  danger: 'button-danger text-danger',
}
const buttonSizes = {
  default: '',
  icon: 'button-icon p-1.25 w-7.25 h-7.25 min-h-7.25',
  small: 'button-small min-h-6.5 py-[3px] px-2 text-[11px]',
}

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
      className={cn(
        'button inline-flex items-center justify-center gap-1.75 border border-solid border-border-strong bg-surface',
        'rounded-md py-1.5 px-2.75 text-[12px] font-medium whitespace-nowrap transition-[background,color] duration-120',
        'ease-[ease] min-h-8 [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:border-foreground/24',
        "[&[aria-disabled='true']]:opacity-40 [&[aria-disabled='true']]:cursor-default",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
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
          <Tooltip.Popup className="tooltip flex gap-3 items-center py-1.5 px-2.25 bg-raised border border-solid border-border-strong rounded-md text-[11px] shadow-popup z-200">
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
        <Dialog.Backdrop className="modal-backdrop fixed inset-0 bg-[#0505079c] backdrop-blur-[5px] transition-[opacity] duration-160 ease-[ease] z-100 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          ref={popupRef}
          className={cn(
            'modal fixed top-[50%] left-[50%] transform-[translate(-50%,_-50%)] w-[min(560px,_calc(100vw_-_40px))]',
            'max-h-[calc(100vh_-_70px)] overflow-y-auto bg-surface border border-solid border-border-strong rounded-2xl',
            'shadow-popup p-5.75 z-101 max-w-[calc(100vw_-_40px)] transition-[opacity,transform] duration-160 ease-[ease]',
            'data-starting-style:opacity-0 data-starting-style:transform-[translate(-50%,_-48%)_scale(0.98)]',
            'data-ending-style:opacity-0 data-ending-style:transform-[translate(-50%,_-48%)_scale(0.98)]',
            className,
          )}
        >
          <div className="modal-heading flex items-start justify-between gap-3.75 mb-5.5">
            <div>
              <Dialog.Title className="modal-title text-[16px] font-[550] m-0 tracking-[-0.3px]">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="modal-description text-[12px] leading-[1.6] text-secondary mt-1.25 mb-0 mx-0">
                  {description}
                </Dialog.Description>
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
          <Menu.Popup
            className={cn(
              'dropdown min-w-45 bg-raised border border-solid border-border-strong rounded-lg shadow-popup p-1.25 z-120',
              'origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 ease-[ease]',
              'data-starting-style:opacity-0 data-starting-style:transform-[scale(0.98)] data-ending-style:opacity-0',
              'data-ending-style:transform-[scale(0.98)]',
              className,
            )}
          >
            {children}
          </Menu.Popup>
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
      className={cn(
        'menu-item flex items-center gap-2.25 text-[12px] py-1.75 px-2.5 rounded-xs outline-none cursor-pointer',
        'data-highlighted:bg-hover data-highlighted:text-strong data-disabled:opacity-40',
        '[&_kbd]:ml-auto',
        danger && 'danger text-danger data-highlighted:text-danger',
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Menu.Item>
  )
}
export const TooltipProvider = Tooltip.Provider
export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="spin animate-spin" size={size} aria-label="Loading" />
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
    <div
      className={cn(
        'empty-state flex-1 flex flex-col items-center justify-center pt-12 pb-[12vh] px-8 text-center',
        '[&>h2+:not(p)]:mt-3.5 [&>.button]:mt-[2px]',
      )}
    >
      <div className="empty-icon grid place-items-center w-16 h-16 mb-3.5 rounded-full text-muted bg-[radial-gradient(_circle,_color-mix(in_srgb,_var(--accent)_12%,_transparent)_0,_transparent_70%_)]">
        <Icon size={26} strokeWidth={1.4} />
      </div>
      <h2 className="text-[15px] font-[550] text-strong mt-0 mb-1.5 mx-0 tracking-[-0.2px]">
        {title}
      </h2>
      {description && (
        <p className="text-[13px] text-muted max-w-75 mt-0 mb-5 mx-0 leading-[1.6] text-balance">
          {description}
        </p>
      )}
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
      className={cn(
        'avatar inline-flex shrink-0 items-center justify-center rounded-lg',
        'bg-[color-mix(in_srgb,_var(--avatar-color)_12%,_transparent)] text-[var(--avatar-color)] font-semibold',
        'tracking-[-0.4px] overflow-hidden',
      )}
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
        <img
          className="block w-full h-full object-cover"
          src={image}
          alt=""
          onError={() => setImageFailed(true)}
        />
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
