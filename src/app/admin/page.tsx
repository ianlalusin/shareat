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

export default function AdminPage() {

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Dashboard
        </h1>
        <Collapsible className="flex items-center gap-2">
            <Button variant="outline" size="sm">Today</Button>
             <CollapsibleTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                    <ChevronRight className="h-4 w-4" />
                    <span className="sr-only">Toggle date presets</span>
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent asChild>
                 <div className="flex items-center gap-2 animate-in fade-in duration-300">
                    <Button variant="outline" size="sm">Yesterday</Button>
                    <Button variant="outline" size="sm">Last 7 Days</Button>
                    <Button variant="outline" size="sm">Last Month</Button>
                    <Button variant="outline" size="sm">Custom</Button>
                </div>
            </CollapsibleContent>
        </Collapsible>
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
