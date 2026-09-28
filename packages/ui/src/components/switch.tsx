import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cn } from '../lib/utils'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn('switch', className)}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  )
}
