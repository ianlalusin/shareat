
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { StoreSettings } from '@/lib/settings';

interface ServingTimeStatsProps {
  stats: {
    package: number;
    refill: number;
    addon: number;
  };
  idealTimes: StoreSettings['kitchen']['idealServingTimes'];
}

function StatLine({ label, value, ideal }: { label: string; value: number; ideal: number }) {
  const getColor = () => {
    if (value === 0) return 'text-muted-foreground';
    if (value <= ideal) return 'text-green-600';
    if (value <= ideal * 1.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className={cn('text-lg font-bold', getColor())}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export function ServingTimeStats({ stats, idealTimes }: ServingTimeStatsProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Avg. Serving Time (mins)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <StatLine label="Package" value={stats.package} ideal={idealTimes.package} />
        <StatLine label="Refill" value={stats.refill} ideal={idealTimes.refill} />
        <StatLine label="Add-ons" value={stats.addon} ideal={idealTimes.addon} />
      </CardContent>
    </Card>
  );
}
