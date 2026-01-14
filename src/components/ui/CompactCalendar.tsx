
"use client";

import * as React from "react";
import { format, addDays, startOfWeek, startOfMonth } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";

interface CompactCalendarProps {
  onChange: (range: { start: Date; end: Date }, preset: string | null) => void;
}

const presets = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "lastWeek", label: "Last Week" },
  { id: "lastMonth", label: "Last Month" },
];

export default function CompactCalendar({ onChange }: CompactCalendarProps) {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });

  const handlePresetClick = (preset: string) => {
    const now = new Date();
    let from, to;

    switch (preset) {
      case "today":
        from = to = now;
        break;
      case "yesterday":
        from = to = addDays(now, -1);
        break;
      case "lastWeek":
        from = startOfWeek(addDays(now, -7));
        to = addDays(from, 6);
        break;
      case "lastMonth":
        from = startOfMonth(addDays(now, -30));
        to = addDays(from, 29);
        break;
      default:
        return;
    }
    setDate({ from, to });
    onChange({ start: from, end: to }, preset);
  };

  const handleDateSelect = (range: DateRange | undefined) => {
    setDate(range);
    if (range?.from && range.to) {
      onChange({ start: range.from, end: range.to }, "custom");
    }
  }

  return (
    <div className="flex flex-col sm:flex-row">
      <div className="flex flex-col gap-2 p-4 border-b sm:border-b-0 sm:border-r">
        {presets.map(({ id, label }) => (
          <Button key={id} variant="ghost" onClick={() => handlePresetClick(id)}>
            {label}
          </Button>
        ))}
      </div>
      <Calendar
        initialFocus
        mode="range"
        defaultMonth={date?.from}
        selected={date}
        onSelect={handleDateSelect}
        numberOfMonths={1}
      />
    </div>
  );
}
