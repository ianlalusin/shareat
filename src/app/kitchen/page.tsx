
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, doc, writeBatch, serverTimestamp, Timestamp, collectionGroup, getDocs, getDoc, runTransaction, increment } from "firebase/firestore";
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
import { ReadyToServe } from "@/components/kitchen/ReadyToServe";
import { stripUndefined } from "@/lib/firebase/utils";
import type { KitchenTicket } from "@/lib/types";
import { computeSessionLabel } from "@/lib/utils/session";

export type KitchenStation = {
    id: string;
    name: string;
    key: string;
};

type Session = {
    id: string;
    initialFlavorIds?: string[];
    customerName?: string | null;
    tableNumber?: string | null;
    sessionMode?: 'package_dinein' | 'alacarte';
};

type Flavor = {
    id: string;
    name: string;
};

export default function KitchenPage() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [sessionsMap, setSessionsMap] = useState<Map<string, Session>>(new Map());
  const [flavorsMap, setFlavorsMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const [isServing, setIsServing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!activeStore) {
        setIsLoading(false);
        return;
    };
    setIsLoading(true);

    const unsubs: (() => void)[] = [];

    // Fetch active kitchen stations for the store
    const stationsRef = collection(db, "stores", activeStore.id, "kitchenLocations");
    unsubs.push(onSnapshot(query(stationsRef, where("isActive", "==", true)), (snapshot) => {
        const stationsData = snapshot.docs.map(doc => ({ id: doc.id, key: doc.id, ...doc.data() } as KitchenStation));
        setStations(stationsData);
        if (stationsData.length > 0 && !stationsData.some(s => s.id === activeTab)) {
            setActiveTab(stationsData[0].id);
        }
    }));
    
    // Fetch all global flavors once
    const flavorsRef = collection(db, "flavors");
    unsubs.push(onSnapshot(query(flavorsRef, where("isActive", "==", true)), (snapshot) => {
        const newFlavorsMap = new Map<string, string>();
        snapshot.docs.forEach(doc => newFlavorsMap.set(doc.id, doc.data().name));
        setFlavorsMap(newFlavorsMap);
    }));

    // Listen to kitchen tickets for the store
    const ticketsQuery = query(collectionGroup(db, 'kitchentickets'), where('storeId', '==', activeStore.id));
    unsubs.push(onSnapshot(ticketsQuery, (snapshot) => {
        const allTickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenTicket));
        
        const getTime = (date: any): number => {
            if (!date) return 0;
            // Handle both Firestore Timestamp and JS Date
            return typeof date.toMillis === 'function' ? date.toMillis() : new Date(date).getTime();
        };
        
        setTickets(allTickets.sort((a,b) => getTime(a.createdAt) - getTime(b.createdAt)));
        
        // After getting tickets, get the unique session IDs and fetch their data
        const sessionIds = [...new Set(allTickets.map(t => t.sessionId))];
        if (sessionIds.length > 0) {
            // Firestore 'in' queries are limited to 30 values. We need to chunk the requests.
            const chunkArray = <T,>(arr: T[], size: number): T[][] => {
                const chunks: T[][] = [];
                for (let i = 0; i < arr.length; i += size) {
                    chunks.push(arr.slice(i, i + size));
                }
                return chunks;
            };

            const idChunks = chunkArray(sessionIds, 30);
            
            const fetchSessionChunks = async () => {
                const newSessionsMap = new Map<string, Session>();
                for (const chunk of idChunks) {
                    if (chunk.length === 0) continue;
                    const sessionsQuery = query(collection(db, `stores/${activeStore.id}/sessions`), where("id", "in", chunk));
                    const sessionsSnap = await getDocs(sessionsQuery);
                    sessionsSnap.forEach(doc => {
                        newSessionsMap.set(doc.id, {id: doc.id, ...doc.data()} as Session);
                    });
                }
                setSessionsMap(newSessionsMap);
            };

            fetchSessionChunks();
        }
        setIsLoading(false);
    }, (error) => {
        console.error("Error fetching kitchen tickets:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not fetch kitchen tickets." });
        setIsLoading(false);
    }));

    return () => unsubs.forEach(unsub => unsub());
  }, [activeStore, toast, activeTab]);

  const ticketsWithData = useMemo(() => {
    return tickets.map(ticket => {
        const session = sessionsMap.get(ticket.sessionId);
        const flavorNames = ticket.type === 'package' 
            ? session?.initialFlavorIds?.map(id => flavorsMap.get(id) || 'Unknown').filter(Boolean)
            : [];
        return {
            ...ticket,
            initialFlavorNames: flavorNames,
            sessionLabel: computeSessionLabel({ 
              sessionMode: ticket.sessionMode, 
              customerName: ticket.customerName, 
              tableNumber: ticket.tableNumber 
            }),
        };
    });
  }, [tickets, sessionsMap, flavorsMap]);
  
  const updateTicketStatus = async (ticketId: string, sessionId: string, newStatus: "ready" | "cancelled" | "served", reason?: string) => {
    if (!appUser || !activeStore) {
        toast({ variant: "destructive", title: "Action Failed", description: "Authentication or store context is missing." });
        return;
    }

    try {
        await runTransaction(db, async (transaction) => {
            const ticketRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "kitchentickets", ticketId);
            const ticketSnap = await transaction.get(ticketRef);
            
            if (!ticketSnap.exists()) {
                throw new Error("Ticket not found.");
            }

            const ticket = ticketSnap.data() as KitchenTicket;
            
            // Idempotency check for refill counting
            if (newStatus === 'served' && ticket.type === 'refill' && ticket.servedCounted) {
                console.log(`Refill ticket ${ticketId} already counted. Skipping.`);
                return; // Already processed
            }

            const updatePayload: any = { status: newStatus };
            
            if (newStatus === 'ready') {
                updatePayload.preparedAt = serverTimestamp();
                updatePayload.preparedByUid = appUser.uid;
            } else if (newStatus === 'served') {
                updatePayload.servedAt = serverTimestamp();
                updatePayload.servedByUid = appUser.uid;

                if (ticket.type === 'refill') {
                    const sessionRef = doc(db, "stores", activeStore.id, "sessions", sessionId);
                    const refillName = ticket.itemName || "Refill";
                    const qty = ticket.qty || 1;
                    
                    updatePayload.servedCounted = true; // Mark as counted

                    transaction.update(sessionRef, {
                        servedRefillsTotal: increment(qty),
                        [`servedRefillsByName.${refillName}`]: increment(qty),
                    });
                }
            } else { // cancelled or void
                updatePayload.cancelledAt = serverTimestamp();
                updatePayload.cancelledByUid = appUser.uid;
                updatePayload.cancelReason = reason;
                
                const billableRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId);
                const billableDoc = await transaction.get(billableRef);
                if (billableDoc.exists()) {
                    transaction.update(billableRef, { status: newStatus, updatedAt: serverTimestamp() });
                }
            }
            transaction.update(ticketRef, updatePayload);
        });

        const ticket = tickets.find(t => t.id === ticketId);
        toast({ title: `Ticket ${newStatus}`, description: `${ticket?.itemName || 'Item'} for ${ticket?.sessionLabel || 'N/A'} is ${newStatus}.` });

    } catch (error: any) {
        console.error(`Failed to update ticket status to ${newStatus}:`, error);
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update the ticket status." });
    }
  };


  const preparingItems = ticketsWithData.filter(t => t.status === 'preparing');
  const readyItems = ticketsWithData.filter(t => t.status === 'ready');
  const historyItems = ticketsWithData
    .filter(t => t.status === 'served' || t.status === 'cancelled' || t.status === 'void')
    .sort((a, b) => {
        const getTime = (date: any): number => {
            if (!date) return 0;
            // Handle both Firestore Timestamp and JS Date
            return typeof date.toMillis === 'function' ? date.toMillis() : new Date(date).getTime();
        };
        const aTime = getTime(a.cancelledAt || a.servedAt || a.createdAt);
        const bTime = getTime(b.cancelledAt || b.servedAt || b.createdAt);
        return bTime - aTime;
    })
    .slice(0, 50);

  if (isLoading) {
    return <div className="flex justify-center items-center h-full"><Loader className="animate-spin" size={48} /></div>;
  }

  return (
    <RoleGuard allow={["admin", "manager", "kitchen"]}>
      <PageHeader title="Kitchen Display System" description="Monitor and manage all active food and beverage orders." />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            <div className="lg:col-span-3">
                 <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    {isMobile ? (
                        <Select value={activeTab} onValueChange={setActiveTab}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a station..." />
                            </SelectTrigger>
                            <SelectContent>
                                {stations.map(station => (
                                    <SelectItem key={station.id} value={station.key}>{station.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <TabsList>
                            {stations.map(station => (
                                <TabsTrigger key={station.id} value={station.key}>{station.name}</TabsTrigger>
                            ))}
                        </TabsList>
                    )}
                    {stations.map(station => (
                        <TabsContent key={station.id} value={station.key}>
                            <KdsView tickets={preparingItems.filter(t => t.kitchenLocationId === station.id)} onUpdateStatus={updateTicketStatus} />
                        </TabsContent>
                    ))}
                 </Tabs>
            </div>
            <div className="lg:col-span-1 space-y-4">
                <ReadyToServe items={readyItems} onMarkServed={(item) => updateTicketStatus(item.id, item.sessionId, 'served')} isServing={isServing} />
                <HistoryView items={historyItems} />
            </div>
        </div>
      {timelineSessionId && activeStore && (
        <SessionTimelineDrawer open={!!timelineSessionId} onOpenChange={(isOpen) => !isOpen && setTimelineSessionId(null)} storeId={activeStore.id} sessionId={timelineSessionId} />
       )}
    </RoleGuard>
  );
}
