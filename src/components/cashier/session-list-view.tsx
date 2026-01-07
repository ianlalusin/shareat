
"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { collection, onSnapshot, query, where, Timestamp, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";
import { Loader2, Receipt } from "lucide-react";
import { StartSessionForm, type Table } from "@/components/cashier/start-session-form";
import { ActiveSessionsGrid, type ActiveSession } from "@/components/cashier/active-sessions-grid";
import { PastSessionsCard, type PastSession } from "@/components/cashier/past-sessions-card";
import { isScheduleActiveNow } from "@/lib/utils/isScheduleActiveNow";

import { ApprovalQueue } from "@/components/cashier/ApprovalQueue";
import type { StorePackage, StoreFlavor, MenuSchedule } from "@/lib/types";

export function SessionListView() {
    const { appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const router = useRouter();

    const [tables, setTables] = useState<Table[]>([]);
    const [packages, setPackages] = useState<StorePackage[]>([]);
    const [flavors, setFlavors] = useState<StoreFlavor[]>([]);
    const [schedules, setSchedules] = useState<Map<string, MenuSchedule>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
    const [sessions, setSessions] = useState<ActiveSession[]>([]);

    useEffect(() => {
        if (!activeStore) {
            setIsLoading(false);
            return;
        };
        setIsLoading(true);

        const unsubs: (() => void)[] = [];

        // Fetch Tables
        const tablesRef = collection(db, "stores", activeStore.id, "tables");
        unsubs.push(onSnapshot(query(tablesRef, where("isActive", "==", true)), (snapshot) => {
            setTables(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Table))
                .sort((a,b) => (a.tableNumber || "0").localeCompare(b.tableNumber || "0", undefined, { numeric: true }))
            );
        }));

        // Fetch Flavors from store-level collection
        const flavorsRef = collection(db, "stores", activeStore.id, "storeFlavors");
        unsubs.push(onSnapshot(query(flavorsRef, where("isEnabled", "==", true), orderBy("sortOrder", "asc")), (snapshot) => {
            setFlavors(snapshot.docs.map(doc => doc.data() as StoreFlavor));
        }));

        // Fetch Packages from store-level collection
        const packagesRef = collection(db, "stores", activeStore.id, "storePackages");
        unsubs.push(onSnapshot(query(packagesRef, where("isEnabled", "==", true), orderBy("sortOrder", "asc")), (snapshot) => {
            setPackages(snapshot.docs.map(doc => ({ packageId: doc.id, ...doc.data() } as StorePackage)));
        }));

        // Fetch active schedules
        const schedulesRef = collection(db, "stores", activeStore.id, "menuSchedules");
        const schedulesQuery = query(schedulesRef, where("isActive", "==", true));
        unsubs.push(onSnapshot(schedulesQuery, (snapshot) => {
            const schedulesMap = new Map<string, MenuSchedule>();
            snapshot.docs.forEach(doc => schedulesMap.set(doc.id, { id: doc.id, ...doc.data() } as MenuSchedule));
            setSchedules(schedulesMap);
        }));
        
        // Fetch active and pending sessions, sorted by start time
        const sessionsQuery = query(
            collection(db, "stores", activeStore.id, "sessions"), 
            where("status", "in", ["active", "pending_verification"]),
            orderBy("startedAtClientMs", "asc")
        );
        unsubs.push(onSnapshot(sessionsQuery, (snapshot) => {
            setSessions(snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    startedAtClientMs: data.startedAtClientMs ?? null,
                    startedAt: data.startedAt ?? null,
                } as ActiveSession
            }));
        }));

        // Fetch past sessions for the day
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const pastSessionsQuery = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAt", ">=", Timestamp.fromDate(todayStart)),
            where("createdAt", "<=", Timestamp.fromDate(todayEnd)),
            orderBy("createdAt", "desc")
        );
        unsubs.push(onSnapshot(pastSessionsQuery, (snapshot) => {
            setPastSessions(snapshot.docs.map(doc => doc.data() as PastSession));
        }));
        
        // All subscriptions are set, so we can stop loading.
        setIsLoading(false);

        return () => {
            unsubs.forEach(unsub => unsub());
        };

    }, [activeStore]);

    const availablePackages = useMemo(() => {
        return packages.filter(pkg => {
            if (!pkg.isEnabled) return false;
            if (!pkg.menuScheduleId) return true; // Always available if no schedule
            const schedule = schedules.get(pkg.menuScheduleId);
            if (!schedule) return true; // Fail open if schedule not found
            return isScheduleActiveNow(schedule);
        });
    }, [packages, schedules]);


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
              <Button asChild variant="outline" size="sm">
                  <Link href="/cashier/receipts">
                      <Receipt className="mr-2" />
                      Receipts
                  </Link>
              </Button>
            </PageHeader>
            
            {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="space-y-8">
                    <ApprovalQueue storeId={activeStore.id} />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                        <div className="lg:col-span-1 space-y-8">
                            <StartSessionForm
                                tables={tables.filter(t => t.status === 'available')}
                                packages={availablePackages}
                                flavors={flavors}
                                user={appUser}
                                storeId={activeStore.id}
                            />
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <ActiveSessionsGrid sessions={sessions} />
                            <PastSessionsCard sessions={pastSessions} />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
