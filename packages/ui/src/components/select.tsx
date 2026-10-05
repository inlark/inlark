import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from '../lib/utils'
import { Check, ChevronDown } from '../icons'

export type SelectOption<Value extends string> = { value: Value; label: string }

/** A single-choice picker that opens a menu styled like the app's dropdowns. */
export function Select<Value extends string>({
  value,
  options,
  onValueChange,
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  value: Value
  options: readonly SelectOption<Value>[]
  onValueChange: (value: Value) => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
}) {
  return (
    <BaseSelect.Root
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'select-trigger flex items-center gap-2 w-full min-w-0 h-9 py-0 pr-2.5 pl-2.75 text-foreground bg-field border',
          'border-solid border-border-strong rounded-md text-[12px] text-left transition-[border-color,background]',
          'duration-120 ease-[ease] [&:hover:not([data-disabled])]:bg-field-hover data-popup-open:border-primary-solid',
          'data-popup-open:outline-none focus-visible:border-primary-solid focus-visible:outline-none',
          'data-disabled:opacity-50 data-disabled:cursor-default',
          className,
        )}
      >
        <BaseSelect.Value className="select-value flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&.placeholder]:text-muted" />
        <BaseSelect.Icon className="select-icon flex text-muted">
          <ChevronDown size={13} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="select-positioner z-120"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup
            className={cn(
              'dropdown bg-raised border border-solid border-border-strong rounded-lg shadow-popup p-1.25 z-120',
              'origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 ease-[ease]',
              'data-starting-style:opacity-0 data-starting-style:transform-[scale(0.98)] data-ending-style:opacity-0',
              'data-ending-style:transform-[scale(0.98)] select-popup min-w-[var(--anchor-width)]',
              'max-h-[min(320px,_var(--available-height))] overflow-y-auto',
            )}
          >
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className={cn(
                    'menu-item flex items-center gap-2.25 text-[12px] py-1.75 px-2.5 rounded-xs outline-none cursor-pointer',
                    'data-highlighted:bg-hover data-highlighted:text-strong data-disabled:opacity-40 [&.danger]:text-danger',
                    '[&_kbd]:ml-auto select-item justify-between',
                  )}
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="select-item-indicator flex text-primary">
                    <Check size={13} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
