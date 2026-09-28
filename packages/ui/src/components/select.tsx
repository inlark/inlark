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
        className={cn('select-trigger', className)}
      >
        <BaseSelect.Value className="select-value" />
        <BaseSelect.Icon className="select-icon">
          <ChevronDown size={13} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="select-positioner"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="dropdown select-popup">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className="menu-item select-item"
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="select-item-indicator">
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
