
"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMemo } from "react";
import type { DailyMetric } from "./types";

export type PaymentMethodTally = { [methodName: string]: number };

interface PaymentMixProps {
    dailyMetrics: DailyMetric[];
    isLoading: boolean;
}

export function PaymentMix({ dailyMetrics, isLoading }: PaymentMixProps) {
    
    const aggregatedTally = useMemo(() => {
        const tally: PaymentMethodTally = {};
        if (dailyMetrics) {
            dailyMetrics.forEach(metric => {
                if (metric.payments?.byMethod) {
                    for (const [method, amount] of Object.entries(metric.payments.byMethod)) {
                        tally[method] = (tally[method] || 0) + amount;
                    }
                }
            });
        }
        return Object.entries(tally).sort(([, a], [, b]) => b - a);
    }, [dailyMetrics]);
    
    if (isLoading) {
        return (
            <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex justify-between">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-5 w-16" />
                    </div>
                ))}
            </div>
        )
    }
    
    if (aggregatedTally.length === 0) {
        return <p className="text-center text-muted-foreground py-10">No payments recorded in this range.</p>
    }

    return (
        <div className="space-y-2 text-sm">
            {aggregatedTally.map(([method, amount]) => (
                <div key={method} className="flex justify-between items-center">
                    <span className="font-medium capitalize">{method}</span>
                    <span className="text-muted-foreground">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            ))}
        </div>
    );
}

    