"use client";

import { useForecastAnalytics } from '@/hooks/useForecastAnalytics';
import { useStoreContext } from '@/context/store-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ForecastAccuracyCard() {
    const { activeStore } = useStoreContext();
    const { accuracy, isLoading } = useForecastAnalytics(activeStore?.id, activeStore?.address);
    
    const accuracyPercent = accuracy !== null ? (accuracy * 100).toFixed(1) : null;
    const accuracyColor = accuracy !== null 
        ? accuracy > 0.85 ? 'text-green-600' : accuracy > 0.7 ? 'text-amber-600' : 'text-red-600'
        : 'text-muted-foreground';

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp />
                    Forecast Accuracy
                </CardTitle>
                <CardDescription>
                    Weekly average forecast vs. actual sales.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex justify-center items-center h-16">
                        <Loader2 className="animate-spin" />
                    </div>
                ) : accuracyPercent !== null ? (
                     <p className={cn("text-4xl font-bold text-center", accuracyColor)}>
                        {accuracyPercent}%
                    </p>
                ) : (
                    <p className="text-center text-muted-foreground pt-4">
                        Not enough data to calculate accuracy yet.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
