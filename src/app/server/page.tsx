
"use client";

import { useState, useEffect } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { PendingTables, type PendingSession } from "@/components/server/pending-tables";
import { ReadyToServe, type ReadyItem } from "@/components/server/ready-to-serve";
import { ServedHistory } from "@/components/server/served-history";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, getDocs, collectionGroup, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader } from "lucide-react";
import { SessionTimelineDrawer } from "@/components/session/session-timeline-drawer";
import { RequestChangeDialog } from "@/components/server/request-change-dialog";
import { AddonsPOSModal } from "@/components/cashier/AddonsPOSModal";
import type { StorePackage } from "@/components/manager/store-settings/store-packages-settings";
import type { MenuSchedule } from "@/components/manager/store-settings/schedules-settings";
import { RefillPOSModal } from "@/components/server/RefillPOSModal";


export default function ServerPage() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();

  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [activeSessions, setActiveSessions] = useState<PendingSession[]>([]);
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);
  const [servedItems, setServedItems] = useState<ReadyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);

  // Data for Dialogs
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [isAddonDialogOpen, setIsAddonDialogOpen] = useState(false);
  const [isRefillDialogOpen, setIsRefillDialogOpen] = useState(false);
  const [sessionForRequest, setSessionForRequest] = useState<PendingSession | null>(null);
  const [storePackages, setStorePackages] = useState<StorePackage[]>([]);
  const [schedules, setSchedules] = useState<Map<string, MenuSchedule>>(new Map());
  
  const [isServing, setIsServing] = useState<Record<string, boolean>>({});


  useEffect(() => {
    if (!activeStore) {
      setIsLoading(false);
      setPendingSessions([]);
      setActiveSessions([]);
      setReadyItems([]);
      setServedItems([]);
      return;
    }
    setIsLoading(true);

    const unsubs: (() => void)[] = [];
    const sessionsRef = collection(db, "stores", activeStore.id, "sessions");
    
    // Fetch both pending and active sessions, then sort and filter client-side
    const sessionsQuery = query(sessionsRef, 
      where("sessionMode", "==", "package_dinein"),
      where("status", "in", ["pending_verification", "active"])
    );
    unsubs.push(onSnapshot(sessionsQuery, (snapshot) => {
        const allSessions = snapshot.docs.map(doc => {
            const data = doc.data();
            
            const cashierCount = Number(
                data.guestCountCashierInitial ?? 0
            );

            return { 
                id: doc.id,
                ...data,
                packageName: data.packageSnapshot?.name || 'Unknown Package',
                guestCountCashierInitial: cashierCount,
            } as PendingSession
        });
        
        // Sort client-side
        allSessions.sort((a, b) => {
          const tableNumA = parseInt(a.tableNumber, 10);
          const tableNumB = parseInt(b.tableNumber, 10);
          if (!isNaN(tableNumA) && !isNaN(tableNumB)) {
            return tableNumA - tableNumB;
          }
          return a.tableNumber.localeCompare(b.tableNumber);
        });
        
        setPendingSessions(allSessions.filter(s => s.status === 'pending_verification'));
        setActiveSessions(allSessions.filter(s => s.status === 'active'));
    }));
    
    // Refactored listener for ready items using collectionGroup
    const readyTicketsQuery = query(
        collectionGroup(db, 'kitchentickets'),
        where('storeId', '==', activeStore.id),
        where('status', '==', 'ready'),
        orderBy('preparedAt', 'asc')
    );
    unsubs.push(onSnapshot(readyTicketsQuery, (snapshot) => {
        setReadyItems(snapshot.docs.map(doc => ({
            docId: doc.id,
            ...(doc.data() as any)
        } as ReadyItem)));
    }));
    
    // Listener for recently served items
    const servedTicketsQuery = query(
        collectionGroup(db, 'kitchentickets'),
        where('storeId', '==', activeStore.id),
        where('status', '==', 'served'),
        orderBy('servedAt', 'desc'),
        limit(20)
    );
    unsubs.push(onSnapshot(servedTicketsQuery, (snapshot) => {
         setServedItems(snapshot.docs.map(doc => ({
            docId: doc.id,
            ...(doc.data() as any)
        } as ReadyItem)));
    }));

    
    // Fetch data needed for dialogs
    unsubs.push(onSnapshot(collection(db, "stores", activeStore.id, "storePackages"), s => setStorePackages(s.docs.map(d => d.data() as StorePackage))));
    const schedulesRef = collection(db, "stores", activeStore.id, "menuSchedules");
    const schedulesQuery = query(schedulesRef, where("isActive", "==", true));
    unsubs.push(onSnapshot(schedulesQuery, (snapshot) => {
        const schedulesMap = new Map<string, MenuSchedule>();
        snapshot.docs.forEach(doc => schedulesMap.set(doc.id, { id: doc.id, ...doc.data() } as MenuSchedule));
        setSchedules(schedulesMap);
    }));


    setIsLoading(false);
    return () => unsubs.forEach(unsub => unsub());

  }, [activeStore]);
  
  const handleOpenRequestDialog = (session: PendingSession) => {
    setSessionForRequest(session);
    setIsRequestDialogOpen(true);
  }
  
  const handleOpenAddonDialog = (session: PendingSession) => {
    setSessionForRequest(session);
    setIsAddonDialogOpen(true);
  };
  
  const handleOpenRefillDialog = (session: PendingSession) => {
    setSessionForRequest(session);
    setIsRefillDialogOpen(true);
  }

  const handleMarkServed = async (item: ReadyItem) => {
     if (!appUser || !activeStore || !item.docId) {
        toast({ variant: 'destructive', title: 'Error', description: 'User, store, or ticket ID not found.' });
        return;
     }

    setIsServing(prev => ({...prev, [item.docId!]: true}));

    const ticketRef = doc(db, "stores", activeStore.id, "sessions", item.sessionId, "kitchentickets", item.docId);

    try {
        await updateDoc(ticketRef, {
            status: "served",
            servedAt: serverTimestamp(),
            servedByUid: appUser.uid
        });

        // The listener will automatically remove the item from the UI
        toast({ title: "Item Served", description: `${item.itemName} for Table ${item.tableNumber} marked as served.`});
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message || "Could not mark item as served."});
    } finally {
        setIsServing(prev => ({...prev, [item.docId!]: false}));
    }
  };
  
  const handleVerify = async (session: PendingSession, serverCount: number) => {
    if (!activeStore || !appUser) return;
    
    const cashierInitial = session.guestCountCashierInitial ?? 0;
    const finalCount = Math.max(cashierInitial, serverCount);
    
    const sessionDoc = doc(db, 'stores', activeStore.id, 'sessions', session.id);
    
    try {
      await updateDoc(sessionDoc, {
        guestCountServerVerified: serverCount,
        guestCountFinal: finalCount,
        guestCountVerifyLocked: true,
        status: "active",
        verifiedAt: serverTimestamp(),
        verifiedByUid: appUser.uid,
        updatedAt: serverTimestamp(),
        guestCountCashierInitial: cashierInitial
      });
      toast({ title: 'Session Verified' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Verification Failed', description: e.message });
    }
  };

  if (isLoading) {
      return (
          <div className="flex items-center justify-center h-full">
              <Loader className="animate-spin" size={48} />
          </div>
      )
  }

  return (
    <RoleGuard allow={["admin", "manager", "server"]}>
      <PageHeader title="Server Station" description="Verify guest sessions and track items for serving." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
            <PendingTables
                sessions={[...pendingSessions, ...activeSessions]}
                onVerify={handleVerify}
                onRequestChange={handleOpenRequestDialog}
                onViewTimeline={(sid) => setTimelineSessionId(sid)}
                onAddRefill={handleOpenRefillDialog}
                onAddAddon={handleOpenAddonDialog}
            />
        </div>
        <div className="lg:col-span-1 space-y-6">
            <ReadyToServe
                items={readyItems}
                onMarkServed={handleMarkServed}
                onViewTimeline={(sid) => setTimelineSessionId(sid)}
                isServing={isServing}
            />
            <ServedHistory servedItems={servedItems.slice(0, 20)} />
        </div>
      </div>
       {timelineSessionId && activeStore && (
        <SessionTimelineDrawer
            open={!!timelineSessionId}
            onOpenChange={(isOpen) => !isOpen && setTimelineSessionId(null)}
            storeId={activeStore.id}
            sessionId={timelineSessionId}
        />
       )}
        {isRequestDialogOpen && sessionForRequest && activeStore && (
            <RequestChangeDialog
                isOpen={isRequestDialogOpen}
                onClose={() => setIsRequestDialogOpen(false)}
                session={sessionForRequest}
                storeId={activeStore.id}
                storePackages={storePackages}
                schedules={schedules}
            />
        )}
         {isAddonDialogOpen && sessionForRequest && activeStore && (
            <AddonsPOSModal
                open={isAddonDialogOpen}
                onOpenChange={setIsAddonDialogOpen}
                storeId={activeStore.id}
                session={sessionForRequest}
                sessionIsLocked={sessionForRequest.status === 'closed' || sessionForRequest.isPaid}
            />
        )}
        {isRefillDialogOpen && sessionForRequest && activeStore && (
            <RefillPOSModal
                open={isRefillDialogOpen}
                onOpenChange={setIsRefillDialogOpen}
                storeId={activeStore.id}
                session={sessionForRequest}
                sessionIsLocked={sessionForRequest.status === 'closed' || sessionForRequest.isPaid}
            />
        )}
    </RoleGuard>
  );
}
