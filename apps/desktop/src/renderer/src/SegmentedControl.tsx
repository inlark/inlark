import { cn } from '@inlark/ui'
import { useId } from 'react'

/**
 * A compact choice between a few options. Native radios give the expected keyboard behaviour:
 * Tab reaches the group once and the arrow keys move between options.
 */
export function SegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: Value
  options: readonly { value: Value; label: string }[]
  onChange: (value: Value) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const name = useId()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'segmented inline-flex p-[2px] gap-[2px] border border-solid border-border-strong rounded-[7px] bg-field',
        'data-disabled:opacity-50',
        className,
      )}
      data-disabled={disabled || undefined}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'segmented-option has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid',
            'has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2 inline-flex',
            'items-center h-7.5 py-0 px-2.75 rounded-sm text-[12px] text-muted whitespace-nowrap cursor-pointer',
            'transition-[background,color] duration-120 ease-[ease] hover:text-foreground',
            option.value === value &&
              'chosen bg-selected text-strong hover:text-strong font-medium shadow-[0_1px_2px_#0000001a]',
          )}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
