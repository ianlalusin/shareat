"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/global/confirm-dialog";

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

type ArchivedPin = {
  id: string;
  pin?: string;
  sessionId: string;
  storeId: string;
  customerName?: string | null;
  tableDisplayName?: string | null;
  tableNumber?: string | number | null;
  status?: string;
  expiresAtMs?: number;
  archivedAt?: any;
  archivedByUid?: string;
  archiveReason?: string;
  originalStatus?: string;
  reviveCount?: number;
  revivedAt?: any;
  revivedByUid?: string;
};

function getManilaDayId(input?: Date | number | string | null): string {
  const date =
    input instanceof Date ? input :
    typeof input === "number" ? new Date(input) :
    typeof input === "string" ? new Date(input) :
    new Date();

  const safeDate = isNaN(date.getTime()) ? new Date() : date;

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(safeDate).replace(/-/g, "");
}

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
  const searchParams = useSearchParams();
  const { activeStore } = useStoreContext();
  const { user } = useAuthContext();
  const { confirm, Dialog } = useConfirmDialog();

  const storeId = activeStore?.id;
  const targetSessionId = searchParams.get("sessionId");
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [now, setNow] = useState(() => Date.now());

  const [archivedPins, setArchivedPins] = useState<ArchivedPin[]>([]);
  const [isLoadingArchivedPins, setIsLoadingArchivedPins] = useState(true);
  const [archivedPinsPage, setArchivedPinsPage] = useState(0);
  const autoIssueAttemptedRef = useRef<string | null>(null);
  const autoFinalizeExpiredRef = useRef<Record<string, true>>({});
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pin_autofinalized') || '{}');
      autoFinalizeExpiredRef.current = stored;
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const todayDayId = getManilaDayId(now);

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
      const rows = rowsAll.filter((r) => (r.sessionMode || "") !== "alacarte");
      setSessions(rows);
    });
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !targetSessionId || !user) return;
    if (autoIssueAttemptedRef.current === targetSessionId) return;

    const target = sessions.find((session) => session.id === targetSessionId);
    if (!target) return;
    if ((target.sessionMode || "") === "alacarte") return;

    const hasActivePin =
      !!target.customerAccessEnabled &&
      !!target.customerPin &&
      !!target.customerAccessExpiresAtMs &&
      target.customerAccessExpiresAtMs > Date.now();

    autoIssueAttemptedRef.current = targetSessionId;

    if (hasActivePin) {
      router.replace(`/print/session-pin/${targetSessionId}`);
      return;
    }

    startTransition(async () => {
      try {
        setBusyId(targetSessionId);
        const token = await user.getIdToken();
        const res = await fetch("/api/pins/issue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ storeId, sessionId: targetSessionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to issue PIN.");
        router.replace(`/print/session-pin/${targetSessionId}`);
      } catch (error) {
        console.error("Auto-issue PIN failed:", error);
        autoIssueAttemptedRef.current = null;
      } finally {
        setBusyId(null);
      }
    });
  }, [storeId, targetSessionId, user, sessions, router, startTransition]);

  useEffect(() => {
    if (!storeId || !user) return;

    const expiredSessions = sessions.filter((s) =>
      (s.sessionMode || "") !== "alacarte" &&
      s.customerAccessEnabled === true &&
      !!s.customerPin &&
      !!s.customerAccessExpiresAtMs &&
      s.customerAccessExpiresAtMs <= now &&
      !autoFinalizeExpiredRef.current[s.id]
    );

    if (expiredSessions.length === 0) return;

    expiredSessions.forEach((s) => {
      autoFinalizeExpiredRef.current[s.id] = true;
      try { localStorage.setItem('pin_autofinalized', JSON.stringify(autoFinalizeExpiredRef.current)); } catch {}

      startTransition(async () => {
        try {
          const token = await user.getIdToken();
          const res = await fetch("/api/pins/finalize", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              storeId,
              sessionId: s.id,
              reason: "expired_cleanup",
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Failed to finalize expired PIN.");
        } catch (error) {
          console.error("Auto-finalize expired PIN failed:", error);
          delete autoFinalizeExpiredRef.current[s.id];
        }
      });
    });
  }, [storeId, user, sessions, now, startTransition]);

  useEffect(() => {
    if (!storeId) {
      setIsLoadingArchivedPins(false);
      setArchivedPins([]);
      return;
    }

    setIsLoadingArchivedPins(true);

    const ref = collection(db, `stores/${storeId}/pinArchiveByDay/${todayDayId}/pins`);
    const q = query(ref);

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ArchivedPin[];
        setArchivedPins(rows);
        setIsLoadingArchivedPins(false);
      },
      (err) => {
        console.error("Failed to fetch archived pins:", err);
        setIsLoadingArchivedPins(false);
      }
    );

    return () => unsub();
  }, [storeId, todayDayId]);

  const { paginatedArchivedPins, totalArchivedPinPages } = useMemo(() => {
    const allArchived = [...archivedPins].sort((a, b) => {
      const aMs = typeof a.expiresAtMs === "number" ? a.expiresAtMs : 0;
      const bMs = typeof b.expiresAtMs === "number" ? b.expiresAtMs : 0;
      return bMs - aMs;
    });

    const paginated = allArchived.slice(
      archivedPinsPage * PAST_PINS_PAGE_SIZE,
      (archivedPinsPage + 1) * PAST_PINS_PAGE_SIZE
    );
    const totalPages = Math.ceil(allArchived.length / PAST_PINS_PAGE_SIZE);

    return { paginatedArchivedPins: paginated, totalArchivedPinPages: totalPages };
  }, [archivedPins, archivedPinsPage]);

  const latestArchivedPinBySession = useMemo(() => {
    const sorted = [...archivedPins].sort((a, b) => {
      const aMs = typeof a.expiresAtMs === "number" ? a.expiresAtMs : 0;
      const bMs = typeof b.expiresAtMs === "number" ? b.expiresAtMs : 0;
      return bMs - aMs;
    });

    const map: Record<string, ArchivedPin> = {};
    for (const pin of sorted) {
      if (!pin.sessionId) continue;
      if (!map[pin.sessionId]) map[pin.sessionId] = pin;
    }
    return map;
  }, [archivedPins]);

  const view = useMemo(() => {
    return sessions.map((s) => {
      const enabled = s.customerAccessEnabled ?? false;
      const exp = s.customerAccessExpiresAtMs ?? null;
      const hasPin = !!s.customerPin;
      const expired = enabled && !!exp && exp <= now;

      return {
        ...s,
        _enabled: enabled,
        _exp: exp,
        _hasPin: hasPin,
        _expired: expired,
        _needsPin: !enabled || !hasPin || expired,
      };
    });
  }, [sessions, now]);

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      {Dialog}
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">PINs</h1>
            <p className="text-sm opacity-70">
              Store: <span className="font-medium">{activeStore?.name || "—"}</span>
            </p>
          </div>

        </div>

        {!storeId ? (
          <div className="text-sm opacity-70">No store selected.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {view.map((s) => {
                const pinLabel = s.customerPin ? String(s.customerPin) : "WAITING FOR PIN";
                const remaining = s._enabled ? fmtRemaining(s._exp, now) : "";
                const archivedPinForSession = latestArchivedPinBySession[s.id];

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
                          disabled={!s.customerPin}
                          onClick={() => router.push(`/print/session-pin/${s.id}`)}
                          type="button"
                        >
                          Print
                        </button>

{s.customerPin ? (
                          <button
                            className="border rounded px-3 py-2 text-sm disabled:opacity-50"
                            disabled={busyId === s.id}
                            onClick={async () => {
                              const ok = await confirm({
                                title: "Disable this PIN?",
                                description: "The current PIN will be disabled and the customer will no longer be able to access the refill app.",
                                confirmText: "Proceed",
                                cancelText: "Cancel",
                                destructive: true,
                              });
                              if (!ok) return;

                              startTransition(async () => {
                                try {
                                  setBusyId(s.id);
                                  if (!user) throw new Error("You must be signed in to disable a PIN.");
                                  const token = await user.getIdToken();
                                  const res = await fetch("/api/pins/disable", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: JSON.stringify({
                                      storeId,
                                      sessionId: s.id,
                                    }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) throw new Error(data?.error || "Failed to disable PIN.");
                                } catch (error: any) {
                                  console.error("Disable PIN failed:", error);
                                  window.alert(error?.message || "Failed to disable PIN.");
                                } finally {
                                  setBusyId(null);
                                }
                              });
                            }}
                            type="button"
                          >
                            Disable
                          </button>
                        ) : (
                          <button
                            className="border rounded px-3 py-2 text-sm disabled:opacity-50"
                            disabled={busyId === s.id || !archivedPinForSession || archivedPinForSession.status === "revived"}
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  setBusyId(s.id);
                                  if (!user) throw new Error("You must be signed in to extend a PIN.");
                                  if (!archivedPinForSession) throw new Error("No archived PIN found to extend.");
                                  const token = await user.getIdToken();
                                  const res = await fetch("/api/pins/revive", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: JSON.stringify({
                                      storeId,
                                      sessionId: s.id,
                                      pin: archivedPinForSession.id,
                                      dayId: todayDayId,
                                    }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) throw new Error(data?.error || "Failed to extend PIN.");
                                } finally {
                                  setBusyId(null);
                                }
                              });
                            }}
                            type="button"
                          >
                            Extend
                          </button>
                        )}
                        {!s._hasPin && (
                          <>
                          <button
                            className="border rounded px-3 py-2 text-sm bg-blue-50 border-blue-300 disabled:opacity-50"
                            disabled={busyId === s.id}
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  setBusyId(s.id);
                                  if (!user) throw new Error("You must be signed in.");
                                  const token = await user.getIdToken();
                                  const res = await fetch("/api/pins/repair", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ storeId, sessionId: s.id }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) throw new Error(data?.error || "Repair failed.");
                                  if (data.repaired === 0) window.alert("No PIN found in registry for this session. Use Reissue instead.");
                                } catch (error: any) {
                                  window.alert(error?.message || "Repair failed.");
                                } finally {
                                  setBusyId(null);
                                }
                              });
                            }}
                            type="button"
                          >
                            Repair
                          </button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {view.length === 0 && (
                <div className="p-6 text-sm opacity-70">
                  No active sessions found.
                </div>
              )}
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Archived PINs Today</CardTitle>
                <CardDescription>
                  PINs finalized today are archived here and can be revived if they were disabled by mistake.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingArchivedPins ? (
                  <p className="text-sm text-muted-foreground">Loading archived PINs...</p>
                ) : paginatedArchivedPins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No archived PINs for today.</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium bg-muted">
                      <div className="col-span-2">PIN</div>
                      <div className="col-span-3">Customer</div>
                      <div className="col-span-2">Table</div>
                      <div className="col-span-2">Reason</div>
                      <div className="col-span-2">Expires</div>
                      <div className="col-span-1 text-right">Action</div>
                    </div>
                    {paginatedArchivedPins.map((pin) => (
                      <div key={pin.id} className="grid grid-cols-12 gap-2 px-3 py-3 border-t items-center">
                        <div className="col-span-2 font-mono">{pin.id}</div>
                        <div className="col-span-3 text-sm truncate">{pin.customerName || "—"}</div>
                        <div className="col-span-2 text-sm truncate">{pin.tableDisplayName || "—"}</div>
                        <div className="col-span-2 text-xs">{pin.archiveReason || "—"}</div>
                        <div className="col-span-2 text-xs">{fmtExpiry(pin.expiresAtMs)}</div>
                        <div className="col-span-1 text-right">
                          <button
                            className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                            disabled={isPending || busyId === pin.id || pin.status === "revived"}
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  setBusyId(pin.id);
                                  if (!user) throw new Error("You must be signed in to revive a PIN.");
                                  const token = await user.getIdToken();
                                  const res = await fetch("/api/pins/revive", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: JSON.stringify({
                                      storeId,
                                      sessionId: pin.sessionId,
                                      pin: pin.id,
                                      dayId: todayDayId,
                                    }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) throw new Error(data?.error || "Failed to revive PIN.");
                                  router.push(`/print/session-pin/${pin.sessionId}`);
                                } finally {
                                  setBusyId(null);
                                }
                              });
                            }}
                          >
                            {pin.status === "revived" ? "Revived" : "Revive"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>

              {totalArchivedPinPages > 1 && (
                <div className="p-4 border-t flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setArchivedPinsPage((p) => Math.max(0, p - 1))}
                    disabled={archivedPinsPage === 0}
                  >
                    Prev
                  </Button>
                  <div className="text-sm opacity-70">
                    Page {archivedPinsPage + 1} of {totalArchivedPinPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setArchivedPinsPage((p) => Math.min(totalArchivedPinPages - 1, p + 1))}
                    disabled={archivedPinsPage >= totalArchivedPinPages - 1}
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
