

"use client";

import { useState, useEffect, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { db } from "@/lib/firebase/client";
import { collection, doc, onSnapshot, query, where, orderBy, limit, getDocs, Timestamp, documentId } from "firebase/firestore";
import { Loader, User, Clock, Package, Users, Utensils, CreditCard, Scissors, Gift, Tag, Ban, ArrowRightLeft, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppUser, useAuthContext } from "@/context/auth-context";
import { toJsDate } from "@/lib/utils/date";

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
  detail?: string;
};

// Hook to fetch user profiles for actors, now with chunking
const useUserProfiles = (uids: string[]) => {
    const [profiles, setProfiles] = useState<Record<string, AppUser>>({});

    useEffect(() => {
        if (uids.length === 0) return;

        const profilesToFetch = uids.filter(uid => !profiles[uid]);
        if (profilesToFetch.length === 0) return;

        const staffRef = collection(db, "staff");

        const fetchInChunks = async () => {
            const idChunks: string[][] = [];
            for (let i = 0; i < profilesToFetch.length; i += 10) {
                idChunks.push(profilesToFetch.slice(i, i + 10));
            }

            const newProfiles: Record<string, AppUser> = {};
            for (const chunk of idChunks) {
                if (chunk.length > 0) {
                    const q = query(staffRef, where(documentId(), "in", chunk));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(doc => {
                        newProfiles[doc.id] = doc.data() as AppUser;
                    });
                }
            }
            setProfiles(prev => ({ ...prev, ...newProfiles }));
        };

        fetchInChunks();

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uids.join(",")]);

    return profiles;
};

// Map activity log action to a human-readable description
function describeActivityLog(log: any): { description: string; detail?: string; type: string } | null {
  const meta = log.meta ?? {};
  const qty = log.qty ?? meta.qty;
  const itemName = meta.itemName ?? "";

  switch (log.action) {
    case "SESSION_STARTED":
      return null; // Shown from session document data with richer context
    case "SESSION_VOIDED":
      return { type: "void", description: `Session voided`, detail: log.reason || meta.reason || undefined };
    case "SESSION_AUDIT_FLAGGED":
      return { type: "adjustment", description: "Session flagged for manager review", detail: log.reason || meta.reason || undefined };
    case "SESSION_AUDIT_CLEARED":
      return { type: "adjustment", description: "Session audit flag cleared", detail: log.reason || meta.reason || undefined };
    case "VOID_TICKETS":
      return { type: "void", description: `Voided ${qty ? qty + "x " : ""}${itemName}`, detail: log.reason || undefined };
    case "UNVOID":
      return { type: "adjustment", description: `Unvoided ${qty ? qty + "x " : ""}${itemName}` };
    case "MARK_FREE":
      return { type: "free", description: `Marked ${qty ? qty + "x " : ""}${itemName} as free`, detail: meta.amount ? `₱${Number(meta.amount).toFixed(2)} value` : undefined };
    case "UNMARK_FREE":
      return { type: "adjustment", description: `Removed free from ${qty ? qty + "x " : ""}${itemName}` };
    case "DISCOUNT_APPLIED":
      return { type: "discount", description: `Discount applied${itemName ? ` to ${itemName}` : ""}`, detail: meta.discountName || meta.adjustmentName || undefined };
    case "DISCOUNT_REMOVED":
      return { type: "discount", description: `Discount removed${itemName ? ` from ${itemName}` : ""}`, detail: log.note || undefined };
    case "DISCOUNT_EDITED":
      return { type: "discount", description: `Discount edited`, detail: log.note || undefined };
    case "PACKAGE_QTY_OVERRIDE_SET":
      return { type: "adjustment", description: `Package qty manually set to ${meta.afterQty ?? "?"}`, detail: meta.beforeQty != null ? `Was ${meta.beforeQty}` : undefined };
    case "PACKAGE_QTY_RESYNC_APPROVED_CHANGE":
      return { type: "adjustment", description: `Package qty auto-synced to ${meta.afterQty ?? "?"}`, detail: meta.beforeQty != null ? `Was ${meta.beforeQty} (guest count approved)` : undefined };
    case "PAYMENT_COMPLETED":
      return { type: "payment", description: `Payment completed${meta.paymentTotal ? ` — ₱${Number(meta.paymentTotal).toFixed(2)}` : ""}`, detail: meta.receiptNumber ? `Receipt: ${meta.receiptNumber}` : undefined };
    case "RECEIPT_EDITED":
      return { type: "billing", description: "Receipt edited after close", detail: log.note || undefined };
    case "RECEIPT_VOIDED":
      return { type: "void", description: "Receipt voided", detail: log.reason || undefined };
    case "PRICE_OVERRIDE":
      return { type: "adjustment", description: `Price override on ${itemName}` };
    case "ADDON_ADDED":
      return { type: "kitchen", description: `Addon added: ${itemName}${qty ? ` (${qty}x)` : ""}` };
    case "REFILL_ADDED":
      return { type: "kitchen", description: `Refill ordered: ${itemName}${qty ? ` (${qty}x)` : ""}` };
    case "BILL_DISCOUNT_APPLIED":
      return { type: "discount", description: `Bill discount applied`, detail: meta.discountName || log.note || undefined };
    case "BILL_DISCOUNT_REMOVED":
      return { type: "discount", description: `Bill discount removed` };
    case "CUSTOM_CHARGE_ADDED":
      return { type: "adjustment", description: `Custom charge added`, detail: log.note || undefined };
    case "CUSTOM_CHARGE_REMOVED":
      return { type: "adjustment", description: `Custom charge removed`, detail: log.note || undefined };
    case "GUEST_COUNT_REQUESTED":
      return { type: "change_request", description: `Guest count change requested → ${meta.newQty ?? "?"}`, detail: meta.beforeQty != null ? `Was ${meta.beforeQty}` : undefined };
    case "GUEST_COUNT_APPROVED":
      return { type: "change_approval", description: `Guest count change approved → ${meta.afterQty ?? "?"}` };
    case "GUEST_COUNT_REJECTED":
      return { type: "change_rejection", description: `Guest count change rejected` };
    case "PACKAGE_CHANGE_REQUESTED":
      return { type: "change_request", description: `Package change requested`, detail: meta.itemName || log.note || undefined };
    case "PACKAGE_CHANGE_APPROVED":
      return { type: "change_approval", description: `Package changed`, detail: meta.itemName || log.note || undefined };
    case "PACKAGE_CHANGE_REJECTED":
      return { type: "change_rejection", description: `Package change rejected` };
    case "TICKET_SERVED":
      return { type: "kitchen", description: `${itemName} served` };
    case "TICKET_CANCELLED":
      return { type: "void", description: `${itemName} cancelled in kitchen`, detail: log.reason || meta.reason || undefined };
    case "TICKET_BATCH_SERVED":
      return { type: "kitchen", description: `${qty ? qty + "x " : ""}${itemName} served` };
    case "TICKET_REMAINING_CANCELLED":
      return { type: "void", description: `Remaining ${itemName} cancelled`, detail: log.reason || meta.reason || undefined };
    case "SESSION_VERIFIED":
      return { type: "session", description: `Session verified — ${meta.finalCount ?? meta.serverCount ?? "?"} guests` };
    default:
      return { type: "adjustment", description: log.action?.replace(/_/g, " ") || "Unknown action", detail: log.note || undefined };
  }
}

export function SessionTimelineDrawer({ open, onOpenChange, storeId, sessionId }: SessionTimelineDrawerProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const actorUids = useMemo(() => {
    return [...new Set(events.map(e => e.actorUid).filter(Boolean) as string[])];
  }, [events]);

  const userProfiles = useUserProfiles(actorUids);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
    const activityLogsRef = collection(db, "stores", storeId, "sessions", sessionId, "activityLogs");
    const activityQuery = query(activityLogsRef, orderBy("createdAt", "desc"), limit(200));

    const processAndSetEvents = (
        sessionData: any,
        ticketsData: any[],
        activityLogsData: any[]
    ) => {
        let allEvents: (TimelineEvent | null)[] = [];

        // 1. Session Start — enhanced with mode, package, guest count
        if (sessionData?.startedAt) {
            const mode = sessionData.sessionMode === 'alacarte' ? 'Ala Carte' : 'Package Dine-in';
            const pkg = sessionData.packageSnapshot?.name;
            const guests = sessionData.guestCountCashierInitial;
            let desc = `Session started (${mode})`;
            let detail = [
              pkg ? `Package: ${pkg}` : null,
              guests ? `Initial guests: ${guests}` : null,
              sessionData.customerName || sessionData.customer?.name ? `Customer: ${sessionData.customerName || sessionData.customer?.name}` : null,
            ].filter(Boolean).join(" · ");
            allEvents.push({
                id: `${sessionId}-start`,
                timestamp: toJsDate(sessionData.startedAt)!,
                type: 'session',
                description: desc,
                detail: detail || undefined,
                actorUid: sessionData.startedByUid,
            });
        }
        if (sessionData?.verifiedAt) {
             allEvents.push({
                id: `${sessionId}-verified`,
                timestamp: toJsDate(sessionData.verifiedAt)!,
                type: 'session',
                description: `Session verified — ${sessionData.guestCountServerVerified ?? sessionData.guestCountFinal ?? "?"} guests confirmed`,
                actorUid: sessionData.verifiedByUid,
            });
        }

        // 2. Guest Count & Package Changes
        const { guestCountChange, packageChange } = sessionData ?? {};
        if (guestCountChange?.requestedAt) {
             allEvents.push({
                id: `${sessionId}-gc-req`,
                timestamp: toJsDate(guestCountChange.requestedAt)!,
                type: 'change_request',
                description: `Guest count change requested → ${guestCountChange.requestedCount}`,
                detail: guestCountChange.previousCount != null ? `Was ${guestCountChange.previousCount}` : undefined,
                actorUid: guestCountChange.requestedByUid,
            });
        }
        if (guestCountChange?.approvedAt) {
             allEvents.push({
                id: `${sessionId}-gc-approve`,
                timestamp: toJsDate(guestCountChange.approvedAt)!,
                type: 'change_approval',
                description: `Guest count change approved → ${sessionData.guestCountFinal}`,
                actorUid: guestCountChange.approvedByUid,
            });
        }
        if (guestCountChange?.rejectedAt) {
            allEvents.push({
               id: `${sessionId}-gc-reject`,
               timestamp: toJsDate(guestCountChange.rejectedAt)!,
               type: 'change_rejection',
               description: `Guest count change request rejected`,
               actorUid: guestCountChange.rejectedByUid,
           });
       }
        if (packageChange?.requestedAt) {
             allEvents.push({
                id: `${sessionId}-pkg-req`,
                timestamp: toJsDate(packageChange.requestedAt)!,
                type: 'change_request',
                description: `Package change requested → "${packageChange.requestedPackageSnapshot?.name}"`,
                actorUid: packageChange.requestedByUid,
            });
        }
        if (packageChange?.approvedAt) {
             allEvents.push({
                id: `${sessionId}-pkg-approve`,
                timestamp: toJsDate(packageChange.approvedAt)!,
                type: 'change_approval',
                description: `Package changed to "${sessionData?.packageSnapshot?.name}"`,
                actorUid: packageChange.approvedByUid,
            });
        }
        if (packageChange?.rejectedAt) {
            allEvents.push({
                id: `${sessionId}-pkg-reject`,
                timestamp: toJsDate(packageChange.rejectedAt)!,
                type: 'change_rejection',
                description: `Package change request rejected`,
                actorUid: packageChange.rejectedByUid,
            });
        }

        // 3. Kitchen Tickets — with qty for batch items
        ticketsData.forEach(ticket => {
            const isRefill = ticket.type === 'refill';
            const qtyLabel = (ticket.qtyOrdered ?? ticket.qty ?? 1) > 1 ? ` (${ticket.qtyOrdered ?? ticket.qty}x)` : "";
            if (ticket.createdAt) allEvents.push({
                id: `${ticket.id}-created`,
                timestamp: toJsDate(ticket.createdAt)!,
                type: isRefill ? 'refill_order' : 'kitchen',
                description: `${isRefill ? 'Refill ordered' : 'Order sent'}: ${ticket.itemName}${qtyLabel}`,
                actorUid: ticket.createdByUid
            });
            if (ticket.servedAt) allEvents.push({
                id: `${ticket.id}-served`,
                timestamp: toJsDate(ticket.servedAt)!,
                type: 'kitchen',
                description: `${ticket.itemName} served${qtyLabel}`,
                actorUid: ticket.servedByUid
            });
            if (ticket.cancelledAt) allEvents.push({
                id: `${ticket.id}-cancelled`,
                timestamp: toJsDate(ticket.cancelledAt)!,
                type: 'void',
                description: `${ticket.itemName} cancelled`,
                detail: ticket.cancelReason ? `Reason: ${ticket.cancelReason}` : undefined,
                actorUid: ticket.cancelledByUid
            });
            // Batch serve logs
            if (Array.isArray(ticket.serveLog)) {
              ticket.serveLog.forEach((entry: any, i: number) => {
                if (entry.servedAt) {
                  allEvents.push({
                    id: `${ticket.id}-serve-${i}`,
                    timestamp: toJsDate(entry.servedAt)!,
                    type: 'kitchen',
                    description: `Served ${entry.qtyServed ?? "?"}x ${ticket.itemName}`,
                    actorUid: entry.servedByUid,
                  });
                }
              });
            }
        });

        // 4. Activity Logs — voids, discounts, free, adjustments
        activityLogsData.forEach(log => {
            const result = describeActivityLog(log);
            if (!result) return; // skip duplicates (SESSION_STARTED, PAYMENT_COMPLETED)
            const ts = toJsDate(log.createdAt);
            if (!ts) return;
            allEvents.push({
                id: log.id,
                timestamp: ts,
                type: result.type,
                description: result.description,
                detail: result.detail,
                actorUid: log.actorUid || log.user?.uid,
                actorName: log.actorName || log.user?.name,
            });
        });

        // 6. Session closed
        if (sessionData?.closedAt) {
            const totals = sessionData.receiptSnapshot ?? {};
            let detail = [
              totals.grandTotal != null ? `Grand Total: ₱${Number(totals.grandTotal).toFixed(2)}` : null,
              totals.change != null && totals.change > 0 ? `Change: ₱${Number(totals.change).toFixed(2)}` : null,
            ].filter(Boolean).join(" · ");
            allEvents.push({
                id: `${sessionId}-closed`,
                timestamp: toJsDate(sessionData.closedAt)!,
                type: 'session',
                description: `Session closed — billed ${sessionData.guestCountFinal ?? "?"} guests`,
                detail: detail || undefined,
                actorUid: sessionData.closedByUid,
            });
        }

        const validEvents = allEvents.filter(event => event !== null && event.timestamp instanceof Date) as TimelineEvent[];
        validEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setEvents(validEvents);
        setLoading(false);
    };

    const unsubSession = onSnapshot(sessionRef, async (sessionSnap) => {
        const sessionData = sessionSnap.data({ serverTimestamps: "estimate" });

        const [ticketsSnap, activitySnap] = await Promise.all([
            getDocs(ticketsRef),
            getDocs(activityQuery),
        ]);

        const ticketsData = ticketsSnap.docs.map(d => ({id: d.id, ...d.data()}));
        const activityData = activitySnap.docs.map(d => ({id: d.id, ...d.data()}));

        processAndSetEvents(sessionData, ticketsData, activityData);
    });

    return () => {
      unsubSession();
    };
  }, [open, storeId, sessionId]);

  const getBadgeVariant = (type: string): "default" | "secondary" | "outline" | "destructive" => {
    switch(type) {
        case 'session': return 'default';
        case 'kitchen': return 'secondary';
        case 'refill_order': return 'secondary';
        case 'payment': return 'default';
        case 'change_request': return 'outline';
        case 'change_approval': return 'default';
        case 'change_rejection': return 'destructive';
        case 'void': return 'destructive';
        case 'free': return 'default';
        case 'discount': return 'outline';
        case 'adjustment': return 'outline';
        case 'billing': return 'outline';
        default: return 'secondary';
    }
  };

  const getBadgeClassName = (type: string) => {
    switch(type) {
      case 'void': return 'bg-red-100 text-red-700 border-red-200';
      case 'free': return 'bg-green-100 text-green-700 border-green-200';
      case 'discount': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return '';
    }
  };

  const getIcon = (type: string) => {
    switch(type) {
        case 'session': return <Users className="h-4 w-4" />;
        case 'kitchen': return <Utensils className="h-4 w-4" />;
        case 'refill_order': return <Utensils className="h-4 w-4" />;
        case 'change_request': return <ArrowRightLeft className="h-4 w-4" />;
        case 'change_approval': return <Package className="h-4 w-4" />;
        case 'change_rejection': return <Ban className="h-4 w-4" />;
        case 'payment': return <CreditCard className="h-4 w-4" />;
        case 'void': return <Scissors className="h-4 w-4" />;
        case 'free': return <Gift className="h-4 w-4" />;
        case 'discount': return <Tag className="h-4 w-4" />;
        case 'adjustment': return <FileText className="h-4 w-4" />;
        case 'billing': return <FileText className="h-4 w-4" />;
        default: return <Clock className="h-4 w-4" />;
    }
  };

  const getDotColor = (type: string) => {
    switch (type) {
      case 'void': return 'border-red-500 bg-red-50';
      case 'free': return 'border-green-500 bg-green-50';
      case 'discount': return 'border-amber-500 bg-amber-50';
      case 'payment': return 'border-blue-500 bg-blue-50';
      default: return 'border-primary bg-background';
    }
  };

  const getLabel = (type: string) => {
    switch(type) {
      case 'session': return 'Session';
      case 'kitchen': return 'Kitchen';
      case 'refill_order': return 'Refill';
      case 'change_request': return 'Request';
      case 'change_approval': return 'Approved';
      case 'change_rejection': return 'Rejected';
      case 'payment': return 'Payment';
      case 'void': return 'Void';
      case 'free': return 'Free';
      case 'discount': return 'Discount';
      case 'adjustment': return 'Adjustment';
      case 'billing': return 'Billing';
      default: return type;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Session Timeline</SheetTitle>
          <SheetDescription>Audit trail for session {sessionId?.substring(0,6)}.</SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="flex-grow flex items-center justify-center">
            <Loader className="animate-spin" />
          </div>
        ) : (
          <ScrollArea className="flex-grow">
            <div className="pr-4">
              {events.map((event, index) => (
                <div key={`${event.id}-${index}`} className="relative pl-8 py-3 group">
                    {/* Vertical line */}
                    <div className="absolute left-3 top-0 h-full w-px bg-border"></div>

                    {/* Dot on the line */}
                    <div className={`absolute left-3 top-[18px] -translate-x-1/2 w-2.5 h-2.5 border-2 rounded-full z-10 ${getDotColor(event.type)}`}></div>

                    <div className="flex items-center justify-between gap-2">
                         <div className="flex items-center gap-1.5 min-w-0">
                            <Badge variant={getBadgeVariant(event.type)} className={`text-[10px] px-1.5 py-0 shrink-0 ${getBadgeClassName(event.type)}`}>
                              {getLabel(event.type)}
                            </Badge>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                                <Clock size={10} />
                                {format(event.timestamp, "HH:mm:ss")}
                            </p>
                         </div>
                         <p className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                         </p>
                    </div>

                    <p className="text-sm mt-1">{event.description}</p>
                    {event.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{event.detail}</p>
                    )}

                    {(event.actorUid || event.actorName) && (
                        <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                            <User size={10} /> {event.actorName || userProfiles[event.actorUid!]?.name || event.actorUid?.substring(0,6)}
                        </div>
                    )}
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">No events found.</p>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
