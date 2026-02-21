
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Target } from 'lucide-react';

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
  return `₱${value.toFixed(0)}`;
}

interface TodayForecastCardProps {
    projectedSales: number | null;
    isLoading: boolean;
}

export function TodayForecastCard({ projectedSales, isLoading }: TodayForecastCardProps) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Target />
                    Today's Forecast
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
                     <p className="text-4xl font-bold text-center">
                        {formatCurrency(projectedSales)}
                    </p>
                ) : (
                    <p className="text-center text-muted-foreground pt-4">
                        No forecast available for today.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
