'use client';

import * as React from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';

export default function AdminPage() {
  const [showCustomPicker, setShowCustomPicker] = React.useState(false);
  const [date, setDate] = React.useState<DateRange | undefined>();
  const [startDateInput, setStartDateInput] = React.useState('');
  const [endDateInput, setEndDateInput] = React.useState('');


  const handleCustomClick = () => {
    setShowCustomPicker(true);
    setStartDateInput(date?.from ? format(date.from, 'MM/dd/yyyy') : '');
    setEndDateInput(date?.to ? format(date.to, 'MM/dd/yyyy') : '');
  };

  const handlePresetClick = () => {
    setShowCustomPicker(false);
    // Here you would also set the date based on the preset
  };
  
  const handleApplyCustomDate = () => {
      // Basic validation can be added here
      const from = new Date(startDateInput);
      const to = new Date(endDateInput);
      setDate({ from, to });
      setShowCustomPicker(false);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Dashboard
        </h1>
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="outline" size="sm" onClick={handlePresetClick}>
            Today
          </Button>
          <Collapsible>
            <div className="flex items-start gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9 data-[state=open]:rotate-90">
                    <ChevronRight className="h-4 w-4 transition-transform" />
                    <span className="sr-only">Toggle date presets</span>
                  </Button>
                </CollapsibleTrigger>
              <CollapsibleContent asChild>
                <div className="flex flex-col items-start gap-2 sm:flex-row animate-in fade-in duration-300">
                  {!showCustomPicker ? (
                    <>
                      <Button variant="outline" size="sm" onClick={handlePresetClick}>
                        Yesterday
                      </Button>
                      <Button variant="outline" size="sm" onClick={handlePresetClick}>
                        Last 7 Days
                      </Button>
                      <Button variant="outline" size="sm" onClick={handlePresetClick}>
                        Last Month
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCustomClick}>
                        Custom
                      </Button>
                    </>
                  ) : (
                     <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm">
                        <div className="flex items-center gap-4">
                           <div className="grid gap-2">
                                <Label htmlFor="start-date">Start date</Label>
                                <Input id="start-date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} placeholder="mm/dd/yyyy" />
                           </div>
                            <div className="grid gap-2">
                                <Label htmlFor="end-date">End date</Label>
                                <Input id="end-date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} placeholder="mm/dd/yyyy" />
                            </div>
                        </div>
                         <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setShowCustomPicker(false)}>Cancel</Button>
                            <Button onClick={handleApplyCustomDate}>Apply</Button>
                         </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
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
