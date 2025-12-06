
"use client"

import * as React from "react"
import { addDays, format, subDays, startOfMonth, endOfMonth } from "date-fns"
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

const PRESETS = [
  { label: "Today", getValue: () => ({ from: new Date(), to: new Date() }) },
  { label: "Yesterday", getValue: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
  { label: "Last 7 days", getValue: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: "Last 30 days", getValue: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: "Current month", getValue: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
]


export function DateRangePicker({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 6),
    to: new Date(),
  })
  const [isOpen, setIsOpen] = React.useState(false)

  const handlePresetClick = (preset: typeof PRESETS[0]) => {
    setDate(preset.getValue())
  }
  
  const handleApply = () => {
    // Here you would typically call a function passed via props
    // to update the parent component's state, e.g., onUpdate(date)
    console.log("Applied date range:", date);
    setIsOpen(false);
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[260px] justify-start text-left font-normal",
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
            <div className="flex">
                <div className="flex flex-col space-y-2 border-r p-4">
                    {PRESETS.map((preset) => (
                        <Button
                        key={preset.label}
                        onClick={() => handlePresetClick(preset)}
                        variant="ghost"
                        className="w-full justify-start"
                        >
                        {preset.label}
                        </Button>
                    ))}
                </div>
                <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={date?.from}
                    selected={date}
                    onSelect={setDate}
                    numberOfMonths={2}
                />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
                <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                <Button onClick={handleApply}>Apply</Button>
            </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
