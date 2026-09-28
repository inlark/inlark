import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { cn } from '../lib/utils'
import { Check, Minus } from '../icons'

export function Checkbox({
  checked,
  indeterminate,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  /** `event` is the click or key event, so callers can read modifier keys. */
  onCheckedChange: (checked: boolean, event: Event) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <BaseCheckbox.Root
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn('checkbox', className)}
      onCheckedChange={(next, details) => onCheckedChange(next, details.event)}
    >
      <BaseCheckbox.Indicator className="checkbox-indicator">
        {indeterminate ? (
          <Minus size={11} strokeWidth={2.5} />
        ) : (
          <Check size={11} strokeWidth={2.5} />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
}
