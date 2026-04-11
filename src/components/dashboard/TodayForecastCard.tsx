
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
  return `₱${value.toFixed(0)}`;
}

interface TodayForecastCardProps {
    projectedSales: number | null;
    confidence?: string | null;
    actualSalesToday?: number | null;
    isLoading: boolean;
}

function getTimeOfDayFraction(): number {
  const now = new Date();
  // Assume store hours roughly 10am-10pm (12 hours)
  const openHour = 10;
  const closeHour = 22;
  const currentHour = now.getHours() + now.getMinutes() / 60;
  if (currentHour <= openHour) return 0;
  if (currentHour >= closeHour) return 1;
  return (currentHour - openHour) / (closeHour - openHour);
}

function getPacingLabel(actual: number, projected: number, timeFraction: number): { label: string; color: string } {
  if (timeFraction <= 0 || projected <= 0) return { label: "", color: "" };
  const expectedSoFar = projected * timeFraction;
  const ratio = actual / expectedSoFar;
  if (ratio >= 1.1) return { label: "Ahead", color: "text-green-600" };
  if (ratio >= 0.9) return { label: "On track", color: "text-blue-600" };
  return { label: "Behind", color: "text-amber-600" };
}

function confidenceBadge(confidence?: string | null) {
  if (!confidence) return null;
  const variant = confidence === "high" ? "default" : confidence === "low" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0">
      {confidence}
    </Badge>
  );
}

export function TodayForecastCard({ projectedSales, confidence, actualSalesToday, isLoading }: TodayForecastCardProps) {
    const timeFraction = getTimeOfDayFraction();
    const actual = actualSalesToday ?? 0;
    const pacing = projectedSales ? getPacingLabel(actual, projectedSales, timeFraction) : null;
    const progressPct = projectedSales && projectedSales > 0 ? Math.min(100, Math.round((actual / projectedSales) * 100)) : 0;

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Target />
                    Today's Forecast
                    {confidenceBadge(confidence)}
                </CardTitle>
                <CardDescription>
                    Projected net sales for today.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex justify-center items-center h-16">
                        <Loader2 className="animate-spin" />
                    </div>
                ) : projectedSales !== null ? (
                    <div className="space-y-3">
                        <p className="text-4xl font-bold text-center">
                            {formatCurrency(projectedSales)}
                        </p>
                        {actualSalesToday != null && actualSalesToday > 0 && (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        Actual: <span className="font-mono font-medium text-foreground">{formatCurrency(actual)}</span>
                                    </span>
                                    {pacing && pacing.label && (
                                        <span className={cn("font-semibold text-xs", pacing.color)}>
                                            {pacing.label}
                                        </span>
                                    )}
                                </div>
                                <Progress value={progressPct} className="h-2" />
                                <p className="text-[11px] text-muted-foreground text-center">{progressPct}% of forecast</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-center text-muted-foreground pt-4">
                        No forecast available for today.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
