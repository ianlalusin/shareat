'use client';

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { collection, onSnapshot, query, where, orderBy, collectionGroup } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Loader2, AlertCircle } from "lucide-react";
import { StartSessionForm, type Table } from "@/components/cashier/start-session-form";
import { ActiveSessionsGrid, type ActiveSession } from "@/components/cashier/active-sessions-grid";
import { PastSessionsCard } from "@/components/cashier/past-sessions-card";
import { isScheduleActiveNow } from "@/lib/utils/isScheduleActiveNow";
import { ApprovalQueue } from "@/components/cashier/ApprovalQueue";
import type { StorePackage, MenuSchedule } from "@/lib/types";
import { useStoreConfigDoc } from "@/hooks/useStoreConfigDoc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SyncSessionsTool } from "./SyncSessionsTool";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWeatherLogger } from "@/hooks/useWeatherLogger";
import { WeatherLoggerModal } from "@/components/shared/WeatherLoggerModal";

export function SessionListView() {
    const { appUser, isSigningOut } = useAuthContext();
    const { activeStore } = useStoreContext();
    const router = useRouter();

    const { config: storeConfig, isLoading: isConfigLoading, error: configError } = useStoreConfigDoc(activeStore?.id);

    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [sessions, setSessions] = useState<ActiveSession[]>([]);
    
    const [cachedTables, setCachedTables] = useState<any[]>([]);
    const [isLoadingTables, setIsLoadingTables] = useState(true);

    const { isModalOpen, closeModal } = useWeatherLogger();

    useEffect(() => {
        if (!activeStore?.id) {
            setCachedTables([]);
            setIsLoadingTables(false);
            return;
        }
        setIsLoadingTables(true);
        // This is a one-time fetch for a subcollection inside a singleton document.
        // It's not expected to change frequently, so onSnapshot is not essential here.
        // If it were, we would need to ensure the parent doc listener (`useStoreConfigDoc`)
        // triggers re-subscriptions or provides the data directly.
        const tablesCacheRef = collection(db, `stores/${activeStore.id}/storeConfig/current/tables`);
        const unsub = onSnapshot(tablesCacheRef, (snap) => {
            setCachedTables(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setIsLoadingTables(false);
        }, (err) => {
            console.error("Failed to load table cache", err);
            setIsLoadingTables(false);
        });
        return () => unsub();
    }, [activeStore?.id]);


    const sortedTables = useMemo(() => {
        return [...cachedTables]
            .filter(t => t.status === 'available' && t.isActive !== false)
            .sort((a, b) => {
                const numA = parseInt(a.tableNumber, 10);
                const numB = parseInt(b.tableNumber, 10);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return numA - numB;
                }
                return (a.tableNumber || '').localeCompare(b.tableNumber || '');
            });
    }, [cachedTables]);

    useEffect(() => {
        if (!activeStore) {
            setIsLoadingSessions(false);
            return;
        };
        setIsLoadingSessions(true);

        const handleError = (error: any) => {
            if (isSigningOut || !appUser) return;
            console.error("Session listener failed:", error);
        };
        
        // Fetch active sessions from the NEW projection collection
        const sessionsQuery = query(
            collection(db, "stores", activeStore.id, "activeSessions"),
            orderBy("startedAtClientMs", "asc")
        );

        const unsubscribe = onSnapshot(sessionsQuery, (snapshot) => {
            setSessions(snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    startedAtClientMs: data.startedAtClientMs ?? null,
                    startedAt: data.startedAt ?? null,
                } as ActiveSession
            }));
            setIsLoadingSessions(false);
        }, handleError);

        return () => unsubscribe();

    }, [activeStore, appUser, isSigningOut]);

    // Listen to billLines for all active sessions to compute adjustment badges
    const [adjustmentFlags, setAdjustmentFlags] = useState<Record<string, { hasVoids: boolean; hasFree: boolean; hasDiscounts: boolean }>>({});

    useEffect(() => {
        if (!activeStore?.id || sessions.length === 0) {
            setAdjustmentFlags({});
            return;
        }
        const unsubs: (() => void)[] = [];
        for (const s of sessions) {
            const linesRef = collection(db, "stores", activeStore.id, "sessions", s.id, "sessionBillLines");
            const unsub = onSnapshot(linesRef, (snap) => {
                let hasVoids = false, hasFree = false, hasDiscounts = false;
                snap.docs.forEach(d => {
                    const data = d.data();
                    if ((data.voidedQty ?? 0) > 0) hasVoids = true;
                    if ((data.freeQty ?? 0) > 0) hasFree = true;
                    if ((data.discountQty ?? 0) > 0 || (data.discountValue ?? 0) > 0) hasDiscounts = true;
                    // Check lineAdjustments for discounts
                    const adjs = data.lineAdjustments ?? {};
                    for (const adj of Object.values(adjs) as any[]) {
                        if (adj.kind === "discount") hasDiscounts = true;
                    }
                });
                setAdjustmentFlags(prev => ({ ...prev, [s.id]: { hasVoids, hasFree, hasDiscounts } }));
            }, (err) => { console.warn("[BillLines] Listener error for session", s.id, err); });
            unsubs.push(unsub);
        }
        return () => unsubs.forEach(u => u());
    }, [activeStore?.id, sessions]);

    const schedulesMap = useMemo(() => {
        if (!storeConfig?.schedules) return new Map<string, MenuSchedule>();
        return new Map(storeConfig.schedules.map(s => [s.id, s]));
    }, [storeConfig?.schedules]);

    const availablePackages = useMemo(() => {
        if (!storeConfig?.packages) return [];
        return storeConfig.packages.filter(pkg => {
            if (!pkg.isEnabled) return false;
            if (!pkg.menuScheduleId) return true; // Always available if no schedule
            const schedule = schedulesMap.get(pkg.menuScheduleId);
            if (!schedule) return true; // Fail open if schedule not found
            return isScheduleActiveNow(schedule);
        });
    }, [storeConfig?.packages, schedulesMap]);
    
    const enabledFlavors = useMemo(() => {
        if (!storeConfig?.flavors) return [];
        return storeConfig.flavors.filter(f => f.isEnabled !== false);
    }, [storeConfig?.flavors]);


    const isLoading = isConfigLoading || isLoadingSessions || isLoadingTables;

    if (!activeStore) {
      return (
          <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Please select a store to begin.</p>
          </div>
      );
    }

    return (
        <>
            <PageHeader title="Cashier" description="Start a new session or manage active ones.">
                <SyncSessionsTool />
            </PageHeader>
            
            {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="space-y-8">
                    <ApprovalQueue storeId={activeStore.id} />
                    
                    {!isConfigLoading && !storeConfig && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Configuration Missing</AlertTitle>
                            <AlertDescription>
                                This store's configuration document could not be loaded. Some features like starting new sessions may be unavailable.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                        <div className="lg:col-span-1 space-y-8">
                             <Accordion type="single" collapsible className="w-full" defaultValue="new-session">
                                <AccordionItem value="new-session" className="border-b-0">
                                    <Card>
                                        <AccordionTrigger className="p-6 hover:no-underline">
                                            <CardHeader className="p-0 text-left">
                                                <CardTitle>New Session</CardTitle>
                                                <CardDescription>Start a new billing session for a table.</CardDescription>
                                            </CardHeader>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <StartSessionForm
                                                tables={sortedTables}
                                                packages={availablePackages}
                                                flavors={enabledFlavors}
                                                user={appUser}
                                                storeId={activeStore.id}
                                            />
                                        </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            </Accordion>
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <ActiveSessionsGrid sessions={sessions} storeId={activeStore.id} adjustmentFlags={adjustmentFlags} />
                            <PastSessionsCard />
                        </div>
                    </div>
                </div>
            )}
            {activeStore?.id && (
                <WeatherLoggerModal 
                    isOpen={isModalOpen}
                    onClose={closeModal}
                    storeId={activeStore.id}
                />
            )}
        </>
    );
}
