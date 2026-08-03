"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { format } from "date-fns";
import { ArrowLeft, Calendar as CalendarIcon, Clock, Users } from "lucide-react";

import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { sortRows, type DailySessionRow, type DailySessionsDoc } from "@/lib/analytics/session-row";
import { formatDurationHuman } from "@/lib/utils/date";
import { fetchFlavorNames, fetchSessionTrail } from "@/lib/session-timeline/fetch-session-trail";
import { buildRiskBySession } from "@/lib/session-timeline/risk";
import type { RiskCounts } from "@/lib/session-timeline/types";
import { DayReviewPanel } from "@/components/session-timeline/DayReviewPanel";
import { SessionRowList } from "@/components/session-timeline/SessionRowList";
import type { TrailEntry } from "@/components/session-timeline/ExpandedSessionPanel";
import type { ActivityLog } from "@/lib/types";

/**
 * Daily Session Timeline.
 *
 * Reads exactly ONE document per date — stores/{storeId}/dailySessions/{YYYYMMDD}
 * — which is written by the payment path and rebuilt by the admin backfill tool.
 * It deliberately does NOT fall back to querying receipts when a day doc is
 * missing: that per-session read cost is the thing this projection exists to
 * avoid, so a missing day is reported as "not built yet" instead.
 *
 * Expanding a row is what fetches that session's history, and the result is
 * cached for the page's lifetime — so the day view stays one read, and the
 * detail is there for whoever asks for it. This page absorbed the old /logs and
 * /logs/sessions/details pages; the Day Review panel is the former's two
 * cross-session cards, and the expanded row is the latter.
 *
 * Deep links: ?date=YYYY-MM-DD&receipt=…&session=…&focus=…&review=1
 */

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n || 0);

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "loaded"; rows: DailySessionRow[] }
  | { status: "error"; message: string };

/** Two rows of one session share a cache entry; a receipt-only row gets its own. */
const trailKeyFor = (row: DailySessionRow) => row.sessionId ?? `receipt:${row.receiptId}`;

function parseDateParam(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // Local midnight, so getDayIdFromTimestamp lands on the intended Manila day.
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function DailySessionTimelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeStore } = useStoreContext();

  const [selectedDate, setSelectedDate] = useState<Date>(() => parseDateParam(searchParams.get("date")) ?? new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [trails, setTrails] = useState<Record<string, TrailEntry>>({});
  const [flavorNames, setFlavorNames] = useState<Map<string, string>>(() => new Map());
  const [riskBySession, setRiskBySession] = useState<Map<string, RiskCounts>>(() => new Map());
  const [flaggedSessionIds, setFlaggedSessionIds] = useState<Set<string>>(() => new Set());
  const [reviewOpen, setReviewOpen] = useState(() => searchParams.get("review") === "1");
  const [focusId, setFocusId] = useState<string | null>(() => searchParams.get("focus"));
  const [scrollToReceiptId, setScrollToReceiptId] = useState<string | null>(null);

  const inflight = useRef(new Map<string, Promise<void>>());
  const flavorsPromise = useRef<Promise<Map<string, string>> | null>(null);
  const didAutoExpand = useRef<string | null>(null);

  const dayId = useMemo(() => getDayIdFromTimestamp(selectedDate), [selectedDate]);
  const storeId = activeStore?.id;

  const load = useCallback(async () => {
    if (!storeId) return;
    setState({ status: "loading" });
    try {
      const snap = await getDoc(doc(db, "stores", storeId, "dailySessions", dayId));
      if (!snap.exists()) {
        setState({ status: "missing" });
        return;
      }
      const data = snap.data() as DailySessionsDoc;
      setState({ status: "loaded", rows: sortRows(Object.values(data.rows ?? {})) });
    } catch (err: any) {
      console.error("[DailySessionTimeline] load error:", err);
      setState({ status: "error", message: err?.message || "Could not load that day." });
    }
  }, [storeId, dayId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new day (or store) invalidates every per-session cache.
  useEffect(() => {
    setExpanded(new Set());
    setTrails({});
    setRiskBySession(new Map());
    inflight.current.clear();
    didAutoExpand.current = null;
  }, [dayId, storeId]);

  useEffect(() => {
    setFlavorNames(new Map());
    flavorsPromise.current = null;
    setFlaggedSessionIds(new Set());
  }, [storeId]);

  // Flagged sessions, once per store rather than per day: an equality filter on
  // a single field needs no composite index, and open flags are few by nature.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    getDocs(query(collection(db, "stores", storeId, "sessionAuditFlags"), where("status", "==", "flagged")))
      .then((snap) => { if (!cancelled) setFlaggedSessionIds(new Set(snap.docs.map((d) => d.id))); })
      .catch(() => {/* badges are a nicety, not worth an error state */});
    return () => { cancelled = true; };
  }, [storeId]);

  const rows = state.status === "loaded" ? state.rows : [];

  const ensureFlavorNames = useCallback(() => {
    if (!storeId) return;
    if (!flavorsPromise.current) {
      flavorsPromise.current = fetchFlavorNames(storeId);
      flavorsPromise.current
        .then((map) => setFlavorNames(map))
        .catch(() => {/* ids render as-is */});
    }
  }, [storeId]);

  const loadTrail = useCallback((row: DailySessionRow) => {
    if (!storeId) return;
    const key = trailKeyFor(row);
    if (inflight.current.has(key)) return;

    setTrails((prev) => ({ ...prev, [key]: { status: "loading" } }));
    const p = fetchSessionTrail({ storeId, sessionId: row.sessionId, receiptId: row.receiptId })
      .then((sources) => { setTrails((prev) => ({ ...prev, [key]: { status: "ready", sources } })); })
      .catch((err: any) => {
        setTrails((prev) => ({ ...prev, [key]: { status: "error", message: err?.message || "Fetch failed." } }));
      })
      .finally(() => { inflight.current.delete(key); });
    inflight.current.set(key, p);
  }, [storeId]);

  const expandRow = useCallback((receiptId: string) => {
    const row = rows.find((r) => r.receiptId === receiptId);
    if (!row) return;
    setExpanded((prev) => new Set(prev).add(receiptId));
    ensureFlavorNames();
    if (!trails[trailKeyFor(row)]) loadTrail(row);
  }, [rows, trails, loadTrail, ensureFlavorNames]);

  // Multi-open rather than an accordion: comparing sessions within a day is the
  // reason this view exists, and collapsing a row the user just deep-linked into
  // would be actively wrong.
  const toggleRow = useCallback((receiptId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(receiptId)) {
        next.delete(receiptId);
        return next;
      }
      next.add(receiptId);
      return next;
    });
    const row = rows.find((r) => r.receiptId === receiptId);
    if (!row) return;
    ensureFlavorNames();
    if (!trails[trailKeyFor(row)]) loadTrail(row);
  }, [rows, trails, loadTrail, ensureFlavorNames]);

  // Deep-link arrival: resolve once per (day, target) so it never fights the user.
  useEffect(() => {
    if (state.status !== "loaded") return;
    const receiptParam = searchParams.get("receipt");
    const sessionParam = searchParams.get("session");
    const target = receiptParam ?? sessionParam;
    if (!target) return;

    const marker = `${dayId}:${target}`;
    if (didAutoExpand.current === marker) return;

    const row = receiptParam
      ? rows.find((r) => r.receiptId === receiptParam)
      // Prefer the original sale over its refund when only a session is named.
      : rows.filter((r) => r.sessionId === sessionParam).sort((a, b) => Number(!!a.isRefund) - Number(!!b.isRefund))[0];
    if (!row) return;

    didAutoExpand.current = marker;
    expandRow(row.receiptId);
    setScrollToReceiptId(row.receiptId);
  }, [state.status, rows, searchParams, dayId, expandRow]);

  const focusLog = useCallback((log: ActivityLog) => {
    const row = rows.find((r) => r.sessionId === log.sessionId && !r.isRefund)
      ?? rows.find((r) => r.sessionId === log.sessionId);
    if (!row) return;
    setFocusId(log.id);
    expandRow(row.receiptId);
    setScrollToReceiptId(row.receiptId);

    const params = new URLSearchParams(searchParams.toString());
    params.set("date", format(selectedDate, "yyyy-MM-dd"));
    params.set("receipt", row.receiptId);
    params.set("focus", log.id);
    // Bookmarkable without a navigation, so nothing refetches.
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [rows, expandRow, searchParams, selectedDate, router]);

  const handleLogsLoaded = useCallback((logs: ActivityLog[]) => {
    setRiskBySession(buildRiskBySession(logs));
  }, []);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          sales: acc.sales + (r.total || 0),
          durationMs: acc.durationMs + (r.durationMs || 0),
          durationCount: acc.durationCount + (r.durationMs ? 1 : 0),
        }),
        { sales: 0, durationMs: 0, durationCount: 0 }
      ),
    [rows]
  );
  const avgDuration = totals.durationCount > 0 ? totals.durationMs / totals.durationCount : 0;

  const sessionsSheet = useMemo(
    () =>
      rows.map((r) => ({
        Receipt: r.receiptNumber ?? r.receiptId,
        Start: r.startedAtMs ? format(new Date(r.startedAtMs), "HH:mm:ss") : "",
        Close: format(new Date(r.closedAtMs), "HH:mm:ss"),
        Type: r.sessionMode === "package_dinein" ? "Dine-in" : "Ala carte",
        Table: r.tableNumber ?? "",
        Customer: r.customerName ?? "",
        Pax: r.pax ?? "",
        "Package / Items": r.sessionMode === "package_dinein" ? r.packageName ?? "" : `${r.itemCount} items`,
        Discount: r.totalDiscount || 0,
        Charge: r.chargesTotal || 0,
        Total: r.total || 0,
        "Session Time": r.durationMs ? formatDurationHuman(r.durationMs) : "",
        Refund: r.isRefund ? "Yes" : "",
      })),
    [rows]
  );

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader
        title="Daily Session Timeline"
        description="Every closed session for one day — expand a row for its full sequence of events."
      >
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </PageHeader>

      <div className="grid gap-4">
        <Card>
          <CardContent className="pt-6 flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[220px] justify-start text-left font-normal h-9">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, "MMMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                        setCalendarOpen(false);
                      }
                    }}
                    disabled={(date) => date > new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label>Store</Label>
              <p className="h-9 flex items-center text-sm font-medium">{activeStore?.name ?? "—"}</p>
            </div>

            {state.status === "loaded" && rows.length > 0 && (
              <div className="flex flex-wrap gap-2 ml-auto">
                <Badge variant="secondary" className="h-9 px-3 gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {rows.length} session{rows.length === 1 ? "" : "s"}
                </Badge>
                <Badge variant="secondary" className="h-9 px-3 gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  avg {formatDurationHuman(avgDuration, "—")}
                </Badge>
                <Badge variant="secondary" className="h-9 px-3">{peso(totals.sales)} sales</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {storeId && (
          <DayReviewPanel
            storeId={storeId}
            storeCode={(activeStore as any)?.code}
            dayId={dayId}
            selectedDate={selectedDate}
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            onLogsLoaded={handleLogsLoaded}
            onFocusLog={focusLog}
            sessionsSheet={sessionsSheet}
          />
        )}

        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Could not load that day</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {state.status === "missing" && (
          <Alert>
            <AlertTitle>This day has not been built yet</AlertTitle>
            <AlertDescription>
              Session rows are written when a session is paid, and past days are filled in by the rebuild tool.
              Run <span className="font-medium">Rebuild Daily Session Timeline</span> on the{" "}
              <Link href="/admin/backfill" className="underline underline-offset-2">
                Analytics Backfill
              </Link>{" "}
              page for a range that covers {format(selectedDate, "MMMM d, yyyy")}.
            </AlertDescription>
          </Alert>
        )}

        {state.status === "loading" && (
          <Card>
            <CardContent className="pt-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {state.status === "loaded" && rows.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No paid sessions on {format(selectedDate, "MMMM d, yyyy")}.
            </CardContent>
          </Card>
        )}

        {state.status === "loaded" && rows.length > 0 && storeId && (
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              <SessionRowList
                storeId={storeId}
                rows={rows}
                expanded={expanded}
                onToggle={toggleRow}
                trails={trails}
                trailKeyFor={trailKeyFor}
                flavorNames={flavorNames}
                riskBySession={riskBySession}
                flaggedSessionIds={flaggedSessionIds}
                focusId={focusId}
                scrollToReceiptId={scrollToReceiptId}
                onRetry={(row) => {
                  const key = trailKeyFor(row);
                  setTrails((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                  loadTrail(row);
                }}
                onExpandSibling={(receiptId) => {
                  expandRow(receiptId);
                  setScrollToReceiptId(receiptId);
                }}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </RoleGuard>
  );
}
