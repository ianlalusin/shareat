
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

// Infer the type from the CompactCalendar's onChange prop
type CalendarRange = Parameters<
  React.ComponentProps<typeof CompactCalendar>["onChange"]
>[0]

export function DateRangePicker({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  // Use the inferred type for the state
  const [date, setDate] = React.useState<CalendarRange | undefined>({
    start: new Date(),
    end: new Date(),
  })

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
            onChange={(range) => {
              // Safely handle potentially incomplete ranges
              if (!range?.start || !range?.end) {
                setDate(undefined)
                return
              }
              setDate(range)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
