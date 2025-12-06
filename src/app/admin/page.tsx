
'use client';

import * as React from 'react';
import { addDays, format, subDays, startOfMonth, endOfMonth, isSameDay, subMonths } from 'date-fns';
import { Calendar as CalendarIcon, ChevronRight } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const PRESETS = [
  { label: 'Today', getValue: () => ({ from: new Date(), to: new Date() }) },
  {
    label: 'Yesterday',
    getValue: () => ({
      from: subDays(new Date(), 1),
      to: subDays(new Date(), 1),
    }),
  },
  {
    label: 'Last 7 days',
    getValue: () => ({ from: subDays(new Date(), 6), to: new Date() }),
  },
  {
    label: 'Last Month',
    getValue: () => {
        const lastMonth = subMonths(new Date(), 1);
        return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
  },
];

export default function AdminPage() {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 6),
    to: new Date(),
  });

  const handlePresetClick = (preset: (typeof PRESETS)[0]) => {
    setDate(preset.getValue());
  };
  
  const isPresetActive = (preset: (typeof PRESETS)[0]) => {
    const presetRange = preset.getValue();
    return (
      date?.from &&
      date?.to &&
      isSameDay(presetRange.from, date.from) &&
      isSameDay(presetRange.to, date.to)
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Dashboard
        </h1>
        <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">Today</Button>
            <Button variant="outline" size="icon" className="h-9 w-9">
                <ChevronRight className="h-4 w-4" />
            </Button>
            {/* The buttons below will be part of the collapsible section */}
            {/* <Button variant="outline" size="sm">Yesterday</Button>
            <Button variant="outline" size="sm">Last 7 Days</Button>
            <Button variant="outline" size="sm">Last Month</Button>
            <Button variant="outline" size="sm">Custom</Button> */}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm bg-background">
        <div className="flex flex-col items-center gap-1 text-center">
          <h3 className="text-2xl font-bold tracking-tight font-headline">
            Dashboard Content
          </h3>
          <p className="text-sm text-muted-foreground">
            Your dashboard components will be displayed here.
          </p>
        </div>
      </div>
    </main>
  );
}
