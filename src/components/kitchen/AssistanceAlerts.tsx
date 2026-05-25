"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useLocalProfile } from "@/context/local-profile-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, BellRing } from "lucide-react";
import { fireKitchenAlert, primeKitchenAudio } from "@/lib/notifications/kitchenAlert";
import { writeActivityLog } from "@/components/cashier/activity-log";

type AssistanceRequest = {
  id: string;
  sessionId: string;
  tableNumber?: string;
  tableDisplayName?: string | null;
  customerName?: string | null;
  status: "pending" | "done";
  createdAtClientMs: number;
};

function tableLabel(r: AssistanceRequest): string {
  return r.tableDisplayName || (r.tableNumber ? `Table ${r.tableNumber}` : "Unknown table");
}

function waitedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/**
 * Blocking, OK-to-dismiss alert (with chime) for customer "Ask for assistance"
 * calls. Mounted on the KDS and Server pages. Acknowledging (OK) resolves the
 * request for all devices and records the local user + response time.
 */
export function AssistanceAlerts({ storeId }: { storeId: string | null | undefined }) {
  const { appUser } = useAuthContext();
  const { currentProfile } = useLocalProfile();
  const [requests, setRequests] = useState<AssistanceRequest[]>([]);
  const [acking, setAcking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => { primeKitchenAudio(); }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!storeId) {
      setRequests([]);
      return;
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const ref = collection(db, `stores/${storeId}/customerRequests`);
    // Single-field range+order (no composite index); filter status/type client-side.
    const q = query(ref, where("createdAtClientMs", ">=", todayStart.getTime()), orderBy("createdAtClientMs", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const pending = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((r) => r.status === "pending" && r.type === "assistance") as AssistanceRequest[];

        // Chime + OS notify on newly-seen pending requests.
        for (const r of pending) {
          if (!seenIds.current.has(r.id)) {
            seenIds.current.add(r.id);
            void fireKitchenAlert({ title: "Assistance requested", body: tableLabel(r) });
          }
        }
        setRequests(pending);
      },
      (err) => console.error("[AssistanceAlerts] snapshot error:", err),
    );
    return () => unsub();
  }, [storeId]);

  // Oldest waiting request drives the modal; OK advances to the next.
  const current = useMemo(
    () => requests.slice().sort((a, b) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0))[0] ?? null,
    [requests],
  );

  async function acknowledge() {
    if (!storeId || !current) return;
    setAcking(true);
    try {
      const doneAtClientMs = Date.now();
      await updateDoc(doc(db, `stores/${storeId}/customerRequests/${current.id}`), {
        status: "done",
        doneAt: serverTimestamp(),
        doneAtClientMs,
        doneByUid: appUser?.uid ?? null,
        doneByUsername: appUser?.displayName || appUser?.name || null,
        doneByProfileId: currentProfile?.profileId ?? null,
        doneByProfileName: currentProfile?.name ?? null,
      });
      void writeActivityLog({
        storeId,
        sessionId: current.sessionId,
        user: appUser ?? null,
        action: "CUSTOMER_REQUEST_COMPLETED",
        sessionContext: {
          customerName: current.customerName ?? null,
          tableNumber: current.tableNumber ?? null,
          tableDisplayName: current.tableDisplayName ?? null,
        },
        meta: { requestId: current.id, type: "assistance", responseMs: Math.max(0, doneAtClientMs - current.createdAtClientMs) },
      });
    } catch (e) {
      console.error("[AssistanceAlerts] acknowledge failed:", e);
    } finally {
      setAcking(false);
    }
  }

  return (
    <AlertDialog open={!!current}>
      <AlertDialogContent
        className="max-w-md border-4 border-destructive"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <BellRing className="h-6 w-6 animate-pulse" /> Assistance needed
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 pt-1">
              <div className="text-xl font-bold text-foreground">
                {current ? tableLabel(current) : ""}
                {current?.customerName ? <span className="font-medium text-muted-foreground"> · {current.customerName}</span> : null}
              </div>
              {current && (
                <div className="text-sm text-muted-foreground">
                  Waiting {waitedLabel(now - current.createdAtClientMs)}
                  {requests.length > 1 ? ` · ${requests.length - 1} more waiting` : ""}
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); void acknowledge(); }} disabled={acking} className="min-w-24">
            {acking ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK, on my way"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
