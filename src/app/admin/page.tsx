
'use client';

import * as React from 'react';
import { addDays, format, subDays, startOfMonth, endOfMonth, isSameDay } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
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
    label: 'Last 30 days',
    getValue: () => ({ from: subDays(new Date(), 29), to: new Date() }),
  },
  {
    label: 'Current month',
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    }),
  },
];

export default function AdminPage() {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 6),
    to: new Date(),
  });
  const [isOpen, setIsOpen] = React.useState(false);

  const handlePresetClick = (preset: (typeof PRESETS)[0]) => {
    setDate(preset.getValue());
  };

  const handleApply = () => {
    console.log('Applied date range:', date);
    setIsOpen(false);
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
            {PRESETS.slice(0, 4).map((preset) => (
                <Button 
                    key={preset.label}
                    variant={isPresetActive(preset) ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetClick(preset)}
                    className="hidden md:inline-flex"
                >
                    {preset.label}
                </Button>
            ))}
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                <Button
                    id="date"
                    variant={'outline'}
                    size="sm"
                    className={cn(
                    'w-[240px] justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date?.from ? (
                    date.to ? (
                        <>
                        {format(date.from, 'LLL dd, y')} -{' '}
                        {format(date.to, 'LLL dd, y')}
                        </>
                    ) : (
                        format(date.from, 'LLL dd, y')
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
                            variant={isPresetActive(preset) ? 'secondary' : 'ghost'}
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
