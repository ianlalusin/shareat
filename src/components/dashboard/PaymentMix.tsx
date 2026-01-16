
"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMemo } from "react";
import type { DailyMetric } from "@/lib/types";

export type PaymentMethodTally = { [methodName: string]: number };

interface PaymentMixProps {
    data: PaymentMethodTally;
    isLoading: boolean;
}

export function PaymentMix({ data, isLoading }: PaymentMixProps) {
    
    const sortedTally = useMemo(() => {
        return Object.entries(data).sort(([, a], [, b]) => b - a);
    }, [data]);
    
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
    
    if (sortedTally.length === 0) {
        return <p className="text-center text-muted-foreground py-10">No payments recorded in this range.</p>
    }

    return (
        <div className="space-y-2">
            {sortedTally.map(([method, amount]) => (
                <div key={method} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm capitalize">{method}</div>
                    </div>
                    <div className="shrink-0 text-sm font-medium tabular-nums">
                        ₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>
            ))}
        </div>
    );
}
