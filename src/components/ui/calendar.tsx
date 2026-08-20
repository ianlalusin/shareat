
"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

/**
 * These `classNames` keys are react-day-picker **v9** (see `UI`, `DayFlag` and
 * `SelectionState` in the package). They are not interchangeable with v8's:
 * v9 renamed `caption`→`month_caption`, `table`→`month_grid`,
 * `head_row`/`head_cell`→`weekdays`/`weekday`, `row`→`week`,
 * `nav_button_previous`/`_next`→`button_previous`/`button_next`, and dropped the
 * `day_` prefix on state keys (`day_selected`→`selected`, and so on).
 *
 * Two traps, both of which this file previously fell into:
 *
 * 1. v9 silently ignores keys it does not recognise, so a leftover v8 map does
 *    not fail — it just renders an unstyled table with the weekday header and
 *    the date grid out of alignment and the nav buttons floating. Nothing
 *    imports react-day-picker's own stylesheet, so these classes are the ONLY
 *    styling the calendar gets.
 * 2. `day` moved. In v8 it was the button; in v9 it is the `<td>` gridcell and
 *    the button is `day_button`. State modifiers (`selected`, `today`, …) land
 *    on that `<td>` too, along with matching `data-*` attributes — hence the
 *    `[&>button]` reach-throughs below, which stop the ghost button's own
 *    background from covering the cell's selected/today colour.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const navButton = cn(
    buttonVariants({ variant: "outline" }),
    "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-30"
  )

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        // `nav` is a sibling of the months, so `months` is the positioning
        // context the absolute nav row anchors to.
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-4",
        nav: "absolute inset-x-0 top-0 flex h-7 items-center justify-between",
        button_previous: navButton,
        button_next: navButton,
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal"
        ),
        selected: cn(
          "rounded-md bg-primary text-primary-foreground",
          "[&>button]:bg-transparent [&>button]:text-primary-foreground",
          "[&>button:hover]:bg-transparent [&>button:hover]:text-primary-foreground"
        ),
        // Selected wins when a day is both, rather than relying on class order.
        today: cn(
          "rounded-md bg-accent text-accent-foreground",
          "data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
        ),
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        range_start: "rounded-l-md rounded-r-none",
        range_end: "rounded-r-md rounded-l-none",
        range_middle: cn(
          "rounded-none bg-accent text-accent-foreground",
          "[&>button]:bg-transparent [&>button]:text-accent-foreground",
          "[&>button:hover]:bg-transparent"
        ),
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...props }: any) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
