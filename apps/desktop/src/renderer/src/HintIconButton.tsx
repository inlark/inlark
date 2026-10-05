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
          <Tooltip.Popup className="tooltip flex gap-3 py-1.5 px-2.25 bg-raised border border-solid border-border-strong rounded-md text-[11px] shadow-popup z-200 tooltip-with-hint items-start max-w-70">
            <span className="tooltip-text flex flex-col gap-[2px]">
              {label}
              <span className="tooltip-hint text-muted leading-[1.5]">{hint}</span>
            </span>
            {shortcut && <kbd>{shortcut}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
