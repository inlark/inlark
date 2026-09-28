import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import { DayPicker } from 'react-day-picker'
import { cn } from '../lib/utils'
import { Calendar, ChevronLeft, ChevronRight, X } from '../icons'

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
      <div className={cn('date-picker', className)}>
        <Popover.Trigger className="select-trigger date-trigger" aria-label={ariaLabel}>
          <Calendar size={14} className="date-trigger-icon" />
          <span className={cn('select-value', !selected && 'placeholder')}>
            {selected
              ? selected.toLocaleDateString(undefined, { dateStyle: 'medium' })
              : placeholder}
          </span>
        </Popover.Trigger>
        {selected && (
          <button
            type="button"
            className="date-clear"
            aria-label={'Clear ' + (ariaLabel || 'date')}
            onClick={() => onValueChange(undefined)}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="date-positioner">
          <Popover.Popup className="dropdown date-popup">
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
                root: 'calendar',
                months: 'calendar-months',
                month: 'calendar-month',
                month_caption: 'calendar-caption',
                caption_label: 'calendar-caption-label',
                nav: 'calendar-nav',
                button_previous: 'button button-ghost button-icon calendar-nav-button',
                button_next: 'button button-ghost button-icon calendar-nav-button',
                month_grid: 'calendar-grid',
                weekdays: 'calendar-weekdays',
                weekday: 'calendar-weekday',
                week: 'calendar-week',
                day: 'calendar-day',
                day_button: 'calendar-day-button',
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
