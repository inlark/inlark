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
      className={cn(
        'switch group/switch relative inline-flex shrink-0 w-7.5 h-4.5 p-[2px] rounded-3xl bg-hover',
        'shadow-[inset_0_0_0_1px_var(--border-strong)] cursor-pointer transition-[background] duration-120 ease-[ease]',
        'data-checked:bg-primary-solid data-checked:shadow-none data-disabled:opacity-40 data-disabled:cursor-default',
        className,
      )}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      <BaseSwitch.Thumb className="switch-thumb w-3.5 h-3.5 rounded-full bg-muted [transition:transform_140ms_ease,_background_120ms] group-data-checked/switch:bg-white group-data-checked/switch:transform-[translateX(12px)]" />
    </BaseSwitch.Root>
  )
}
