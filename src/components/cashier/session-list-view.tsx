
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
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

export function SessionListView() {
    const { appUser, isSigningOut } = useAuthContext();
    const { activeStore } = useStoreContext();
    const router = useRouter();

    const { config: storeConfig, isLoading: isConfigLoading, error: configError } = useStoreConfigDoc(activeStore?.id);

    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [sessions, setSessions] = useState<ActiveSession[]>([]);
    
    const [cachedTables, setCachedTables] = useState<any[]>([]);
    const [isLoadingTables, setIsLoadingTables] = useState(true);

    useEffect(() => {
        if (!activeStore?.id) {
            setCachedTables([]);
            setIsLoadingTables(false);
            return;
        }
        setIsLoadingTables(true);
        const q = query(collection(db, `stores/${activeStore.id}/storeConfig/current/tables`));
        const unsub = onSnapshot(q, (snap) => {
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
        
        // Fetch active sessions from the real-time projection collection
        const sessionsQuery = query(
            collection(db, "stores", activeStore.id, "opPages", "sessionPage", "activeSessions"),
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
            <PageHeader title="Cashier" description="Start a new session or manage active ones."/>
            
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
                            <StartSessionForm
                                tables={sortedTables}
                                packages={availablePackages}
                                flavors={enabledFlavors}
                                user={appUser}
                                storeId={activeStore.id}
                            />
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <ActiveSessionsGrid sessions={sessions} storeId={activeStore.id} />
                            <PastSessionsCard />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
