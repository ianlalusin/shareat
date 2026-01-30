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
import { rebuildOpPagesForRange, type RebuildOpPagesResult } from "@/lib/ops/rebuild-op-pages";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, DatabaseZap } from "lucide-react";
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
    const [isRebuildingOps, setIsRebuildingOps] = useState(false);
    
    const [startDate, setStartDate] = useState(() => format(addDays(new Date(), -2), 'yyyy-MM-dd'));
    const [endDate, setEnddate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [rebuildResult, setRebuildResult] = useState<RebuildOpPagesResult | null>(null);
    
    const { config: storeConfig, isLoading: isConfigLoading } = useStoreConfigDoc(activeStore?.id);

    const lastUpdated = storeConfig?.meta?.updatedAt ? toJsDate(storeConfig.meta.updatedAt) : null;

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

    const handleRebuildOps = async () => {
        if (!activeStore || !appUser) return;

        const start = startOfDay(new Date(startDate)).getTime();
        const end = endOfDay(new Date(endDate)).getTime();
        
        const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
        if (daysDiff > 14 && !appUser.isPlatformAdmin) {
            toast({ variant: 'destructive', title: 'Range Too Large', description: 'Managers are limited to a 14-day rebuild range.' });
            return;
        }

        if (!(await confirm({
            title: "Rebuild Operational Projections?",
            description: "This will scan sessions and tickets in the selected range to fix KDS counts and history. Existing active KDS projections for these stations will be overwritten.",
            confirmText: "Yes, Rebuild Ops"
        }))) return;

        setIsRebuildingOps(true);
        setRebuildResult(null);
        
        try {
            const res = await rebuildOpPagesForRange(db, {
                storeId: activeStore.id,
                startMs: start,
                endMs: end,
                actorUid: appUser.uid
            });
            setRebuildResult(res);
            if (res.errors.length === 0) {
                toast({ title: "Rebuild Complete" });
            } else {
                toast({ variant: 'destructive', title: "Rebuild Completed with Errors" });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Process Failed", description: error.message });
        } finally {
            setIsRebuildingOps(false);
        }
    }
    
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

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-destructive">
                            <DatabaseZap className="h-5 w-5"/> Rebuild OpPages (KDS Projections)
                        </CardTitle>
                        <CardDescription>
                            Fixes stuck KDS counts or missing history by rescanning session truth data. 
                            Use this if KDS stations show incorrect "Active" counts.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="start-date">Start Date</Label>
                                <Input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="end-date">End Date</Label>
                                <Input id="end-date" type="date" value={endDate} onChange={e => setEnddate(e.target.value)} />
                            </div>
                        </div>

                        {rebuildResult && (
                            <Alert variant={rebuildResult.errors.length > 0 ? "destructive" : "default"} className={rebuildResult.errors.length === 0 ? "border-green-500 bg-green-50 dark:bg-green-900/10" : ""}>
                                {rebuildResult.errors.length === 0 ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4" />}
                                <AlertTitle>{rebuildResult.errors.length > 0 ? "Partial Success" : "Rebuild Successful"}</AlertTitle>
                                <AlertDescription className="text-xs space-y-1 mt-2">
                                    <p>• Sessions scanned: {rebuildResult.scannedSessions}</p>
                                    <p>• Tickets processed: {rebuildResult.scannedTickets}</p>
                                    <p>• Stations updated: {rebuildResult.stationsUpdated}</p>
                                    <p>• Active projections written: {rebuildResult.activeTicketsWritten}</p>
                                    <p>• Deleted stale projections: {rebuildResult.deletedActiveTickets}</p>
                                    {rebuildResult.errors.map((err, i) => (
                                        <p key={i} className="text-destructive font-semibold">Error: {err}</p>
                                    ))}
                                </AlertDescription>
                            </Alert>
                        )}

                        <Button 
                            variant="destructive" 
                            onClick={handleRebuildOps} 
                            disabled={isRebuildingOps || !activeStore} 
                            className="w-full"
                        >
                            {isRebuildingOps ? <Loader2 className="mr-2 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            {isRebuildingOps ? "Rebuilding Operational Pages..." : "Rescan & Rebuild OpPages"}
                        </Button>
                    </CardContent>
                </Card>
            </div>
            {ConfirmDialog}
        </RoleGuard>
    );
}
