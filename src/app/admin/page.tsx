'use client';

import * as React from 'react';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { DateRange } from 'react-day-picker';


export default function AdminPage() {
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>();

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Dashboard
        </h1>
        <DateRangePicker onUpdate={setDateRange} />
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
