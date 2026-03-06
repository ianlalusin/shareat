"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { collection, onSnapshot, query, orderBy, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { issueCustomerPinClient, disableCustomerAccessClient, disablePinInRegistry } from "@/components/pins/firestore";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Button } from "@/components/ui/button";

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

type PastPin = {
  id: string;
  sessionId: string;
  storeId: string;
  status: string;
  expiresAtMs: number;
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
const PAST_PINS_PAGE_SIZE = 10;

function StatusBadge({ enabled, expired }: { enabled: boolean; expired: boolean }) {
  const label = enabled ? (expired ? "Expired" : "Enabled") : "Disabled";
  const cls = enabled && !expired
    ? "bg-green-100 text-green-800 border-green-200"
    : expired
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-zinc-100 text-zinc-700 border-zinc-200";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

export default function PinsClient() {
  const router = useRouter();
  const { activeStore } = useStoreContext();

  const storeId = activeStore?.id;
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>("needs");

  const [allActiveStorePins, setAllActiveStorePins] = useState<any[]>([]);
  const [isLoadingPastPins, setIsLoadingPastPins] = useState(true);
  const [pastPinsPage, setPastPinsPage] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!storeId) return;

    const ref = collection(db, `stores/${storeId}/activeSessions`);
    const q = query(ref, orderBy("startedAtClientMs", "desc"));

    return onSnapshot(q, (snap) => {
      const rowsAll = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ActiveSession[];
      const rows = rowsAll.filter((r) => (r.sessionMode || '') !== 'alacarte');
      setSessions(rows);
    });
  }, [storeId]);

  useEffect(() => {
    if (!storeId) {
      setIsLoadingPastPins(false);
      setAllActiveStorePins([]);
      return;
    }

    setIsLoadingPastPins(true);

    const pinsRef = collection(db, "pinRegistry");
    const q = query(pinsRef, where("storeId", "==", storeId), where("status", "==", "active"));

    const unsubPast = onSnapshot(
      q,
      (snap) => {
        const pins = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllActiveStorePins(pins);
        setIsLoadingPastPins(false);

        // Auto-disable expired active pins (best-effort)
        const nowMs = Date.now();
        pins.forEach((p: any) => {
          if (p?.id && typeof p.expiresAtMs === "number" && p.expiresAtMs <= nowMs) {
            startTransition(async () => {
              try {
                await disablePinInRegistry({
                  pin: String(p.id),
                  storeId: String(p.storeId || storeId),
                  sessionId: String(p.sessionId || ""),
                });
              } catch {}
            });
          }
        });
      },
      (err) => {
        console.error("Failed to fetch past pins:", err);
        setIsLoadingPastPins(false);
      }
    );

    return () => unsubPast();
  }, [storeId, startTransition]);

  const { paginatedPastPins, totalPastPinPages } = useMemo(() => {
    const allPast = allActiveStorePins
      .filter((p) => p.expiresAtMs < now)
      .sort((a, b) => b.expiresAtMs - a.expiresAtMs);

    const paginated = allPast.slice(
      pastPinsPage * PAST_PINS_PAGE_SIZE,
      (pastPinsPage + 1) * PAST_PINS_PAGE_SIZE
    );
    const totalPages = Math.ceil(allPast.length / PAST_PINS_PAGE_SIZE);

    return { paginatedPastPins: paginated, totalPastPinPages: totalPages };
  }, [allActiveStorePins, now, pastPinsPage]);

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
          <div className="space-y-4">
            {/* Active sessions as cards */}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {view.map((s) => {
                const pinLabel = s.customerPin ? String(s.customerPin) : "WAITING FOR PIN";
                const remaining = s._enabled ? fmtRemaining(s._exp, now) : "";

                const title = s.tableDisplayName || s.sessionLabel || s.id;
                const customer = s.customerName || "—";

                const cardCls =
                  s._expired || (s._enabled && !s._hasPin)
                    ? "border-red-200 bg-red-50/30"
                    : s._needsPin
                      ? "border-yellow-200 bg-yellow-50/30"
                      : "";

                return (
                  <Card key={s.id} className={cardCls}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs opacity-70">PIN</div>
                          <div className="font-mono text-xl font-bold">{pinLabel}</div>
                        </div>
                        <div className="min-w-0 flex-1 text-center">
                          <div className="flex items-baseline justify-center gap-2 flex-wrap">
                          <div className="text-2xl font-bold truncate">{title}</div>
                          <StatusBadge enabled={!!s._enabled} expired={!!s._expired} />
                        </div>
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs opacity-70">Customer</div>
                          <div className="text-lg font-semibold truncate">{customer}</div>
                          <div className="text-xs opacity-70">
                            {s.status || "—"} • {s.sessionMode || "—"}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs opacity-70">Time left</div>
                          <div className="text-sm font-medium">{remaining || "—"}</div>
                          <div className="text-[11px] opacity-60">{fmtExpiry(s._exp)}</div>
                        </div>
                      </div>

                      <div className="flex gap-2 flex-wrap justify-end pt-1">
                        <button
                          className="border rounded px-3 py-2 text-sm disabled:opacity-50"
                          disabled={isPending || busyId === s.id || (s._enabled && s._hasPin && !s._expired)}
                          onClick={() => {
                            startTransition(async () => {
                              try {
                                setBusyId(s.id);
                                await issueCustomerPinClient({ storeId, sessionId: s.id });
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
                          className="border rounded px-3 py-2 text-sm disabled:opacity-50"
                          disabled={!s.customerPin}
                          onClick={() => router.push(`/print/session-pin/${s.id}`)}
                          type="button"
                        >
                          Print
                        </button>

                        <button
                          className="border rounded px-3 py-2 text-sm disabled:opacity-50"
                          disabled={isPending || busyId === s.id || (s._enabled && s._hasPin && !s._expired)}
                          onClick={() => {
                            const ok = window.confirm("Disable customer access and invalidate the PIN?");
                            if (!ok) return;

                            startTransition(async () => {
                              try {
                                setBusyId(s.id);
                                if (s.customerPin) {
                                  await disablePinInRegistry({ pin: String(s.customerPin), storeId, sessionId: s.id });
                                  await disableCustomerAccessClient({ storeId, sessionId: s.id });
                                } else {
                                  await disableCustomerAccessClient({ storeId, sessionId: s.id });
                                }
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
                    </CardContent>
                  </Card>
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

            {/* Expired pins cleanup */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Expired PINs</CardTitle>
                <CardDescription>
                  These PINs have expired but have not been cleaned up. Disabling them removes them permanently from the registry.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingPastPins ? (
                  <p className="text-sm text-muted-foreground">Loading expired PINs...</p>
                ) : paginatedPastPins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expired PINs to clean up.</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium bg-muted">
                      <div className="col-span-3">Session ID</div>
                      <div className="col-span-3">PIN</div>
                      <div className="col-span-4">Expired At</div>
                      <div className="col-span-2 text-right">Action</div>
                    </div>
                    {paginatedPastPins.map((pin: PastPin) => (
                      <div key={pin.id} className="grid grid-cols-12 gap-2 px-3 py-3 border-t items-center">
                        <div className="col-span-3 font-mono text-xs">{pin.sessionId.slice(0, 8)}...</div>
                        <div className="col-span-3 font-mono">{pin.id}</div>
                        <div className="col-span-4 text-xs">{fmtExpiry(pin.expiresAtMs)}</div>
                        <div className="col-span-2 text-right">
                          <button
                            className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                            disabled={isPending || busyId === pin.id}
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  setBusyId(pin.id);
                                  await disablePinInRegistry({
                                    pin: pin.id,
                                    storeId: pin.storeId,
                                    sessionId: pin.sessionId,
                                  });
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
                    ))}
                  </div>
                )}
              </CardContent>

              {totalPastPinPages > 1 && (
                <div className="p-4 border-t flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPastPinsPage((p) => Math.max(0, p - 1))}
                    disabled={pastPinsPage === 0}
                  >
                    Prev
                  </Button>
                  <div className="text-sm opacity-70">
                    Page {pastPinsPage + 1} of {totalPastPinPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPastPinsPage((p) => Math.min(totalPastPinPages - 1, p + 1))}
                    disabled={pastPinsPage >= totalPastPinPages - 1}
                  >
                    Next
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
