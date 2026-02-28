"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useRouter } from "next/navigation";

import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { issueCustomerPinClient, disableCustomerAccessClient } from "@/components/pins/firestore";
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

function fmtRemaining(ms?: number | null, nowMs?: number) {
  if (!ms || !nowMs) return "";
  const diff = ms - nowMs;
  if (diff <= 0) return "Expired";

  const totalMin = Math.floor(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  if (h <= 0) return `${m}m left`;
  return `${h}h ${m}m left`;
}

type Filter = "needs" | "enabled" | "expired" | "all";

export default function PinsClient() {
  const router = useRouter();
  const { activeStore } = useStoreContext();

  const storeId = activeStore?.id;
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>("needs");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!storeId) return;

    const ref = collection(db, `stores/${storeId}/activeSessions`);
    const q = query(ref, orderBy("startedAtClientMs", "desc"));

    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ActiveSession[];
      setSessions(rows);
    });
  }, [storeId]);

  const view = useMemo(() => {
    const mapped = sessions.map((s) => {
      const enabled = s.customerAccessEnabled ?? false;
      const exp = s.customerAccessExpiresAtMs ?? null;
      const hasPin = !!s.customerPin;
      const expired = enabled && !!exp && exp <= now;

      const needsPin = !enabled || !hasPin || expired;

      return {
        ...s,
        _enabled: enabled,
        _exp: exp,
        _hasPin: hasPin,
        _expired: expired,
        _needsPin: needsPin,
      };
    });

    const filtered =
      filter === "all"
        ? mapped
        : filter === "needs"
          ? mapped.filter((s) => s._needsPin)
          : filter === "enabled"
            ? mapped.filter((s) => s._enabled && s._hasPin && !s._expired)
            : mapped.filter((s) => s._expired);

    return filtered;
  }, [sessions, filter, now]);

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">PINs</h1>
            <p className="text-sm opacity-70">
              Store: <span className="font-medium">{activeStore?.name || "—"}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`border rounded px-3 py-1 text-sm ${filter === "needs" ? "bg-muted" : ""}`}
              onClick={() => setFilter("needs")}
              type="button"
            >
              Needs PIN
            </button>
            <button
              className={`border rounded px-3 py-1 text-sm ${filter === "enabled" ? "bg-muted" : ""}`}
              onClick={() => setFilter("enabled")}
              type="button"
            >
              Enabled
            </button>
            <button
              className={`border rounded px-3 py-1 text-sm ${filter === "expired" ? "bg-muted" : ""}`}
              onClick={() => setFilter("expired")}
              type="button"
            >
              Expired
            </button>
            <button
              className={`border rounded px-3 py-1 text-sm ${filter === "all" ? "bg-muted" : ""}`}
              onClick={() => setFilter("all")}
              type="button"
            >
              All
            </button>
          </div>
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

            {view.map((s) => {
              const pinLabel = s.customerPin || "—";
              const statusLabel = s._enabled ? (s._expired ? "Expired" : "Enabled") : "Disabled";
              const remaining = s._enabled ? fmtRemaining(s._exp, now) : "";

              const title = s.sessionLabel || s.tableDisplayName || s.id;

              const rowClass =
                s._expired || (s._enabled && !s._hasPin)
                  ? "bg-red-50/40"
                  : s._needsPin
                    ? "bg-yellow-50/40"
                    : "";

              return (
                <div
                  key={s.id}
                  className={`grid grid-cols-12 gap-2 px-3 py-3 border-t items-center ${rowClass}`}
                >
                  <div className="col-span-3">
                    <div className="font-medium">{title}</div>
                    <div className="text-xs opacity-70">
                      {s.status || "—"} • {s.sessionMode || "—"}
                    </div>
                  </div>

                  <div className="col-span-3">
                    <div className="text-sm">{s.tableDisplayName || "—"}</div>
                    <div className="text-xs opacity-70">{s.customerName || ""}</div>
                  </div>

                  <div className="col-span-2">
                    <div className="font-mono text-sm">{pinLabel}</div>
                    <div className="text-xs opacity-70">{statusLabel}</div>
                  </div>

                  <div className="col-span-2 text-sm">
                    <div>{fmtExpiry(s._exp)}</div>
                    {remaining ? <div className="text-xs opacity-70">{remaining}</div> : null}
                  </div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                      disabled={isPending || busyId === s.id}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            setBusyId(s.id);
                            await issueCustomerPinClient({ storeId, sessionId: s.id });
                            // one-click workflow: issue then print
                            router.push(`/print/session-pin/${s.id}`);
                          } finally {
                            setBusyId(null);
                          }
                        });
                      }}
                      type="button"
                    >
                      Issue & Print
                    </button>

                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                      disabled={!s.customerPin}
                      onClick={() => router.push(`/print/session-pin/${s.id}`)}
                      type="button"
                    >
                      Print
                    </button>

                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                      disabled={isPending || busyId === s.id}
                      onClick={() => {
                        const ok = window.confirm("Disable customer access and invalidate the PIN?");
                        if (!ok) return;

                        startTransition(async () => {
                          try {
                            setBusyId(s.id);
                            await disableCustomerAccessClient({ storeId, sessionId: s.id });
                          } finally {
                            setBusyId(null);
                          }
                        });
                      }}
                      type="button"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              );
            })}

            {view.length === 0 && (
              <div className="p-6 text-sm opacity-70">
                {filter === "needs"
                  ? "No sessions currently need a PIN."
                  : "No active sessions found for this filter."}
              </div>
            )}
          </div>
        )}
      </div>
    </RoleGuard>
  );
}