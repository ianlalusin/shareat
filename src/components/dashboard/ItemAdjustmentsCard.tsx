"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { DailyMetric } from "@/lib/types";
import { Scissors, Gift, Tag, RotateCcw, ArrowRight } from "lucide-react";

interface ItemAdjustmentsCardProps {
  dailyMetrics: DailyMetric[];
}

type AdjStat = {
  qty: number;
  amount: number;
};

function StatRow({ icon, label, qty, amount, color }: {
  icon: React.ReactNode;
  label: string;
  qty: number;
  amount: number;
  color: string;
}) {
  return (
    <div className={`flex items-center justify-between py-3 border-b last:border-0`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-md ${color}`}>
          {icon}
        </div>
        <div>
          <p className="font-medium text-sm">{label}</p>
          <p className="text-xs text-muted-foreground">{qty} item{qty !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <p className="font-semibold text-sm">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
    </div>
  );
}

export function ItemAdjustmentsCard({ dailyMetrics }: ItemAdjustmentsCardProps) {
  const router = useRouter();
  const stats = useMemo(() => {
    const totals = {
      voidedQty: 0, voidedAmount: 0,
      freeQty: 0, freeAmount: 0,
      discountedQty: 0, discountedAmount: 0,
      refundCount: 0, refundTotal: 0,
    };
    for (const m of dailyMetrics) {
      const items = (m as any).items;
      if (!items) continue;
      totals.voidedQty += items.voidedQty || 0;
      totals.voidedAmount += items.voidedAmount || 0;
      totals.freeQty += items.freeQty || 0;
      totals.freeAmount += items.freeAmount || 0;
      totals.discountedQty += items.discountedQty || 0;
      totals.discountedAmount += items.discountedAmount || 0;
      totals.refundCount += items.refundCount || 0;
      totals.refundTotal += items.refundTotal || 0;
    }
    return totals;
  }, [dailyMetrics]);

  const hasData = stats.voidedQty > 0 || stats.freeQty > 0 || stats.discountedQty > 0 || stats.refundCount > 0;

  return (
    <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => router.push("/logs")}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Item Adjustments</CardTitle>
            <CardDescription>Voided, discounted, free, and refunded items for the period.</CardDescription>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-center text-muted-foreground py-6 text-sm">No adjustments for this period.</p>
        ) : (
          <div>
            <StatRow
              icon={<Scissors className="h-4 w-4 text-red-600" />}
              label="Voided Items"
              qty={stats.voidedQty}
              amount={stats.voidedAmount}
              color="bg-red-50"
            />
            <StatRow
              icon={<Tag className="h-4 w-4 text-amber-600" />}
              label="Discounted Items"
              qty={stats.discountedQty}
              amount={stats.discountedAmount}
              color="bg-amber-50"
            />
            <StatRow
              icon={<Gift className="h-4 w-4 text-green-600" />}
              label="Free Items"
              qty={stats.freeQty}
              amount={stats.freeAmount}
              color="bg-green-50"
            />
            <StatRow
              icon={<RotateCcw className="h-4 w-4 text-blue-600" />}
              label="Refunds Issued"
              qty={stats.refundCount}
              amount={stats.refundTotal}
              color="bg-blue-50"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
