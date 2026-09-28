import type { ButtonHTMLAttributes } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'
import { Button, IconButton } from '@inlark/ui'

/**
 * An icon button that can explain why its action is unavailable. When `hint` is set the button
 * stays focusable (so the tooltip still shows) but is marked unavailable; its click handler
 * still runs, so the caller can repeat the explanation as a toast.
 */
export function HintIconButton({
  label,
  shortcut,
  hint,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  shortcut?: string
  hint?: string
}) {
  if (!hint)
    return (
      <IconButton label={label} shortcut={shortcut} {...props}>
        {children}
      </IconButton>
    )
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            size="icon"
            variant="ghost"
            aria-label={label + '. ' + hint}
            aria-disabled
            {...props}
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={7}>
          <Tooltip.Popup className="tooltip tooltip-with-hint">
            <span className="tooltip-text">
              {label}
              <span className="tooltip-hint">{hint}</span>
            </span>
            {shortcut && <kbd>{shortcut}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
