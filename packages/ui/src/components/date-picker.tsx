import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import { DayPicker } from 'react-day-picker'
import { cn } from '../lib/utils'
import { Calendar, ChevronLeft, ChevronRight, X } from '../icons'

const calendarNavigationClasses = cn(
  'button inline-flex items-center justify-center gap-1.75 border border-solid rounded-md text-[12px] font-medium',
  'whitespace-nowrap transition-[background,color] duration-120 ease-[ease] [&:hover:not(:disabled)]:bg-hover',
  "[&[aria-disabled='true']]:opacity-40 [&[aria-disabled='true']]:cursor-default button-ghost bg-transparent",
  'border-transparent [&:hover:not(:disabled)]:border-transparent [&:hover:not(:disabled)]:text-strong',
  "[&[aria-disabled='true']:hover]:bg-transparent [&[aria-disabled='true']:hover]:text-secondary button-icon",
  'calendar-nav-button w-7 h-7 min-h-7 p-0 text-muted',
)

/** Parses a `yyyy-mm-dd` string as a local calendar day. */
const parseDay = (value?: string) => {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined
}
const formatDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

/** Picks a calendar day; the value is a `yyyy-mm-dd` string, like a native date input. */
export function DatePicker({
  value,
  onValueChange,
  placeholder = 'Any date',
  className,
  'aria-label': ariaLabel,
}: {
  value?: string
  onValueChange: (value: string | undefined) => void
  placeholder?: string
  className?: string
  'aria-label'?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = parseDay(value)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn('date-picker relative [&:has(.date-clear)_.date-trigger]:pr-8', className)}
      >
        <Popover.Trigger
          className={cn(
            'select-trigger flex items-center gap-2 w-full min-w-0 h-9 py-0 pr-2.5 pl-2.75 text-foreground bg-field border',
            'border-solid border-border-strong rounded-md text-[12px] text-left transition-[border-color,background]',
            'duration-120 ease-[ease] [&:hover:not([data-disabled])]:bg-field-hover data-popup-open:border-primary-solid',
            'data-popup-open:outline-none focus-visible:border-primary-solid focus-visible:outline-none',
            'data-disabled:opacity-50 data-disabled:cursor-default date-trigger',
          )}
          aria-label={ariaLabel}
        >
          <Calendar size={14} className="date-trigger-icon text-muted" />
          <span
            className={cn(
              'select-value flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&.placeholder]:text-muted',
              !selected && 'placeholder',
            )}
          >
            {selected
              ? selected.toLocaleDateString(undefined, { dateStyle: 'medium' })
              : placeholder}
          </span>
        </Popover.Trigger>
        {selected && (
          <button
            type="button"
            className={cn(
              'date-clear absolute top-[50%] right-1.75 transform-[translateY(-50%)] grid place-content-center w-5.5 h-5.5 p-0',
              'border-0 rounded-sm bg-none bg-transparent text-muted hover:bg-hover hover:text-foreground',
            )}
            aria-label={'Clear ' + (ariaLabel || 'date')}
            onClick={() => onValueChange(undefined)}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="date-positioner z-120">
          <Popover.Popup
            className={cn(
              'dropdown bg-raised border border-solid border-border-strong rounded-lg shadow-popup z-120',
              'origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 ease-[ease]',
              'data-starting-style:opacity-0 data-starting-style:transform-[scale(0.98)] data-ending-style:opacity-0',
              'data-ending-style:transform-[scale(0.98)] date-popup min-w-0 p-3',
            )}
          >
            <DayPicker
              mode="single"
              autoFocus
              showOutsideDays
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                onValueChange(date ? formatDay(date) : undefined)
                setOpen(false)
              }}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === 'left' ? <ChevronLeft size={14} /> : <ChevronRight size={14} />,
              }}
              classNames={{
                root: 'calendar relative text-[12px]',
                months: 'calendar-months',
                month: 'calendar-month',
                month_caption: 'calendar-caption flex items-center h-7 py-0 px-1',
                caption_label: 'calendar-caption-label font-medium text-strong',
                nav: 'calendar-nav absolute top-0 right-0 flex gap-[2px]',
                button_previous: calendarNavigationClasses,
                button_next: calendarNavigationClasses,
                month_grid: 'calendar-grid border-collapse mt-1.5',
                weekdays: 'calendar-weekdays',
                weekday: 'calendar-weekday w-8.5 h-7 text-[11px] font-normal text-faint',
                week: 'calendar-week',
                day: cn(
                  'calendar-day p-[1px] text-center [&.today_.calendar-day-button]:text-primary',
                  '[&.today_.calendar-day-button]:font-semibold [&.outside_.calendar-day-button]:text-faint',
                  '[&.selected_.calendar-day-button]:bg-primary-solid [&.selected_.calendar-day-button]:text-white',
                  '[&.selected_.calendar-day-button]:font-medium [&.disabled_.calendar-day-button]:opacity-40 [&.hidden]:invisible',
                ),
                day_button:
                  'calendar-day-button w-8 h-8 p-0 border-0 rounded-md bg-none bg-transparent text-foreground tabular-nums transition-[background] duration-100 ease-[ease] hover:bg-hover',
                selected: 'selected',
                today: 'today',
                outside: 'outside',
                disabled: 'disabled',
                hidden: 'hidden',
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
