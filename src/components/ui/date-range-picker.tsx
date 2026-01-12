
"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import CompactCalendar from "@/components/ui/CompactCalendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Safely infer the type of the 'onChange' prop, accounting for it being optional.
type CalendarOnChange = NonNullable<
  React.ComponentProps<typeof CompactCalendar>["onChange"]
>;
type CalendarRange = Parameters<CalendarOnChange>[0];

interface DateRangePickerProps extends React.HTMLAttributes<HTMLDivElement> {
    onDateChange: (range: { start: Date, end: Date }) => void;
}


export function DateRangePicker({
  className,
  onDateChange,
}: DateRangePickerProps) {
  const [date, setDate] = React.useState<CalendarRange | undefined>({
    start: new Date(),
    end: new Date(),
  })

  const handleApply = (range: CalendarRange, preset: string) => {
    if (range.start && range.end) {
      setDate(range);
      onDateChange({start: range.start, end: range.end});
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[300px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.start ? (
              date.end ? (
                <>
                  {format(date.start, "LLL dd, y")} -{" "}
                  {format(date.end, "LLL dd, y")}
                </>
              ) : (
                format(date.start, "LLL dd, y")
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CompactCalendar
            onChange={handleApply}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
