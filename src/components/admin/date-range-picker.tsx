
"use client"

import * as React from "react"
import { format } from "date-fns"
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
import { subDays, startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns"


const PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "last7" },
  { label: "Last 30 days", value: "last30" },
  { label: "This month", value: "thisMonth" },
  { label: "Last month", value: "lastMonth" },
];

function getPresetRange(value: string): DateRange | undefined {
    const now = new Date();
    switch (value) {
        case "today":
            return { from: startOfDay(now), to: endOfDay(now) };
        case "yesterday":
            const yesterday = subDays(now, 1);
            return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
        case "last7":
            return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
        case "last30":
            return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
        case "thisMonth":
            return { from: startOfMonth(now), to: endOfDay(now) };
        case "lastMonth":
            const lastMonthStart = startOfMonth(subDays(startOfMonth(now), 1));
            return { from: lastMonthStart, to: endOfMonth(lastMonthStart) };
        default:
            return undefined;
    }
}


export function DateRangePicker({
  className,
  value,
  onUpdate,
}: React.HTMLAttributes<HTMLDivElement> & { value?: DateRange; onUpdate?: (range: DateRange | undefined) => void }) {
  const [date, setDate] = React.useState<DateRange | undefined>(value)
  const [preset, setPreset] = React.useState<string | undefined>(undefined);
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);

  React.useEffect(() => {
    setDate(value);
  }, [value]);

  const handleDateSelect = (newDate: DateRange | undefined) => {
    setDate(newDate);
    setPreset(undefined); // Clear preset when custom date is chosen
    if (onUpdate) {
      onUpdate(newDate);
    }
    // Close the popover after a date range is selected
    if (newDate?.from && newDate?.to) {
        setIsPopoverOpen(false);
    }
  }

  const handlePresetChange = (presetValue: string) => {
    const newRange = getPresetRange(presetValue);
    setPreset(presetValue);
    setDate(newRange);
    if(onUpdate) {
        onUpdate(newRange);
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center gap-2">
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
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
          <PopoverContent className="w-auto p-0 max-w-[700px]" align="center">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={handleDateSelect}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Presets" />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map(p => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
