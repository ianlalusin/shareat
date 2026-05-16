"use client";

import { useState } from "react";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDataAnalysis, type DataAnalysisRange } from "@/hooks/use-data-analysis";
import { RangeSelector } from "./RangeSelector";
import { KpiStrip } from "./KpiStrip";
import { ModeSplitCard } from "./ModeSplitCard";
import { SalesOverTimeCard } from "./SalesOverTimeCard";
import { ComparativeCard } from "./ComparativeCard";
import { BestWorstCard } from "./BestWorstCard";
import { BestTimeHeatmap } from "./BestTimeHeatmap";
import { SalesByDowCard } from "./SalesByDowCard";
import { TopSellersCard } from "./TopSellersCard";

export default function DataAnalysisPageClient() {
  const { activeStore } = useStoreContext();
  const [range, setRange] = useState<DataAnalysisRange>({ kind: "allTime" });

  const analysis = useDataAnalysis(activeStore?.id, range);

  if (!activeStore) {
    return (
      <Card className="w-full max-w-md mx-auto mt-10">
        <CardHeader>
          <CardTitle>No Store Selected</CardTitle>
          <CardDescription>Pick a store from the dropdown in the header to view its data analysis.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Data Analysis" description={`360° performance for ${activeStore.name}`} className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <RangeSelector value={range} availableYears={analysis.availableYears} onChange={setRange} />
          <Button variant="outline" size="sm" className="h-8" onClick={analysis.refresh} disabled={analysis.isLoading}>
            {analysis.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </PageHeader>

      {analysis.error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load analytics</AlertTitle>
          <AlertDescription>{analysis.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6">
        <KpiStrip totals={analysis.totals} isLoading={analysis.isLoading} />
        <ModeSplitCard modeSplit={analysis.modeSplit} />
        <SalesOverTimeCard salesOverTime={analysis.salesOverTime} />
        <ComparativeCard comparative={analysis.comparative} />
        <BestWorstCard bestWorst={analysis.bestWorst} />
        <SalesByDowCard salesByDow={analysis.salesByDow} />
        <BestTimeHeatmap bestTime={analysis.bestTime} />
        <TopSellersCard topSellers={analysis.topSellers} />
      </div>
    </RoleGuard>
  );
}
