
"use client"

import * as React from "react"
import { format, parse, isValid } from "date-fns"
import { DateRange } from "react-day-picker"
import { subDays, startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { autoformatDate, formatAndValidateDate, revertToInputFormat } from "@/lib/utils"


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
  const [fromString, setFromString] = React.useState(value?.from ? format(value.from, 'MM/dd/yyyy') : '');
  const [toString, setToString] = React.useState(value?.to ? format(value.to, 'MM/dd/yyyy') : '');
  const [preset, setPreset] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    setFromString(value?.from ? format(value.from, 'MM/dd/yyyy') : '');
    setToString(value?.to ? format(value.to, 'MM/dd/yyyy') : '');
  }, [value]);

  const handleManualDateUpdate = () => {
    const fromDate = parse(fromString, 'MM/dd/yyyy', new Date());
    const toDate = parse(toString, 'MM/dd/yyyy', new Date());
    
    if (isValid(fromDate) && isValid(toDate)) {
        onUpdate?.({ from: startOfDay(fromDate), to: endOfDay(toDate) });
        setPreset(undefined);
    }
  };

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = autoformatDate(e.target.value, fromString);
    setFromString(formatted);
  };
  
  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = autoformatDate(e.target.value, toString);
    setToString(formatted);
  };
  
  const handleBlur = (field: 'from' | 'to') => {
      const dateStr = field === 'from' ? fromString : toString;
      if (dateStr && !isValid(parse(dateStr, 'MM/dd/yyyy', new Date()))) {
        // Optionally show an error or just clear it if invalid
        console.error(`Invalid date format for ${field}: ${dateStr}`);
      } else {
        handleManualDateUpdate();
      }
  }

  const handlePresetChange = (presetValue: string) => {
    const newRange = getPresetRange(presetValue);
    setPreset(presetValue);
    if(onUpdate) {
        onUpdate(newRange);
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center gap-2">
         <Input
            placeholder="MM/DD/YYYY"
            value={fromString}
            onChange={handleFromChange}
            onBlur={() => handleBlur('from')}
            className="w-[120px]"
        />
        <span className="text-muted-foreground">to</span>
        <Input
            placeholder="MM/DD/YYYY"
            value={toString}
            onChange={handleToChange}
            onBlur={() => handleBlur('to')}
            className="w-[120px]"
        />
        
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
