
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  collection, query, where, onSnapshot, doc, writeBatch, setDoc, serverTimestamp, Timestamp, collectionGroup, getDocs, getDoc, runTransaction, updateDoc, increment, orderBy, getCountFromServer, limit, startAfter, type QueryDocumentSnapshot, type DocumentSnapshot, type DocumentData, type Transaction, type QuerySnapshot,
  arrayRemove, deleteField
} from "firebase/firestore";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { KdsView } from "@/components/kitchen/kds-view";
import { DEFAULT_SLA_MINUTES } from "@/components/kitchen/kds-item-card";
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
import type { KitchenTicket, OrderItemStatus, RtKdsStationDoc, DailyMetric } from "@/lib/types";
import { computeSessionLabel } from "@/lib/utils/session";
import { toJsDate } from "@/lib/utils/date";
import { Badge } from "@/components/ui/badge";
import { applyKdsTicketDelta } from "@/lib/analytics/applyKdsTicketDelta";
import { cn } from "@/lib/utils";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { SyncKdsTicketsTool } from "@/components/kitchen/SyncKdsTicketsTool";

export type KitchenStation = {
    id: string;
    name: string;
    key: string;
    sortOrder?: number;
    isActive?: boolean;
    slaMinutes?: number;
};

type Session = {
    id: string;
    initialFlavorIds?: string[];
    customerName?: string | null;
    tableNumber?: string | null;
    tableDisplayName?: string | null;
    sessionMode?: 'package_dinein' | 'alacarte';
    guestCountFinal?: number | null;
    guestCountCashierInitial?: number;
};

type Flavor = {
    id: string;
    name: string;
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

import { formatDuration } from "@/lib/utils/date";
import { KdsFlashOverlay } from "@/components/kitchen/kds-flash-overlay";
import { writeActivityLog } from "@/components/cashier/activity-log";
import {
  fireKitchenAlert,
  primeKitchenAudio,
  requestKitchenAlertPermission,
} from "@/lib/notifications/kitchenAlert";
import { CustomerRequestsPanel } from "@/components/kitchen/CustomerRequestsPanel";

export default function KitchenPage() {
  const { appUser, isSigningOut } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const processedStoresRef = useRef(new Set<string>());

  const [stations, setStations] = useState<KitchenStation[]>([]);
  // Single source of truth for every station's rtKdsTickets doc. One
  // collection listener populates this Map. Both `stationCounts` (tab badges)
  // and `stationDoc` (active station) derive from it via useMemo, so the
  // page only opens ONE listener on rtKdsTickets instead of two overlapping
  // ones.
  const [stationsAllDocs, setStationsAllDocs] = useState<Map<string, RtKdsStationDoc>>(new Map());
  const [stationsAllDocsLoaded, setStationsAllDocsLoaded] = useState(false);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [sessionsMap, setSessionsMap] = useState<Map<string, Session>>(new Map());
  const [flavorsMap, setFlavorsMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const prevTicketIdsRef = useRef(new Set());
  const didInitTicketsRef = useRef(false);

  const [flash, setFlash] = useState<{ type: "served" | "cancelled"; message: string; subtitle?: string } | null>(null);
  const showFlash = useCallback((type: "served" | "cancelled", message: string, subtitle?: string) => {
    setFlash({ type, message, subtitle });
  }, []);

  useEffect(() => {
    void requestKitchenAlertPermission();
    // Prime the Web Audio beep on the first user gesture so browser autoplay
    // policy lets us play sounds later. On native platforms this is a no-op.
    const unlock = () => {
      primeKitchenAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const stationCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, d] of stationsAllDocs) {
      m.set(id, (d.activeIds || []).length);
    }
    return m;
  }, [stationsAllDocs]);
  const stationDoc = useMemo<RtKdsStationDoc | null>(() => {
    if (!activeTab) return null;
    return stationsAllDocs.get(activeTab) ?? null;
  }, [stationsAllDocs, activeTab]);

  // Coarse clock (20s) to drive the per-station "over SLA" tab counters without
  // a per-second re-render of the whole page. Individual ticket cards keep
  // their own 1s ticker for the live timer.
  const [slaTick, setSlaTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setSlaTick(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const slaByStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stations) m.set(s.id, s.slaMinutes ?? DEFAULT_SLA_MINUTES);
    return m;
  }, [stations]);

  // Count active tickets at each station that have aged past its SLA.
  const overSlaByStation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [stationId, d] of stationsAllDocs) {
      const slaMs = (slaByStation.get(stationId) ?? DEFAULT_SLA_MINUTES) * 60000;
      const map = d.tickets || {};
      const ids = d.activeIds?.length ? d.activeIds : Object.keys(map);
      let late = 0;
      for (const id of ids) {
        const t = map[id];
        if (!t) continue;
        const start = getStartMs((t as any).createdAtClientMs ?? (t as any).createdAt);
        if (start != null && slaTick - start >= slaMs) late += 1;
      }
      if (late > 0) counts.set(stationId, late);
    }
    return counts;
  }, [stationsAllDocs, slaByStation, slaTick]);

  const activeStationSla = useMemo(
    () => slaByStation.get(activeTab) ?? DEFAULT_SLA_MINUTES,
    [slaByStation, activeTab],
  );

  const [dailyAnalytics, setDailyAnalytics] = useState<DailyMetric | null>(null);
  
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  

  useEffect(() => {
    if (!activeStore) {
      setIsLoading(false);
      setTickets([]);
      setStations([]);
      return;
    }
    
    setIsLoading(true);
    const unsubs: (() => void)[] = [];

    const stationsRef = collection(db, "stores", activeStore.id, "kitchenLocations");
    unsubs.push(onSnapshot(query(stationsRef, where("isActive", "==", true)), (snapshot: QuerySnapshot<DocumentData>) => {
        const stationsData = snapshot.docs.map((docSnap: QueryDocumentSnapshot<DocumentData>) => ({ id: docSnap.id, key: docSnap.id, ...docSnap.data() } as KitchenStation));
        stationsData.sort((a: KitchenStation, b: KitchenStation) => (a.sortOrder ?? 1000) - (b.sortOrder ?? 1000));
        setStations(stationsData);
        if (stationsData.length > 0 && !activeTab) {
            setActiveTab(stationsData[0].id);
        }
    }));
    
    // Flavors are a global, admin-curated catalog that changes maybe once or
    // twice a year. A live subscription on every kitchen device is overkill —
    // do a single fetch at session start instead. If admin renames a flavor
    // mid-shift, devices pick it up on the next reload.
    void (async () => {
        try {
            const flavorsRef = collection(db, "flavors");
            const snap = await getDocs(query(flavorsRef, where("isActive", "==", true)));
            const newFlavorsMap = new Map<string, string>();
            snap.forEach((docSnap: QueryDocumentSnapshot<DocumentData>) => newFlavorsMap.set(docSnap.id, docSnap.data().name));
            setFlavorsMap(newFlavorsMap);
        } catch (e) {
            console.warn("[kitchen] failed to load flavors:", e);
        }
    })();

    const rtKdsTicketsRef = collection(db, 'stores', activeStore.id, 'rtKdsTickets');
    unsubs.push(onSnapshot(rtKdsTicketsRef, (snapshot) => {
        const m = new Map<string, RtKdsStationDoc>();
        snapshot.forEach((d) => m.set(d.id, d.data() as RtKdsStationDoc));
        setStationsAllDocs(m);
        setStationsAllDocsLoaded(true);
    }));

    return () => unsubs.forEach(unsub => unsub());
  }, [activeStore, appUser, activeTab]);
  
  useEffect(() => {
    if (!activeStore) {
      setDailyAnalytics(null);
      return;
    }
    const todayDayId = getDayIdFromTimestamp(new Date());
    const unsub = onSnapshot(doc(db, "stores", activeStore.id, "analytics", todayDayId), (docSnap) => {
      if (docSnap.exists()) {
        setDailyAnalytics(docSnap.data() as DailyMetric);
      } else {
        setDailyAnalytics(null);
      }
    });
    return () => unsub();
  }, [activeStore]);


  const activeStationName = useMemo(() => {
    return stations.find(s => s.id === activeTab)?.name || 'Station';
  }, [stations, activeTab]);

  // Effect to load sessions referenced by the active station's tickets, plus
  // fire the new-ticket alert. Re-runs when the derived `stationDoc` changes,
  // which is whenever the collection listener gets a new snapshot for the
  // active station. No extra listener is needed — `stationDoc` is a useMemo
  // off `stationsAllDocs`.
  useEffect(() => {
    if (!activeStore || !activeTab) {
        setIsLoading(false);
        return;
    }
    // Wait for the collection listener's first snapshot before we declare loading done.
    if (!stationsAllDocsLoaded) {
        setIsLoading(true);
        return;
    }

    const currentTickets = stationDoc?.tickets || {};

    // Device notification when new ticket appears (ignore first load)
    const ids = Object.keys(currentTickets);
    if (didInitTicketsRef.current) {
        const prev = prevTicketIdsRef.current;
        const hasNew = ids.some((id) => !prev.has(id));
        if (hasNew) {
            void fireKitchenAlert({
                title: "New Kitchen Ticket",
                body: `${activeStationName || "Station"}: ${ids.length} active`,
            });
        }
    } else {
        didInitTicketsRef.current = true;
    }
    prevTicketIdsRef.current = new Set(ids);

    const sessionIds = [...new Set(Object.values(currentTickets).map((t: any) => t.sessionId))];
    let cancelled = false;
    if (sessionIds.length > 0) {
        (async () => {
            try {
                const idChunks: string[][] = [];
                for (let i = 0; i < sessionIds.length; i += 30) {
                    idChunks.push(sessionIds.slice(i, i + 30));
                }
                const newSessionsMap = new Map<string, Session>();
                for (const chunk of idChunks) {
                    if (chunk.length === 0) continue;
                    const sessionsQuery = query(collection(db, `stores/${activeStore.id}/sessions`), where("id", "in", chunk));
                    const sessionsSnap = await getDocs(sessionsQuery);
                    sessionsSnap.forEach((sDoc: QueryDocumentSnapshot<DocumentData>) => {
                        newSessionsMap.set(sDoc.id, { id: sDoc.id, ...sDoc.data() } as Session);
                    });
                }
                if (!cancelled) {
                    setSessionsMap(prev => new Map([...prev, ...newSessionsMap]));
                }
            } catch (error: any) {
                if (cancelled || isSigningOut || !appUser) return;
                console.error("Error fetching sessions for kitchen tickets:", error);
                toast({ variant: "destructive", title: "Error", description: error?.message || "Could not fetch session data." });
            }
        })();
    }
    setIsLoading(false);
    return () => { cancelled = true; };
    // activeStationName intentionally not in deps; the closure picks up the
    // latest value via lexical scope, and refreshing the effect just to update
    // the alert body string isn't worth the extra runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore, activeTab, stationDoc, stationsAllDocsLoaded, toast, isSigningOut, appUser]);
  
  useEffect(() => {
    if (!activeStore || !activeTab) {
      setHistoryPreview([]);
      setIsLoadingHistory(false);
      return;
    }
    setIsLoadingHistory(true);
    
    const closedTicketsRef = collection(db, 'stores', activeStore.id, 'rtKdsTickets', activeTab, 'closedKdsTickets');
    const q = query(closedTicketsRef, orderBy("closedAtClientMs", "desc"), limit(25));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyItems = snapshot.docs.map(doc => {
        const ticket = doc.data() as KitchenTicket;
        return {
          id: doc.id,
          sessionLabel: ticket.sessionLabel || 'N/A',
          tableNumber: (ticket as any).tableDisplayName || ticket.sessionLabel || ticket.tableNumber,
          customerName: ticket.customerName,
          itemName: ticket.itemName,
          qty: ticket.qty,
          status: ticket.status,
          closedAtClientMs: ticket.servedAtClientMs || ticket.cancelledAtClientMs || 0,
          durationMs: ticket.durationMs || 0,
        };
      }).sort((a, b) => b.closedAtClientMs - a.closedAtClientMs).slice(0, 5);
      setHistoryPreview(historyItems);
      setIsLoadingHistory(false);
    }, (err) => {
      console.error(`Error fetching history preview for ${activeTab}:`, err);
      setIsLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [activeStore, activeTab]);


  const avgServingTime = useMemo(() => {
    if (!dailyAnalytics || !activeTab) return { avgMs: 0, count: 0 };
    
    const sum = dailyAnalytics.kitchen?.durationMsSumByLocation?.[activeTab] || 0;
    const count = dailyAnalytics.kitchen?.durationCountByLocation?.[activeTab] || 0;
    
    if (count === 0) return { avgMs: 0, count: 0 };
    
    return { avgMs: sum / count, count };
  }, [dailyAnalytics, activeTab]);

  const ticketsWithData = useMemo(() => {
    if (!stationDoc) return [];
    
    const map = stationDoc.tickets || {};
    const ids = stationDoc.activeIds?.length ? stationDoc.activeIds : Object.keys(map);
    
    const ticketList = ids
      .map(id => ({ ...(map[id] || {}), id }))
      .filter(t => t && t.sessionId); // ensure ticket data exists

    const sortedTickets = ticketList.sort((a,b) => {
        const timeA = getStartMs(a.createdAtClientMs ?? a.createdAt);
        const timeB = getStartMs(b.createdAtClientMs ?? b.createdAt);
        return (timeA || 0) - (timeB || 0);
    });

    return sortedTickets.map((ticket: KitchenTicket) => {
        const session = sessionsMap.get(ticket.sessionId);
        const flavorNames = ticket.type === 'package' 
            ? session?.initialFlavorIds?.map((id: string) => flavorsMap.get(id) || 'Unknown').filter(Boolean)
            : [];
        const finalGuestCount = session?.guestCountFinal ?? session?.guestCountCashierInitial ?? ticket.guestCount;
        // Live session is the source of truth for the table display name —
        // it carries any rename done by the cashier mid-session and is set
        // for both POS- and customer-app-created tickets.
        const tableDisplayName =
          session?.tableDisplayName ?? (ticket as any).tableDisplayName ?? null;
        return {
            ...ticket,
            tableDisplayName,
            guestCount: finalGuestCount,
            initialFlavorNames: flavorNames,
            sessionLabel: computeSessionLabel({
              sessionMode: ticket.sessionMode,
              customerName: ticket.customerName,
              tableNumber: ticket.tableNumber,
              tableDisplayName,
            }),
        };
    });
  }, [stationDoc, sessionsMap, flavorsMap]);
  
  const updateTicketStatus = async (ticketId: string, sessionId: string, newStatus: "served" | "cancelled", reason?: string) => {
    if (!appUser || !activeStore) {
        toast({ variant: "destructive", title: "Action Failed", description: "Authentication or store context is missing." });
        return;
    }

    const nowMs = Date.now();
    let kdsDelta: { old: any; new: any } | null = null as { old: any; new: any } | null;

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
            
            const updatePayload: any = { status: newStatus, updatedAt: serverTimestamp() };
            let newTicketState: KitchenTicket;
            
            if (newStatus === 'served') {
                const startMs = getStartMs(oldTicketState.createdAtClientMs ?? oldTicketState.createdAt);
                const durationMs = startMs ? Math.max(0, nowMs - startMs) : 0;
                
                updatePayload.servedAt = serverTimestamp();
                updatePayload.servedAtClientMs = nowMs;
                updatePayload.servedByUid = appUser.uid;
                updatePayload.preparedAt = serverTimestamp(); // Note: setting prepared and served at same time
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
                    const refillName = (oldTicketState as any).refillName || oldTicketState.itemName;
                    if(refillName) {
                        sessionUpdate[`servedRefillsByName.${refillName.replace(/\./g, '_')}`] = increment(qty);
                    }
                }
                transaction.update(sessionRef, sessionUpdate);
                newTicketState = { ...oldTicketState, ...updatePayload };

            } else { // cancelled
                updatePayload.cancelledAt = serverTimestamp();
                updatePayload.cancelledAtClientMs = nowMs;
                updatePayload.cancelledByUid = appUser.uid;
                updatePayload.cancelReason = reason;

                newTicketState = { ...oldTicketState, ...updatePayload };

                if (oldTicketState.type === 'addon' && oldTicketState.billLineId) {
                    const billLineRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "sessionBillLines", oldTicketState.billLineId);
                    const sessionRef = doc(db, "stores", activeStore.id, "sessions", sessionId);
                    const ticketQty = oldTicketState.qty || 1;
                    transaction.update(billLineRef, {
                        voidedQty: increment(ticketQty),
                        voidReason: "kitchen_cancel",
                        voidNote: "Cancelled by kitchen: " + (reason || ""),
                        updatedAt: serverTimestamp(),
                    });
                    transaction.update(sessionRef, {
                        billingRevision: increment(1),
                        updatedAt: serverTimestamp(),
                    });
                }
            }
            
            transaction.update(ticketRef, updatePayload);
            
            // --- ATOMIC KDS PROJECTION UPDATE ---
            const { kitchenLocationId } = oldTicketState;
            if (kitchenLocationId) {
                // Remove from real-time view
                const rtKdsDocRef = doc(db, "stores", activeStore.id, "rtKdsTickets", kitchenLocationId);
                transaction.update(rtKdsDocRef, {
                    [`tickets.${ticketId}`]: deleteField(),
                    activeIds: arrayRemove(ticketId),
                    [`sessionIndex.${sessionId}`]: arrayRemove(ticketId),
                    "meta.updatedAt": serverTimestamp(),
                });

                // Add to historical view
                const closedTicketRef = doc(db, "stores", activeStore.id, "rtKdsTickets", kitchenLocationId, "closedKdsTickets", ticketId);
                updatePayload.updatedAt = serverTimestamp(); // bump for history ordering
                newTicketState = { ...oldTicketState, ...updatePayload };
                transaction.set(closedTicketRef, { ...newTicketState, closedAtClientMs: nowMs });
            }
            
            kdsDelta = { old: oldTicketState, new: newTicketState };
        });

        if (kdsDelta) {
          const { writeBatch: wb } = await import('firebase/firestore');
          const batch = wb(db);
          await applyKdsTicketDelta(db, activeStore.id, kdsDelta.old, kdsDelta.new, { batch });
          await batch.commit();
        }
        const ticket = ticketsWithData.find(t => t.id === ticketId);
        const flashType = newStatus === "cancelled" ? "cancelled" : "served";
        showFlash(flashType, `${ticket?.itemName || 'Item'} ${newStatus}`, `${ticket?.sessionLabel || ''}`);
        if (ticket) {
          writeActivityLog({ action: newStatus === "cancelled" ? "TICKET_CANCELLED" : "TICKET_SERVED", storeId: activeStore.id, sessionId, user: appUser, meta: { itemName: ticket.itemName, reason: reason || undefined }, note: `${ticket.itemName} ${newStatus}${reason ? `: ${reason}` : ""}` });
        }

    } catch (error: any) {
        console.error(`Failed to update ticket status to ${newStatus}:`, error);
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update the ticket status." });
    }
  };


  const handleServeBatch = async ({ ticketId, sessionId, qtyToServe }: { ticketId: string; sessionId: string; qtyToServe: number }) => {
    if (!appUser || !activeStore) return;
    const nowMs = Date.now();
    try {
      await runTransaction(db, async (transaction: Transaction) => {
        const ticketRef = doc(db, 'stores', activeStore.id, 'sessions', sessionId, 'kitchentickets', ticketId);
        const ticketSnap = await transaction.get(ticketRef);
        if (!ticketSnap.exists()) throw new Error('Ticket not found.');
        const old = ticketSnap.data() as KitchenTicket;
        if (old.status === 'served' || old.status === 'cancelled') return;
        const qtyOrdered = old.qtyOrdered ?? old.qty ?? 1;
        const qtyServed = (old.qtyServed ?? 0) + qtyToServe;
        const qtyCancelled = old.qtyCancelled ?? 0;
        const qtyRemaining = qtyOrdered - qtyServed - qtyCancelled;
        const newStatus = qtyRemaining <= 0 ? 'served' : 'partially_served';
        const startMs = getStartMs(old.createdAtClientMs ?? old.createdAt);
        const durationMs = startMs ? Math.max(0, nowMs - startMs) : 0;
        const newLogEntry = { qty: qtyToServe, servedAt: nowMs, servedAtClientMs: nowMs, servedByUid: appUser.uid };
        const updatePayload: any = {
          qtyServed, qtyCancelled, qtyRemaining,
          status: newStatus,
          serveLog: [...(old.serveLog ?? []), newLogEntry],
          servedByUid: appUser.uid,
          servedAtClientMs: nowMs,
          servedAt: serverTimestamp(),
          durationMs,
          updatedAt: serverTimestamp(),
        };
        transaction.update(ticketRef, updatePayload);
        const sessionRef = doc(db, 'stores', activeStore.id, 'sessions', sessionId);
        const sessionUpdate: Record<string, any> = {};
        sessionUpdate[`serveCountByType.${old.type}`] = increment(1);
        sessionUpdate[`serveTimeMsTotalByType.${old.type}`] = increment(durationMs);
        transaction.update(sessionRef, sessionUpdate);
        if (old.kitchenLocationId) {
          const rtKdsDocRef = doc(db, 'stores', activeStore.id, 'rtKdsTickets', old.kitchenLocationId);
          if (newStatus === 'served') {
            const rtUpdate: Record<string, any> = {};
            rtUpdate[`tickets.${ticketId}`] = deleteField();
            rtUpdate['activeIds'] = arrayRemove(ticketId);
            rtUpdate[`sessionIndex.${sessionId}`] = arrayRemove(ticketId);
            rtUpdate['meta.updatedAt'] = serverTimestamp();
            transaction.update(rtKdsDocRef, rtUpdate);
            const closedRef = doc(db, 'stores', activeStore.id, 'rtKdsTickets', old.kitchenLocationId, 'closedKdsTickets', ticketId);
            transaction.set(closedRef, { ...old, ...updatePayload, closedAtClientMs: nowMs });
          } else {
            const rtUpdate: Record<string, any> = {};
            rtUpdate[`tickets.${ticketId}.qtyServed`] = qtyServed;
            rtUpdate[`tickets.${ticketId}.qtyRemaining`] = qtyRemaining;
            rtUpdate[`tickets.${ticketId}.status`] = newStatus;
            rtUpdate[`tickets.${ticketId}.serveLog`] = [...(old.serveLog ?? []), newLogEntry];
            rtUpdate['meta.updatedAt'] = serverTimestamp();
            transaction.update(rtKdsDocRef, rtUpdate);
          }
        }
      });
      const ticket = ticketsWithData.find(t => t.id === ticketId);
      showFlash("served", `${qtyToServe} pcs served`);
      if (ticket) {
        writeActivityLog({ action: "TICKET_BATCH_SERVED", storeId: activeStore.id, sessionId, user: appUser, meta: { itemName: ticket.itemName, qty: qtyToServe }, note: `${qtyToServe}x ${ticket.itemName} served` });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Serve Failed', description: error.message });
    }
  };

  const handleCancelRemaining = async ({ ticketId, sessionId, reason }: { ticketId: string; sessionId: string; reason: string }) => {
    if (!appUser || !activeStore) return;
    const nowMs = Date.now();
    try {
      await runTransaction(db, async (transaction: Transaction) => {
        const ticketRef = doc(db, 'stores', activeStore.id, 'sessions', sessionId, 'kitchentickets', ticketId);
        const ticketSnap = await transaction.get(ticketRef);
        if (!ticketSnap.exists()) throw new Error('Ticket not found.');
        const old = ticketSnap.data() as KitchenTicket;
        if (old.status === 'served' || old.status === 'cancelled') return;
        const qtyOrdered = old.qtyOrdered ?? old.qty ?? 1;
        const qtyServed = old.qtyServed ?? 0;
        const qtyRemaining = old.qtyRemaining ?? (qtyOrdered - qtyServed);
        const qtyCancelled = (old.qtyCancelled ?? 0) + qtyRemaining;
        const newStatus = qtyServed > 0 ? 'served' : 'cancelled';
        const updatePayload: any = {
          qtyCancelled, qtyRemaining: 0,
          status: newStatus,
          cancelledAt: serverTimestamp(),
          cancelledAtClientMs: nowMs,
          cancelledByUid: appUser.uid,
          cancelReason: reason,
          updatedAt: serverTimestamp(),
        };
        if (old.type === 'addon' && old.billLineId) {
          const billLineRef = doc(db, 'stores', activeStore.id, 'sessions', sessionId, 'sessionBillLines', old.billLineId);
          const sessionRef = doc(db, 'stores', activeStore.id, 'sessions', sessionId);
          transaction.update(billLineRef, { voidedQty: increment(qtyRemaining), voidReason: "kitchen_cancel", voidNote: "Cancelled by kitchen: " + reason, updatedAt: serverTimestamp() });
          transaction.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });
        }
        transaction.update(ticketRef, updatePayload);
        if (old.kitchenLocationId) {
          const rtKdsDocRef = doc(db, 'stores', activeStore.id, 'rtKdsTickets', old.kitchenLocationId);
          const rtUpdate: Record<string, any> = {};
          rtUpdate[`tickets.${ticketId}`] = deleteField();
          rtUpdate['activeIds'] = arrayRemove(ticketId);
          rtUpdate[`sessionIndex.${sessionId}`] = arrayRemove(ticketId);
          rtUpdate['meta.updatedAt'] = serverTimestamp();
          transaction.update(rtKdsDocRef, rtUpdate);
          const closedRef = doc(db, 'stores', activeStore.id, 'rtKdsTickets', old.kitchenLocationId, 'closedKdsTickets', ticketId);
          transaction.set(closedRef, { ...old, ...updatePayload, closedAtClientMs: nowMs });
        }
      });
      const ticket = ticketsWithData.find(t => t.id === ticketId);
      showFlash("cancelled", "Remaining cancelled", "Already-served qty preserved");
      if (ticket) {
        writeActivityLog({ action: "TICKET_REMAINING_CANCELLED", storeId: activeStore.id, sessionId, user: appUser, meta: { itemName: ticket.itemName, reason }, note: `Remaining ${ticket.itemName} cancelled: ${reason}` });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Cancel Failed', description: error.message });
    }
  };
  const preparingItems = useMemo(() => ticketsWithData.filter(t => t.status === 'preparing' || t.status === 'partially_served'), [ticketsWithData]);

  if (isLoading) {
    return <div className="flex justify-center items-center h-full"><Loader className="animate-spin" size={48} /></div>;
  }

  return (
    <RoleGuard allow={["admin", "manager", "kitchen"]}>
      <PageHeader
        title="Kitchen Display System"
        description="Monitor and manage all active food and beverage orders."
      >
        <div className="flex items-center gap-2">
            <SyncKdsTicketsTool />
            <div className="text-right">
                <p className="text-sm font-medium text-muted-foreground">{activeStationName} Avg Serving Time</p>
                <p className={cn(
                    "text-2xl font-bold font-mono",
                    avgServingTime.avgMs > 0 && avgServingTime.avgMs <= 300000 ? "text-green-600" : "text-destructive"
                )}>
                    {formatDuration(avgServingTime.avgMs)}
                </p>
            </div>
        </div>
      </PageHeader>
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
            <div className="xl:col-span-3">
                 <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    {isMobile ? (
                        <Select value={activeTab} onValueChange={setActiveTab}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a station..." />
                            </SelectTrigger>
                            <SelectContent>
                                {stations.map((station: KitchenStation) => {
                                    const count = stationCounts.get(station.id) || 0;
                                    const late = overSlaByStation.get(station.id) || 0;
                                    return (
                                        <SelectItem key={station.id} value={station.key}>
                                            {station.name} {count > 0 && `(${count})`}{late > 0 && ` · ${late} late`}
                                        </SelectItem>
                                    )
                                })}
                            </SelectContent>
                        </Select>
                    ) : (
                        <TabsList className="gap-2">
                            {stations.map((station: KitchenStation) => {
                                const count = stationCounts.get(station.id) || 0;
                                const late = overSlaByStation.get(station.id) || 0;
                                return (
                                    <TabsTrigger key={station.id} value={station.key} className="relative">
                                        {station.name}
                                        {count > 0 && (
                                            <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{count}</Badge>
                                        )}
                                        {late > 0 && (
                                            <Badge variant="outline" className="ml-2 border-destructive bg-destructive/10 text-destructive text-[10px] px-1.5 py-0 gap-0.5">
                                                {late} late
                                            </Badge>
                                        )}
                                    </TabsTrigger>
                                )
                            })}
                        </TabsList>
                    )}
                    {stations.map((station: KitchenStation) => (
                        <TabsContent key={station.id} value={station.key}>
                            <KdsView tickets={preparingItems} onUpdateStatus={updateTicketStatus} onServeBatch={handleServeBatch} onCancelRemaining={handleCancelRemaining} slaMinutes={activeStationSla} />
                        </TabsContent>
                    ))}
                 </Tabs>
            </div>
            <div className="xl:col-span-1 space-y-4">
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
      <KdsFlashOverlay
        type={flash?.type ?? null}
        message={flash?.message ?? ""}
        subtitle={flash?.subtitle}
        onDone={() => setFlash(null)}
      />
      {activeStore?.id && <CustomerRequestsPanel storeId={activeStore.id} />}
    </RoleGuard>
  );
}
