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
import { CashierTargetProgressCard } from "./CashierTargetProgressCard";
import { CashierTipController } from "./CashierTipController";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWeatherLogger } from "@/hooks/useWeatherLogger";
import { WeatherLoggerModal } from "@/components/shared/WeatherLoggerModal";
import { WeatherLogFloatingButton } from "@/components/dashboard/WeatherLogFloatingButton";
import { WaitlistCard, type WaitlistEntry } from "./WaitlistCard";
import type { PendingSeat } from "./start-session-form";
import { deleteDoc, doc } from "firebase/firestore";

export function SessionListView() {
    const { appUser, isSigningOut } = useAuthContext();
    const { activeStore } = useStoreContext();
    const router = useRouter();

    const { config: storeConfig, isLoading: isConfigLoading, error: configError } = useStoreConfigDoc(activeStore?.id);

    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [sessions, setSessions] = useState<ActiveSession[]>([]);

    const [cachedTables, setCachedTables] = useState<any[]>([]);
    const [isLoadingTables, setIsLoadingTables] = useState(true);

    const [pendingSeat, setPendingSeat] = useState<PendingSeat | null>(null);
    const [newSessionAccordion, setNewSessionAccordion] = useState<string>("");

    const { isModalOpen, closeModal } = useWeatherLogger();

    const handleRequestSeat = (entry: WaitlistEntry) => {
        setPendingSeat({ id: entry.id, name: entry.name, partySize: entry.partySize, phone: entry.phone });
        setNewSessionAccordion("new-session");
    };
    const handleClearSeat = () => setPendingSeat(null);
    const handleSeatCompleted = async (_sessionId: string) => {
        if (!activeStore || !pendingSeat) return;
        try {
            await deleteDoc(doc(db, "stores", activeStore.id, "waitlist", pendingSeat.id));
        } catch (err) {
            console.warn("[Waitlist] Failed to delete entry after seating", err);
        } finally {
            setPendingSeat(null);
            setNewSessionAccordion("");
        }
    };

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
        const available = [...cachedTables]
            .filter(t => t.status === 'available' && t.isActive !== false)
            .sort((a, b) => {
                const numA = parseInt(a.tableNumber, 10);
                const numB = parseInt(b.tableNumber, 10);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return numA - numB;
                }
                return (a.tableNumber || '').localeCompare(b.tableNumber || '');
            });

        // Find anchor: most recently started active session's table number
        // sessions are ordered asc by startedAtClientMs, so last element is most recent
        const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
        const anchorRaw = lastSession?.tableNumber;
        const anchorNum = anchorRaw != null ? parseInt(String(anchorRaw), 10) : NaN;
        if (isNaN(anchorNum)) return available;

        // Rotate: tables with number > anchor come first, then tables with number <= anchor
        const after: typeof available = [];
        const before: typeof available = [];
        for (const t of available) {
            const n = parseInt(t.tableNumber, 10);
            if (!isNaN(n) && n > anchorNum) after.push(t);
            else before.push(t);
        }
        return [...after, ...before];
    }, [cachedTables, sessions]);

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
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <CashierTargetProgressCard storeId={activeStore.id} />
                    <SyncSessionsTool />
                </div>
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
                        <div className="lg:col-span-1 space-y-4">
                             <Accordion type="single" collapsible className="w-full" value={newSessionAccordion} onValueChange={setNewSessionAccordion}>
                                <AccordionItem value="new-session" className="border-b-0">
                                    <Card>
                                        <div className="flex items-center justify-between p-4 gap-3">
                                            <CardHeader className="p-0 text-left">
                                                <CardTitle>New Session</CardTitle>
                                                <CardDescription>Start a new billing session for a table.</CardDescription>
                                            </CardHeader>
                                            <AccordionTrigger
                                                className="h-12 w-12 shrink-0 rounded-full border-2 border-primary/40 bg-primary/5 hover:bg-primary/10 hover:no-underline flex items-center justify-center p-0 [&>svg]:h-6 [&>svg]:w-6 [&>svg]:text-primary"
                                                aria-label={newSessionAccordion === "new-session" ? "Collapse new session" : "Expand new session"}
                                            />
                                        </div>
                                        <AccordionContent>
                                            <StartSessionForm
                                                tables={sortedTables}
                                                packages={availablePackages}
                                                flavors={enabledFlavors}
                                                user={appUser}
                                                storeId={activeStore.id}
                                                pendingSeat={pendingSeat}
                                                onSeatCompleted={handleSeatCompleted}
                                                onSeatCleared={handleClearSeat}
                                            />
                                        </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            </Accordion>

                            <WaitlistCard
                                storeId={activeStore.id}
                                onSeat={handleRequestSeat}
                                activeSeatingId={pendingSeat?.id ?? null}
                            />
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <ActiveSessionsGrid sessions={sessions} storeId={activeStore.id} adjustmentFlags={adjustmentFlags} />
                            <PastSessionsCard />
                        </div>
                    </div>

                    {/* Idle tip controller (renders nothing inline; opens a portal modal) */}
                    <CashierTipController storeId={activeStore.id} />
                </div>
            )}
            {activeStore?.id && (
                <WeatherLoggerModal
                    isOpen={isModalOpen}
                    onClose={closeModal}
                    storeId={activeStore.id}
                />
            )}
            {activeStore?.id && (
                <WeatherLogFloatingButton storeId={activeStore.id} />
            )}
        </>
    );
}
