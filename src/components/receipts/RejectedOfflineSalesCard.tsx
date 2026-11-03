"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { postPosCommand } from "@/lib/pos-commands/client";

type Rejected = { id: string; kind?: string; sessionId?: string; code?: string; message?: string; processedAtMs?: number };

/**
 * Offline sales / voids the server refused (audit P1 review #6). Money may
 * already be in the drawer, so they stay listed here for a manager until they
 * are retried, accepted as recorded (a receipt from the till's own record) or
 * dismissed with a note. Reads posCommandResults (staff-readable, server-written).
 */
export function RejectedOfflineSalesCard({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Rejected[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "stores", storeId, "posCommandResults"), where("status", "==", "rejected"));
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.warn("[RejectedOfflineSales] listener failed", err),
    );
  }, [storeId]);

  if (rows.length === 0) return null;

  const act = async (row: Rejected, action: "retry" | "accept-recorded" | "dismiss") => {
    let note: string | undefined;
    if (action !== "retry") {
      note = window.prompt(
        action === "accept-recorded"
          ? "Accept this offline sale as recorded on the till. Reason / approval note:"
          : "Close this offline record without a receipt. What was done (refund, re-ring...)?",
      )?.trim();
      if (!note) return;
    }
    setBusy(row.id);
    try {
      const r: any = await postPosCommand("reconcile", storeId, { opId: row.id, action, ...(note ? { note } : {}) });
      toast({ title: r.status === "accepted" ? "Offline record settled" : r.status === "dismissed" ? "Offline record closed" : "Still refused", description: r.message || r.receiptNumber || "" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action failed", description: e?.message || String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Alert variant="destructive" className="mb-4" data-testid="rejected-offline-sales">
      <AlertTitle>{rows.length} offline record{rows.length === 1 ? "" : "s"} refused by the server</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                {r.kind === "voidSession" ? "Void" : "Sale"} · bill {String(r.sessionId ?? "").slice(0, 6)}… · {r.message || r.code}
              </span>
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r, "retry")}>Retry</Button>
              {r.kind !== "voidSession" && (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r, "accept-recorded")}>Accept as recorded</Button>
              )}
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r, "dismiss")}>Dismiss</Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
