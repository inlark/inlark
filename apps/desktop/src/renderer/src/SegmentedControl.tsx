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
      className={'segmented' + (className ? ' ' + className : '')}
      data-disabled={disabled || undefined}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={'segmented-option' + (option.value === value ? ' chosen' : '')}
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
