
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { collection, query, where, onSnapshot, doc, writeBatch, setDoc, serverTimestamp, Timestamp, collectionGroup, getDocs, getDoc, runTransaction, updateDoc, increment, orderBy, getCountFromServer, limit, startAfter, QueryDocumentSnapshot, DocumentSnapshot, DocumentData, Transaction } from "firebase/firestore";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { KdsView } from "@/components/kitchen/kds-view";
import { HistoryView } from "@/components/kitchen/history-view";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { db } from "@/lib/firebase/client";
import { Loader, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SessionTimelineDrawer } from "@/components/session/session-timeline-drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { stripUndefined } from "@/lib/firebase/utils";
import type { KitchenTicket, OrderItemStatus } from "@/lib/types";
import { computeSessionLabel } from "@/lib/utils/session";
import { toJsDate } from "@/lib/utils/date";
import { Badge } from "@/components/ui/badge";
import { applyKdsTicketDelta } from "@/lib/analytics/applyKdsTicketDelta";
import { cn } from "@/lib/utils";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

export type KitchenStation = {
    id: string;
    name: string;
    key: string;
    sortOrder?: number;
    isActive?: boolean;
};

type Session = {
    id: string;
    initialFlavorIds?: string[];
    customerName?: string | null;
    tableNumber?: string | null;
    sessionMode?: 'package_dinein' | 'alacarte';
    guestCountFinal?: number | null;
    guestCountCashierInitial?: number;
};

type Flavor = {
    id: string;
    name: string;
};

type OpPageData = {
    name?: string;
    activeCount?: number;
    todayServeCount?: number;
    todayServeMsSum?: number;
    todayDayId?: string;
    todayServeAvgMs?: number;
};

type HistoryPreviewItem = {
    id: string;
    sessionLabel: string;
    tableNumber?: string | null;
    customerName?: string | null;
    itemName: string;
    qty: number;
    status: OrderItemStatus;
    closedAtClientMs: number;
    durationMs: number;
};


function getStartMs(input: any): number | null {
  if (!input) return null;
  // number (ms)
  if (typeof input === "number" && Number.isFinite(input)) return input;
  // Date
  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? t : null;
  }
  // Firestore Timestamp (v9)
  if (typeof input.toMillis === "function") return input.toMillis();
  // Timestamp-like object { seconds, nanoseconds }
  if (typeof input.seconds === "number") {
    const ns = typeof input.nanoseconds === "number" ? input.nanoseconds : 0;
    return input.seconds * 1000 + Math.floor(ns / 1e6);
  }
  return null;
}

function formatDuration(ms: number): string {
    if (isNaN(ms) || ms < 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const paddedHours = hours.toString().padStart(2, '0');
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = seconds.toString().padStart(2, '0');

    return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
}

export default function KitchenPage() {
  const { appUser, isSigningOut } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const processedStoresRef = useRef(new Set<string>());

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [sessionsMap, setSessionsMap] = useState<Map<string, Session>>(new Map());
  const [flavorsMap, setFlavorsMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const [stationCounts, setStationCounts] = useState<Map<string, number>>(new Map());
  const [activeStationData, setActiveStationData] = useState<OpPageData | null>(null);
  
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  const refreshStationCounts = useCallback(async () => {
    if (!activeStore || stations.length === 0) return;

    const counts = new Map<string, number>();
    const promises = stations.map(async (station: KitchenStation) => {
        try {
            const ticketsRef = collection(db, 'stores', activeStore.id, 'opPages', station.id, 'activeKdsTickets');
            const snapshot = await getCountFromServer(query(ticketsRef));
            counts.set(station.id, snapshot.data().count);
        } catch (error: any) {
            console.error(`Failed to get count for station ${station.name}:`, error);
            counts.set(station.id, 0); // Default to 0 on error
        }
    });

    await Promise.all(promises);
    setStationCounts(counts);
  }, [activeStore, stations]);


  // Effect for fetching store-level data (stations, flavors)
  useEffect(() => {
    if (!activeStore) {
      setIsLoading(false);
      setTickets([]);
      setStations([]);
      return;
    }
    
    setIsLoading(true);
    const unsubs: (() => void)[] = [];

    // Fetch active kitchen stations for the store
    const stationsRef = collection(db, "stores", activeStore.id, "kitchenLocations");
    unsubs.push(onSnapshot(query(stationsRef, where("isActive", "==", true)), async (snapshot) => {
        const stationsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, key: docSnap.id, ...docSnap.data() } as KitchenStation));
        stationsData.sort((a,b) => (a.sortOrder ?? 1000) - (b.sortOrder ?? 1000));
        setStations(stationsData);
        if (stationsData.length > 0 && !activeTab) {
            setActiveTab(stationsData[0].id);
        }
    }));
    
    // Fetch all global flavors once
    const flavorsRef = collection(db, "flavors");
    unsubs.push(onSnapshot(query(flavorsRef, where("isActive", "==", true)), (snapshot) => {
        const newFlavorsMap = new Map<string, string>();
        snapshot.docs.forEach(docSnap => newFlavorsMap.set(docSnap.id, docSnap.data().name));
        setFlavorsMap(newFlavorsMap);
    }));

    setIsLoading(false); // Main loader can be turned off

    return () => unsubs.forEach(unsub => unsub());
  }, [activeStore, appUser, activeTab]);
  
  useEffect(() => {
    if (!activeStore || !activeTab) {
      setActiveStationData(null);
      return;
    }
    const unsub = onSnapshot(doc(db, "stores", activeStore.id, "opPages", activeTab), (docSnap: DocumentSnapshot<DocumentData>) => {
      setActiveStationData(docSnap.exists() ? docSnap.data() as OpPageData : null);
    });
    return () => unsub();
  }, [activeStore, activeTab]);


  // Effect to refresh counts when the list of stations changes
  useEffect(() => {
    refreshStationCounts();
  }, [stations, refreshStationCounts]);


  // Effect for fetching live tickets for the currently active tab
  useEffect(() => {
    if (!activeStore || !activeTab) {
        setTickets([]);
        return;
    }
    
    setIsLoading(true);
    const ticketsQuery = query(
        collection(db, 'stores', activeStore.id, 'opPages', activeTab, 'activeKdsTickets'),
        orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(ticketsQuery, async (snapshot) => {
        const liveTickets = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as KitchenTicket));
        setTickets(liveTickets);
        
        const sessionIds = [...new Set(liveTickets.map(t => t.sessionId))];
        if (sessionIds.length > 0) {
            const chunkArray = <T,>(arr: T[], size: number): T[][] => {
                const chunks: T[][] = [];
                for (let i = 0; i < arr.length; i += size) {
                    chunks.push(arr.slice(i, i + size));
                }
                return chunks;
            };

            const idChunks = chunkArray(sessionIds, 30);
            
            const newSessionsMap = new Map<string, Session>();
            for (const chunk of idChunks) {
                if (chunk.length === 0) continue;
                const sessionsQuery = query(collection(db, `stores/${activeStore.id}/sessions`), where("id", "in", chunk));
                const sessionsSnap = await getDocs(sessionsQuery);
                sessionsSnap.forEach(docSnap => {
                    newSessionsMap.set(docSnap.id, {id: docSnap.id, ...docSnap.data()} as Session);
                });
            }
            setSessionsMap(prev => new Map([...prev, ...newSessionsMap]));
        }
        setIsLoading(false);
    }, (error: any) => {
        if (isSigningOut || !appUser) return;
        console.error("Error fetching kitchen tickets:", error);
        toast({ variant: "destructive", title: "Error", description: error?.message || "Could not fetch kitchen tickets." });
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [activeStore, activeTab, toast, isSigningOut, appUser]);
  
  useEffect(() => {
    if (!activeStore || !activeTab) {
        setHistoryPreview([]);
        return;
    }
    setIsLoadingHistory(true);
    const previewDocRef = doc(db, 'stores', activeStore.id, 'opPages', activeTab, 'historyPreview', 'current');
    
    const unsubscribe = onSnapshot(previewDocRef, (docSnap: DocumentSnapshot<DocumentData>) => {
        setHistoryPreview(docSnap.data()?.items || []);
        setIsLoadingHistory(false);
    }, (err: any) => {
        console.error(`Error fetching history preview for ${activeTab}:`, err);
        setIsLoadingHistory(false);
    });
    
    return () => unsubscribe();
  }, [activeStore, activeTab]);


  const avgServingTime = useMemo(() => {
    if (!activeStationData) return { avgMs: 0, count: 0 };
    
    const { todayServeCount, todayServeMsSum } = activeStationData;
    const count = Number(todayServeCount || 0);
    const sum = Number(todayServeMsSum || 0);
    
    if (count === 0) return { avgMs: 0, count: 0 };
    
    return { avgMs: sum / count, count };
  }, [activeStationData]);

  const ticketsWithData = useMemo(() => {
    return tickets.map(ticket => {
        const session = sessionsMap.get(ticket.sessionId);
        const flavorNames = ticket.type === 'package' 
            ? session?.initialFlavorIds?.map(id => flavorsMap.get(id) || 'Unknown').filter(Boolean)
            : [];
        const finalGuestCount = session?.guestCountFinal ?? session?.guestCountCashierInitial ?? ticket.guestCount;
        return {
            ...ticket,
            guestCount: finalGuestCount,
            initialFlavorNames: flavorNames,
            sessionLabel: computeSessionLabel({ 
              sessionMode: ticket.sessionMode, 
              customerName: ticket.customerName, 
              tableNumber: ticket.tableNumber 
            }),
        };
    });
  }, [tickets, sessionsMap, flavorsMap]);
  
  const updateTicketStatus = async (ticketId: string, sessionId: string, newStatus: "served" | "cancelled", reason?: string) => {
    if (!appUser || !activeStore) {
        toast({ variant: "destructive", title: "Action Failed", description: "Authentication or store context is missing." });
        return;
    }

    const nowMs = Date.now();

    try {
        await runTransaction(db, async (transaction: Transaction) => {
            const ticketRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "kitchentickets", ticketId);
            const ticketSnap = await transaction.get(ticketRef);
            
            if (!ticketSnap.exists()) {
                throw new Error("Ticket not found.");
            }

            const oldTicketState = ticketSnap.data() as KitchenTicket;
            
            if (oldTicketState.status === 'served' || oldTicketState.status === 'cancelled') {
                console.log(`Ticket ${ticketId} is already finalized. Skipping update.`);
                return;
            }
            
            const opPageRef = doc(db, 'stores', activeStore.id, 'opPages', oldTicketState.kitchenLocationId);
            const activeProjectionRef = doc(db, 'stores', activeStore.id, 'opPages', oldTicketState.kitchenLocationId, 'activeKdsTickets', ticketId);
            const historyPreviewRef = doc(db, 'stores', activeStore.id, 'opPages', oldTicketState.kitchenLocationId, 'historyPreview', 'current');
            
            const [
              opPageSnap, 
              activeProjectionSnap, 
              historyPreviewSnap
            ]: [
              DocumentSnapshot<DocumentData>, 
              DocumentSnapshot<DocumentData>, 
              DocumentSnapshot<DocumentData>
            ] = await Promise.all([
                transaction.get(opPageRef),
                transaction.get(activeProjectionRef),
                transaction.get(historyPreviewRef),
            ]);


            const opPageData = opPageSnap.exists() ? opPageSnap.data() as OpPageData : {};
            const updatePayload: any = { status: newStatus, updatedAt: serverTimestamp() };
            let newTicketState: KitchenTicket;
            
            if (newStatus === 'served') {
                const startMs = getStartMs(oldTicketState.createdAtClientMs ?? oldTicketState.createdAt);
                const durationMs = startMs ? Math.max(0, nowMs - startMs) : 0;
                
                updatePayload.servedAt = serverTimestamp();
                updatePayload.servedAtClientMs = nowMs;
                updatePayload.servedByUid = appUser.uid;
                updatePayload.preparedAt = serverTimestamp();
                updatePayload.preparedByUid = appUser.uid;
                updatePayload.durationMs = durationMs;
                
                const sessionRef = doc(db, "stores", activeStore.id, "sessions", sessionId);
                const sessionUpdate: Record<string, any> = {
                    [`serveCountByType.${oldTicketState.type}`]: increment(1),
                    [`serveTimeMsTotalByType.${oldTicketState.type}`]: increment(durationMs),
                };

                if (oldTicketState.type === 'refill') {
                    const qty = oldTicketState.qty || 1;
                    sessionUpdate.servedRefillsTotal = increment(qty);
                }
                transaction.update(sessionRef, sessionUpdate);
                newTicketState = { ...oldTicketState, ...updatePayload };

            } else { // cancelled
                updatePayload.cancelledAt = serverTimestamp();
                updatePayload.cancelledAtClientMs = nowMs;
                updatePayload.cancelledByUid = appUser.uid;
                updatePayload.cancelReason = reason;

                newTicketState = { ...oldTicketState, ...updatePayload };

                if (oldTicketState.type === 'addon' && oldTicketState.itemId) {
                    const billLineId = `addon_${oldTicketState.itemId}`;
                    const billLineRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "sessionBillLines", billLineId);
                    transaction.update(billLineRef, {
                        voidedQty: increment(1)
                    });
                }
            }
            
            transaction.update(ticketRef, updatePayload);
            await applyKdsTicketDelta(db, activeStore.id, oldTicketState, newTicketState, { tx: transaction });

            if (activeProjectionSnap.exists()) {
                const closedProjectionRef = doc(db, 'stores', activeStore.id, 'opPages', oldTicketState.kitchenLocationId, 'closedKdsTickets', ticketId);
                transaction.set(closedProjectionRef, { ...newTicketState, updatedAt: serverTimestamp() }, { merge: true });
                transaction.delete(activeProjectionRef);

                const currentCount = opPageData.activeCount || 0;
                const opPageUpdatePayload: Record<string, any> = {
                    activeCount: Math.max(0, currentCount - 1),
                };

                if (newStatus === 'served') {
                    const durationMs = newTicketState.durationMs!;
                    const todayDayId = getDayIdFromTimestamp(new Date());
                    let { todayDayId: storedDayId, todayServeMsSum = 0, todayServeCount = 0 } = opPageData;
        
                    if (storedDayId !== todayDayId) {
                        todayServeMsSum = 0;
                        todayServeCount = 0;
                    }
                    const newSum = todayServeMsSum + durationMs;
                    const newCountServed = todayServeCount + 1;
        
                    opPageUpdatePayload['todayDayId'] = todayDayId;
                    opPageUpdatePayload['todayServeMsSum'] = newSum;
                    opPageUpdatePayload['todayServeCount'] = newCountServed;
                    opPageUpdatePayload['todayServeAvgMs'] = newSum / newCountServed;
                }
                transaction.update(opPageRef, opPageUpdatePayload);
                
                // Update history preview
                const newHistoryEntry: HistoryPreviewItem = {
                    id: newTicketState.id,
                    sessionLabel: newTicketState.sessionLabel || "",
                    tableNumber: newTicketState.tableNumber,
                    customerName: newTicketState.customerName,
                    itemName: newTicketState.itemName,
                    qty: newTicketState.qty,
                    status: newTicketState.status,
                    closedAtClientMs: nowMs,
                    durationMs: newTicketState.durationMs || 0
                };
                const existingItems = (historyPreviewSnap.data() as any)?.items || [];
                const newItems = [newHistoryEntry, ...existingItems].slice(0, 15);
                transaction.set(historyPreviewRef, { items: newItems }, { merge: true });
            }

        });

        const ticket = tickets.find(t => t.id === ticketId);
        toast({ title: `Ticket ${newStatus}`, description: `${ticket?.itemName || 'Item'} for ${ticket?.sessionLabel || 'N/A'} is ${newStatus}.` });
        refreshStationCounts(); // Refresh counts after a successful action

    } catch (error: any) {
        console.error(`Failed to update ticket status to ${newStatus}:`, error);
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update the ticket status." });
    }
  };


  const preparingItems = useMemo(() => ticketsWithData.filter(t => t.status === 'preparing'), [ticketsWithData]);

  if (isLoading) {
    return <div className="flex justify-center items-center h-full"><Loader className="animate-spin" size={48} /></div>;
  }

  return (
    <RoleGuard allow={["admin", "manager", "kitchen"]}>
      <PageHeader 
        title="Kitchen Display System" 
        description="Monitor and manage all active food and beverage orders."
      >
        <div className="text-right">
            <p className="text-sm font-medium text-muted-foreground">{activeStationData?.name || 'Station'} Avg Serving Time</p>
            <p className={cn(
                "text-2xl font-bold font-mono",
                avgServingTime.avgMs > 0 && avgServingTime.avgMs <= 300000 ? "text-green-600" : "text-destructive"
            )}>
                {formatDuration(avgServingTime.avgMs)}
            </p>
        </div>
      </PageHeader>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            <div className="lg:col-span-3">
                 <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    {isMobile ? (
                        <Select value={activeTab} onValueChange={setActiveTab}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a station..." />
                            </SelectTrigger>
                            <SelectContent>
                                {stations.map(station => {
                                    const count = stationCounts.get(station.id) || 0;
                                    return (
                                        <SelectItem key={station.id} value={station.key}>
                                            {station.name} {count > 0 && `(${count})`}
                                        </SelectItem>
                                    )
                                })}
                            </SelectContent>
                        </Select>
                    ) : (
                        <TabsList className="gap-2">
                            {stations.map(station => {
                                const count = stationCounts.get(station.id) || 0;
                                return (
                                    <TabsTrigger key={station.id} value={station.key} className="relative">
                                        {station.name}
                                        {count > 0 && (
                                            <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{count}</Badge>
                                        )}
                                    </TabsTrigger>
                                )
                            })}
                        </TabsList>
                    )}
                    {stations.map(station => (
                        <TabsContent key={station.id} value={station.key}>
                            <KdsView tickets={preparingItems} onUpdateStatus={updateTicketStatus} />
                        </TabsContent>
                    ))}
                 </Tabs>
            </div>
            <div className="lg:col-span-1 space-y-4">
                <HistoryView 
                  items={historyPreview}
                  isLoading={isLoadingHistory}
                  activeStationId={activeTab}
                />
            </div>
        </div>
      {timelineSessionId && activeStore && (
        <SessionTimelineDrawer open={!!timelineSessionId} onOpenChange={(isOpen) => !isOpen && setTimelineSessionId(null)} storeId={activeStore.id} sessionId={timelineSessionId} />
       )}
    </RoleGuard>
  );
}
