
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, addDays, startOfDay, endOfDay } from "date-fns";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useStoreConfigDoc } from "@/hooks/useStoreConfigDoc";
import { rebuildStoreConfig } from "@/lib/manager/dataManagement";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, DatabaseZap, TrendingUp } from "lucide-react";
import { toJsDate } from "@/lib/utils/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function DataManagementPage() {
    const router = useRouter();
    const { appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const { toast } = useToast();
    const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
    
    const [isRebuildingConfig, setIsRebuildingConfig] = useState(false);
    const [isBackfilling, setIsBackfilling] = useState(false);
    const [backfillResult, setBackfillResult] = useState<null | {
      scanned: number;
      filled: number;
      skippedAlreadySet: number;
      skippedNoForecast: number;
      skippedNoAnalytics: number;
      skippedZeroSales: number;
    }>(null);

    const { config: storeConfig, isLoading: isConfigLoading } = useStoreConfigDoc(activeStore?.id);

    const lastUpdated = storeConfig?.meta?.updatedAt ? toJsDate(storeConfig.meta.updatedAt) : null;

    const handleBackfillAccuracy = async () => {
        if (!activeStore || !appUser) return;
        if (!(await confirm({
            title: "Backfill Forecast Accuracy?",
            description: "Scans the last 14 days of forecasts and computes accuracy for any day that has matching analytics but no accuracy yet. Safe to run; updates only forecast docs.",
            confirmText: "Yes, Backfill",
        }))) return;

        setIsBackfilling(true);
        setBackfillResult(null);
        try {
            const { getAuth } = await import("firebase/auth");
            const idToken = await getAuth().currentUser?.getIdToken();
            if (!idToken) throw new Error("Not authenticated.");
            const res = await fetch("/api/admin/backfill-forecast-accuracy", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ storeId: activeStore.id, days: 14 }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Backfill failed.");
            setBackfillResult({
                scanned: json.scanned,
                filled: json.filled,
                skippedAlreadySet: json.skippedAlreadySet,
                skippedNoForecast: json.skippedNoForecast,
                skippedNoAnalytics: json.skippedNoAnalytics,
                skippedZeroSales: json.skippedZeroSales,
            });
            toast({
                title: json.filled > 0 ? `Filled ${json.filled} day(s)` : "No gaps found",
                description: `Scanned ${json.scanned} days. ${json.skippedNoAnalytics > 0 ? `${json.skippedNoAnalytics} had no analytics. ` : ""}${json.skippedZeroSales > 0 ? `${json.skippedZeroSales} had zero sales.` : ""}`,
            });
        } catch (err: any) {
            toast({ variant: "destructive", title: "Backfill Failed", description: err.message });
        } finally {
            setIsBackfilling(false);
        }
    };

    const handleRebuildConfig = async () => {
        if (!activeStore) return;
        if (!(await confirm({
            title: "Rebuild Configuration Cache?",
            description: "This will refresh the quick-load document used by the POS. It's safe but may briefly affect POS performance.",
            confirmText: "Yes, Rebuild"
        }))) return;

        setIsRebuildingConfig(true);
        toast({ title: "Rebuilding Cache...", description: "This may take a moment." });
        try {
            await rebuildStoreConfig(db, activeStore.id);
            toast({ title: "Success!", description: "The store configuration cache has been rebuilt." });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Rebuild Failed", description: error.message });
        } finally {
            setIsRebuildingConfig(false);
        }
    };
    
    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Data Management" description="Tools for maintaining and optimizing store data.">
                 <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
            </PageHeader>
            
            <div className="grid gap-6 mt-6 max-w-4xl">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            Forecast Accuracy Backfill
                        </CardTitle>
                        <CardDescription>
                            The daily cron only fills yesterday's accuracy. If it missed a day (cron outage, zero-sales day, missing analytics), that day's accuracy stays blank forever. This tool scans the last 14 days and fills any gap where analytics now exist.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 bg-muted rounded-lg text-sm">
                            <p><span className="font-semibold">Current Store:</span> {activeStore?.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">Safe to run anytime. Only updates forecast docs that already exist and are missing accuracy.</p>
                        </div>

                        {backfillResult && (
                            <Alert>
                                <CheckCircle2 className="h-4 w-4" />
                                <AlertTitle>Backfill Complete</AlertTitle>
                                <AlertDescription>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                                        <div>Scanned: <span className="font-bold">{backfillResult.scanned}</span> days</div>
                                        <div>Filled: <span className="font-bold text-green-700">{backfillResult.filled}</span></div>
                                        <div>Already set: <span className="font-bold">{backfillResult.skippedAlreadySet}</span></div>
                                        <div>No forecast doc: <span className="font-bold">{backfillResult.skippedNoForecast}</span></div>
                                        <div>No analytics: <span className="font-bold">{backfillResult.skippedNoAnalytics}</span></div>
                                        <div>Zero sales: <span className="font-bold">{backfillResult.skippedZeroSales}</span></div>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        )}

                        <Button onClick={handleBackfillAccuracy} disabled={isBackfilling || !activeStore} className="w-full">
                            {isBackfilling ? <Loader2 className="mr-2 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
                            Backfill Last 14 Days
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Store Configuration Cache</CardTitle>
                        <CardDescription>
                            The app uses a single 'config' document to load tables, packages, discounts, etc. quickly. 
                            If you've made manual changes or suspect data is out of sync, you can rebuild this cache.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 bg-muted rounded-lg text-sm">
                            <p><span className="font-semibold">Current Store:</span> {activeStore?.name}</p>
                            <p><span className="font-semibold">Last Rebuilt:</span> {isConfigLoading ? 'Loading...' : (lastUpdated ? format(lastUpdated, "PPP p") : 'Never')}</p>
                        </div>
                        <Button onClick={handleRebuildConfig} disabled={isRebuildingConfig || !activeStore} className="w-full">
                            {isRebuildingConfig ? <Loader2 className="mr-2 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Rebuild Configuration Cache
                        </Button>
                    </CardContent>
                </Card>
            </div>
            {ConfirmDialog}
        </RoleGuard>
    );
}
