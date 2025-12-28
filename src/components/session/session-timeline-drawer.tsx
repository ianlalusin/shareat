
"use client";

import { useState, useEffect, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { db } from "@/lib/firebase/client";
import { collection, doc, onSnapshot, query, where, orderBy, limit, getDocs, Timestamp } from "firebase/firestore";
import { Loader, User, Clock, Package, Users, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppUser, useAuthContext } from "@/context/auth-context";

interface SessionTimelineDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  sessionId: string;
}

type TimelineEvent = {
  id: string;
  timestamp: Date;
  type: string;
  description: string;
  actorUid?: string;
  actorName?: string;
};

// Hook to fetch user profiles for actors
const useUserProfiles = (uids: string[]) => {
    const [profiles, setProfiles] = useState<Record<string, AppUser>>({});
    
    useEffect(() => {
        if (uids.length === 0) return;

        const profilesToFetch = uids.filter(uid => !profiles[uid]);
        if (profilesToFetch.length === 0) return;

        const usersRef = collection(db, "users");
        const q = query(usersRef, where("id", "in", profilesToFetch));

        getDocs(q).then(snapshot => {
            const newProfiles: Record<string, AppUser> = {};
            snapshot.forEach(doc => {
                newProfiles[doc.id] = doc.data() as AppUser;
            });
            setProfiles(prev => ({ ...prev, ...newProfiles }));
        });

    }, [uids, profiles]);

    return profiles;
};

export function SessionTimelineDrawer({ open, onOpenChange, storeId, sessionId }: SessionTimelineDrawerProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Get all unique UIDs from events to fetch profiles
  const actorUids = useMemo(() => {
    return [...new Set(events.map(e => e.actorUid).filter(Boolean) as string[])];
  }, [events]);

  const userProfiles = useUserProfiles(actorUids);


  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
    const billHistoryRef = collection(db, "stores", storeId, "sessions", sessionId, "billHistory");
    const paymentsRef = collection(db, "stores", storeId, "sessions",sessionId, "payments");
    const activityLogsRef = collection(db, "stores", storeId, "activityLogs");
    const activityQuery = query(activityLogsRef, where("sessionId", "==", sessionId), orderBy("createdAt", "desc"), limit(200));

    const processAndSetEvents = (
        sessionData: any, 
        ticketsData: any[],
        billHistoryData: any[], 
        paymentsData: any[],
        activityLogsData: any[]
    ) => {
        let allEvents: TimelineEvent[] = [];

        // 1. Session Start/End
        if (sessionData?.startedAt) {
            allEvents.push({
                id: `${sessionId}-start`,
                timestamp: sessionData.startedAt.toDate(),
                type: 'session',
                description: 'Session started.',
                actorUid: sessionData.startedByUid,
            });
        }
        if (sessionData?.closedAt) {
             allEvents.push({
                id: `${sessionId}-closed`,
                timestamp: sessionData.closedAt.toDate(),
                type: 'session',
                description: 'Session closed.',
                actorUid: sessionData.closedByUid,
            });
        }
        if (sessionData?.verifiedAt) {
             allEvents.push({
                id: `${sessionId}-verified`,
                timestamp: sessionData.verifiedAt.toDate(),
                type: 'session',
                description: `Session verified with ${sessionData.guestCountFinal} guests.`,
                actorUid: sessionData.verifiedByUid,
            });
        }

        // 2. Guest Count & Package Changes
        const { guestCountChange, packageChange } = sessionData;
        if (guestCountChange?.requestedAt) {
             allEvents.push({
                id: `${sessionId}-gc-req`,
                timestamp: guestCountChange.requestedAt.toDate(),
                type: 'change_request',
                description: `Requested guest count change to ${guestCountChange.requestedCount}.`,
                actorUid: guestCountChange.requestedByUid,
            });
        }
        if (guestCountChange?.approvedAt) {
             allEvents.push({
                id: `${sessionId}-gc-approve`,
                timestamp: guestCountChange.approvedAt.toDate(),
                type: 'change_approval',
                description: `Guest count change to ${sessionData.guestCountFinal} approved.`,
                actorUid: guestCountChange.approvedByUid,
            });
        }
        if (guestCountChange?.rejectedAt) {
            allEvents.push({
               id: `${sessionId}-gc-reject`,
               timestamp: guestCountChange.rejectedAt.toDate(),
               type: 'change_rejection',
               description: `Guest count change request was rejected.`,
               actorUid: guestCountChange.rejectedByUid,
           });
       }
         if (packageChange?.requestedAt) {
             allEvents.push({
                id: `${sessionId}-pkg-req`,
                timestamp: packageChange.requestedAt.toDate(),
                type: 'change_request',
                description: `Requested package change to "${packageChange.requestedPackageSnapshot?.name}".`,
                actorUid: packageChange.requestedByUid,
            });
        }
        if (packageChange?.approvedAt) {
             allEvents.push({
                id: `${sessionId}-pkg-approve`,
                timestamp: packageChange.approvedAt.toDate(),
                type: 'change_approval',
                description: `Package change to "${sessionData.packageSnapshot?.name}" approved.`,
                actorUid: packageChange.approvedByUid,
            });
        }
        if (packageChange?.rejectedAt) {
            allEvents.push({
                id: `${sessionId}-pkg-reject`,
                timestamp: packageChange.rejectedAt.toDate(),
                type: 'change_rejection',
                description: `Package change request was rejected.`,
                actorUid: packageChange.rejectedByUid,
            });
        }


        // 3. Kitchen Tickets (including Refills)
        ticketsData.forEach(ticket => {
            const isRefill = ticket.type === 'refill';
            if (ticket.createdAt) allEvents.push({
                id: `${ticket.id}-created`,
                timestamp: ticket.createdAt.toDate(),
                type: isRefill ? 'refill_order' : 'kitchen',
                description: `${isRefill ? 'Refill ordered' : 'Ticket created'} for ${ticket.itemName}.`,
                actorUid: ticket.createdByUid
            });
            if (ticket.preparedAt) allEvents.push({
                id: `${ticket.id}-ready`,
                timestamp: ticket.preparedAt.toDate(),
                type: 'kitchen',
                description: `${ticket.itemName} marked as ready.`,
                actorUid: ticket.preparedByUid
            });
             if (ticket.servedAt) allEvents.push({
                id: `${ticket.id}-served`,
                timestamp: ticket.servedAt.toDate(),
                type: 'kitchen',
                description: `${ticket.itemName} marked as served.`,
                actorUid: ticket.servedByUid
            });
             if (ticket.cancelledAt) allEvents.push({
                id: `${ticket.id}-cancelled`,
                timestamp: ticket.cancelledAt.toDate(),
                type: 'kitchen',
                description: `${ticket.itemName} was cancelled. Reason: ${ticket.cancelReason || 'N/A'}.`,
                actorUid: ticket.cancelledByUid
            });
        });
        
        // 4. Bill History
        billHistoryData.forEach(entry => {
            const before = entry.before ? JSON.stringify(entry.before) : '';
            const after = entry.after ? JSON.stringify(entry.after) : '';
            allEvents.push({
                id: entry.id,
                timestamp: entry.createdAt.toDate(),
                type: 'billing',
                description: `Bill item ${entry.action}: ${before} -> ${after}`,
                actorUid: entry.performedByUid
            });
        });
        
        // 5. Payments
        paymentsData.forEach(payment => {
            allEvents.push({
                id: payment.id,
                timestamp: payment.createdAt.toDate(),
                type: 'payment',
                description: `Payment of ₱${payment.amount.toFixed(2)} received via ${payment.methodId}.`,
                actorUid: payment.createdByUid
            });
        });

        // Sort and set
        allEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setEvents(allEvents);
        setLoading(false);
    };

    // Use onSnapshot for live data where needed, getDocs for one-time fetch
    const unsubSession = onSnapshot(sessionRef, async (sessionSnap) => {
        const sessionData = sessionSnap.data();

        const [ticketsSnap, billHistorySnap, paymentsSnap] = await Promise.all([
            getDocs(ticketsRef),
            getDocs(billHistoryRef),
            getDocs(paymentsRef)
        ]);

        const ticketsData = ticketsSnap.docs.map(d => ({id: d.id, ...d.data()}));
        const billHistoryData = billHistorySnap.docs.map(d => ({id: d.id, ...d.data()}));
        const paymentsData = paymentsSnap.docs.map(d => ({id: d.id, ...d.data()}));

        processAndSetEvents(sessionData, ticketsData, billHistoryData, paymentsData, []); // Activity logs handled separately if live
    });
    
    // Cleanup
    return () => {
      unsubSession();
    };
  }, [open, storeId, sessionId]);
  
  const getBadgeVariant = (type: string) => {
    switch(type) {
        case 'session': return 'default';
        case 'kitchen': return 'secondary';
        case 'billing': return 'outline';
        case 'payment': return 'destructive';
        case 'change_request': return 'destructive';
        case 'change_approval': return 'default';
        case 'change_rejection': return 'destructive';
        case 'refill_order': return 'secondary';
        default: return 'secondary';
    }
  }
  
  const getIcon = (type: string) => {
    switch(type) {
        case 'session': return <Users className="h-4 w-4" />;
        case 'kitchen': return <Utensils className="h-4 w-4" />;
        case 'refill_order': return <Utensils className="h-4 w-4" />;
        case 'change_request': return <Package className="h-4 w-4" />;
        case 'change_approval': return <Package className="h-4 w-4" />;
        case 'change_rejection': return <Package className="h-4 w-4" />;
        case 'billing': return <Package className="h-4 w-4" />;
        case 'payment': return <Package className="h-4 w-4" />;
        default: return <Clock className="h-4 w-4" />;
    }
  }


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Session Timeline</SheetTitle>
          <SheetDescription>A detailed audit trail for session {sessionId?.substring(0,6)}.</SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="flex-grow flex items-center justify-center">
            <Loader className="animate-spin" />
          </div>
        ) : (
          <ScrollArea className="flex-grow">
            <div className="pr-4">
              {events.map((event, index) => (
                <div key={`${event.id}-${index}`} className="relative pl-8 py-4 group">
                    {/* Vertical line */}
                    <div className="absolute left-3 top-0 h-full w-px bg-border"></div>

                    {/* Dot on the line */}
                    <div className="absolute left-3 top-[22px] -translate-x-1/2 w-2.5 h-2.5 bg-background border-2 border-primary rounded-full z-10"></div>
                    
                    <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            <Badge variant={getBadgeVariant(event.type)} className="capitalize">{event.type.replace('_', ' ')}</Badge>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock size={12} />
                                {format(event.timestamp, "MMM d, HH:mm:ss")}
                            </p>
                         </div>
                         <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                         </p>
                    </div>

                    <p className="text-sm mt-1">{event.description}</p>
                    
                    {event.actorUid && (
                        <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                            <User size={12} /> Performed by: {userProfiles[event.actorUid]?.name || event.actorUid.substring(0,6)}
                        </div>
                    )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
