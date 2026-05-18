"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MessageCircle, Check, Clock as ClockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { writeActivityLog } from "@/components/cashier/activity-log";

type CustomerRequest = {
  id: string;
  storeId: string;
  sessionId: string;
  participantId?: string;
  text: string;
  tableNumber?: string;
  tableDisplayName?: string;
  customerName?: string | null;
  status: "pending" | "done";
  createdAtClientMs: number;
  createdAt?: any;
  doneAt?: any;
  doneByUid?: string | null;
  doneByUsername?: string | null;
};

function fmtRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ageColorClass(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / 60000);
  if (minutes >= 10) return "text-destructive font-semibold";
  if (minutes >= 5) return "text-amber-600 font-medium";
  return "text-muted-foreground";
}

export function CustomerRequestsPanel({ storeId }: { storeId: string | null | undefined }) {
  const { appUser } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick once every 30s so the "elapsed" labels stay fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to customerRequests for the current store. Only today's docs are kept
  // in memory; older ones live in the activity log for audit.
  useEffect(() => {
    if (!storeId) {
      setRequests([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const ref = collection(db, `stores/${storeId}/customerRequests`);
    const q = query(ref, where("createdAtClientMs", ">=", todayStart.getTime()), orderBy("createdAtClientMs", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as CustomerRequest[];
        setRequests(rows);
        setIsLoading(false);
      },
      (err) => {
        console.error("CustomerRequestsPanel snapshot error:", err);
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [storeId]);

  // Pending: oldest first so the longest-waiting customer is at the top.
  // Done: most recently created first (snapshot is already desc by createdAtClientMs).
  const pending = useMemo(
    () =>
      requests
        .filter((r) => r.status === "pending")
        .slice()
        .sort((a, b) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0)),
    [requests]
  );
  const done = useMemo(() => requests.filter((r) => r.status === "done"), [requests]);

  async function markDone(req: CustomerRequest) {
    if (!storeId) return;
    setBusyId(req.id);
    try {
      const requestRef = doc(db, `stores/${storeId}/customerRequests/${req.id}`);
      await updateDoc(requestRef, {
        status: "done",
        doneAt: serverTimestamp(),
        doneByUid: appUser?.uid ?? null,
        doneByUsername: appUser?.displayName || appUser?.name || null,
      });
      void writeActivityLog({
        storeId,
        sessionId: req.sessionId,
        user: appUser ?? null,
        action: "CUSTOMER_REQUEST_COMPLETED",
        sessionContext: {
          customerName: req.customerName ?? null,
          tableNumber: req.tableNumber ?? null,
          tableDisplayName: req.tableDisplayName ?? null,
        },
        meta: { requestId: req.id, text: req.text },
      });
    } catch (e) {
      console.error("markDone failed:", e);
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = pending.length;

  return (
    <>
      {/* Floating action button */}
      <div className="fixed bottom-6 right-6 z-40">
        {pendingCount > 0 && !open && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-destructive/60 animate-ping"
          />
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "relative h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-2xl",
            "flex items-center justify-center hover:scale-105 active:scale-95 transition-transform",
            "ring-4 ring-primary/20",
            pendingCount > 0 && !open && "animate-bounce"
          )}
          aria-label="Customer requests"
          title={pendingCount > 0 ? `${pendingCount} pending request${pendingCount > 1 ? "s" : ""}` : "Customer requests"}
        >
          <MessageCircle className="h-6 w-6" />
          {pendingCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-6 min-w-6 px-1.5 justify-center text-xs font-bold"
            >
              {pendingCount}
            </Badge>
          )}
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[420px] p-0 flex flex-col"
        >
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Customer Requests
            </SheetTitle>
            <SheetDescription>Free-text requests sent from the customer app.</SheetDescription>
          </SheetHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "pending" | "done")} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid grid-cols-2 m-4 mb-2">
              <TabsTrigger value="pending" className="relative">
                Pending
                {pendingCount > 0 && (
                  <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 justify-center text-xs">
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="done">Done</TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="flex-1 min-h-0 m-0">
              <ScrollArea className="h-full px-4 pb-4">
                {isLoading ? (
                  <div className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </div>
                ) : pending.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    No pending requests.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pending.map((r) => (
                      <div key={r.id} className="rounded-lg border bg-background p-3 shadow-sm">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="font-semibold text-sm">
                            {r.tableDisplayName || (r.tableNumber ? `Table ${r.tableNumber}` : "—")}
                            {r.customerName ? <span className="text-muted-foreground font-normal"> · {r.customerName}</span> : null}
                          </div>
                          <span className={cn("flex items-center gap-1 text-xs", ageColorClass(r.createdAtClientMs, now))}>
                            <ClockIcon className="h-3 w-3" />
                            {fmtRelative(r.createdAtClientMs, now)}
                          </span>
                        </div>
                        <p className="text-base whitespace-pre-wrap break-words leading-snug py-1">
                          &ldquo;{r.text}&rdquo;
                        </p>
                        <div className="flex items-center justify-between gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">{fmtClock(r.createdAtClientMs)}</span>
                          <Button
                            size="sm"
                            onClick={() => markDone(r)}
                            disabled={busyId === r.id}
                          >
                            {busyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="mr-1 h-4 w-4" />
                                Done
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="done" className="flex-1 min-h-0 m-0">
              <ScrollArea className="h-full px-4 pb-4">
                {isLoading ? (
                  <div className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </div>
                ) : done.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    No completed requests yet today.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {done.map((r) => (
                      <div key={r.id} className="rounded-lg border bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="font-semibold text-sm text-muted-foreground">
                            {r.tableDisplayName || (r.tableNumber ? `Table ${r.tableNumber}` : "—")}
                            {r.customerName ? <span className="font-normal"> · {r.customerName}</span> : null}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {fmtRelative(r.createdAtClientMs, now)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground line-through">
                          &ldquo;{r.text}&rdquo;
                        </p>
                        <div className="text-xs text-muted-foreground mt-1">
                          Done by {r.doneByUsername || "staff"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
