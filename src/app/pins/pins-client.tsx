"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useRouter } from "next/navigation";

import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { issueCustomerPinClient, disableCustomerAccessClient } from "@/components/pins/firestore";

// If you have RoleGuard, wrap it exactly how your other pages do:
import { RoleGuard } from "@/components/guards/RoleGuard";

type ActiveSession = {
  id: string;
  status?: string | null;
  sessionLabel?: string | null;
  sessionMode?: string | null;
  tableDisplayName?: string | null;
  customerName?: string | null;

  customerPin?: string | null;
  customerAccessEnabled?: boolean | null;
  customerAccessExpiresAtMs?: number | null;

  startedAtClientMs?: number | null;
};

function fmtExpiry(ms?: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function PinsClient() {
  const router = useRouter();
  const { activeStore } = useStoreContext();

  const storeId = activeStore?.id;
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!storeId) return;

    const ref = collection(db, `stores/${storeId}/activeSessions`);
    const q = query(ref, orderBy("startedAtClientMs", "desc"));

    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ActiveSession[];
      setSessions(rows);
    });
  }, [storeId]);

  const now = Date.now();

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">PINs</h1>
          <p className="text-sm opacity-70">
            Store: <span className="font-medium">{activeStore?.name || "—"}</span>
          </p>
        </div>

        {!storeId ? (
          <div className="text-sm opacity-70">No store selected.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium bg-muted">
              <div className="col-span-3">Session</div>
              <div className="col-span-3">Table / Customer</div>
              <div className="col-span-2">PIN</div>
              <div className="col-span-2">Expiry</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {sessions.map((s) => {
              const enabled = s.customerAccessEnabled ?? false;
              const exp = s.customerAccessExpiresAtMs ?? null;
              const expired = enabled && !!exp && exp <= now;

              const pinLabel = s.customerPin || "—";
              const statusLabel = enabled ? (expired ? "Expired" : "Enabled") : "Disabled";

              return (
                <div key={s.id} className="grid grid-cols-12 gap-2 px-3 py-3 border-t items-center">
                  <div className="col-span-3">
                    <div className="font-medium">{s.sessionLabel || s.id}</div>
                    <div className="text-xs opacity-70">{s.status || "—"} • {s.sessionMode || "—"}</div>
                  </div>

                  <div className="col-span-3">
                    <div className="text-sm">{s.tableDisplayName || "—"}</div>
                    <div className="text-xs opacity-70">{s.customerName || ""}</div>
                  </div>

                  <div className="col-span-2">
                    <div className="font-mono text-sm">{pinLabel}</div>
                    <div className="text-xs opacity-70">{statusLabel}</div>
                  </div>

                  <div className="col-span-2 text-sm">{fmtExpiry(exp)}</div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                      disabled={isPending || busyId === s.id}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            setBusyId(s.id);
                            await issueCustomerPinClient({ storeId, sessionId: s.id });
                          } finally {
                            setBusyId(null);
                          }
                        });
                      }}
                    >
                      Issue PIN
                    </button>

                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                      disabled={!s.customerPin}
                      onClick={() => router.push(`/print/session-pin/${s.id}`)}
                    >
                      Print
                    </button>

                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                      disabled={isPending || busyId === s.id}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            setBusyId(s.id);
                            await disableCustomerAccessClient({ storeId, sessionId: s.id });
                          } finally {
                            setBusyId(null);
                          }
                        });
                      }}
                    >
                      Disable
                    </button>
                  </div>
                </div>
              );
            })}

            {sessions.length === 0 && <div className="p-6 text-sm opacity-70">No active sessions.</div>}
          </div>
        )}
      </div>
    </RoleGuard>
  );
}