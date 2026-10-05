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
      className={cn(
        'checkbox inline-grid place-content-center shrink-0 w-3.75 h-3.75 border border-solid border-faint rounded-xs',
        'bg-transparent text-white cursor-pointer transition-[background,border-color] duration-100 ease-[ease]',
        '[&:hover:not([data-disabled])]:border-muted data-checked:bg-primary-solid data-checked:border-primary-solid',
        'data-indeterminate:bg-primary-solid data-indeterminate:border-primary-solid data-disabled:opacity-40',
        'data-disabled:cursor-default',
        className,
      )}
      onCheckedChange={(next, details) => onCheckedChange(next, details.event)}
    >
      <BaseCheckbox.Indicator className="checkbox-indicator flex data-unchecked:hidden">
        {indeterminate ? (
          <Minus size={11} strokeWidth={2.5} />
        ) : (
          <Check size={11} strokeWidth={2.5} />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
}
