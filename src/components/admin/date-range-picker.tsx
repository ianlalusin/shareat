
"use client"

import * as React from "react"
import { addDays, format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function DateRangePicker({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  })

  const handlePresetChange = (value: string) => {
    const now = new Date()
    switch (value) {
      case "today":
        setDate({ from: now, to: now });
        break;
      case "yesterday":
        setDate({ from: addDays(now, -1), to: addDays(now, -1) });
        break;
      case "last7":
        setDate({ from: addDays(now, -7), to: now });
        break;
      case "last30":
        setDate({ from: addDays(now, -30), to: now });
        break;
      default:
        setDate(undefined);
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
              "w-[240px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} -{" "}
                  {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
            <div className="flex items-center justify-center p-2">
                <Select onValueChange={handlePresetChange}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select a preset" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="yesterday">Yesterday</SelectItem>
                        <SelectItem value="last7">Last 7 days</SelectItem>
                        <SelectItem value="last30">Last 30 days</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="border-t">
                <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={date?.from}
                    selected={date}
                    onSelect={setDate}
                    numberOfMonths={2}
                />
            </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
