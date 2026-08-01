"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { format } from "date-fns";
import { ArrowLeft, Calendar as CalendarIcon, Clock, Loader2, Users } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { sortRows, type DailySessionRow, type DailySessionsDoc } from "@/lib/analytics/session-row";
import { formatDurationHuman } from "@/lib/utils/date";

/**
 * Daily Session Timeline.
 *
 * Reads exactly ONE document per date — stores/{storeId}/dailySessions/{YYYYMMDD}
 * — which is written by the payment path and rebuilt by the admin backfill tool.
 * It deliberately does NOT fall back to querying receipts when a day doc is
 * missing: that per-session read cost is the thing this projection exists to
 * avoid, so a missing day is reported as "not built yet" instead.
 */

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n || 0);

const clock = (ms: number | null | undefined) => (ms ? format(new Date(ms), "h:mm a") : "—");

/** Em dash placeholder, so an absent value reads as absent rather than as a real zero. */
const NONE = <span className="text-muted-foreground">—</span>;

/**
 * Money cell that renders nothing-at-all for zero.
 *
 * A session with no discount shows "—", not "₱0.00": the point of the column is
 * to let someone scan for the sessions that DID carry a discount or a charge, and
 * a column of zeros buries them.
 */
function Money({ value, tone }: { value: number | null | undefined; tone: "discount" | "charge" }) {
  if (!value) return NONE;
  return (
    <span className={tone === "discount" ? "text-green-600" : "text-red-600"}>{peso(value)}</span>
  );
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "loaded"; rows: DailySessionRow[] }
  | { status: "error"; message: string };

export default function DailySessionTimelinePage() {
  const router = useRouter();
  const { activeStore } = useStoreContext();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const dayId = useMemo(() => getDayIdFromTimestamp(selectedDate), [selectedDate]);

  const load = useCallback(async () => {
    if (!activeStore?.id) return;
    setState({ status: "loading" });
    try {
      const snap = await getDoc(doc(db, "stores", activeStore.id, "dailySessions", dayId));
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
  }, [activeStore?.id, dayId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = state.status === "loaded" ? state.rows : [];

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          pax: acc.pax + (r.pax ?? 0),
          charges: acc.charges + (r.chargesTotal || 0),
          totalDiscount: acc.totalDiscount + (r.totalDiscount || 0),
          sales: acc.sales + (r.total || 0),
          durationMs: acc.durationMs + (r.durationMs || 0),
          durationCount: acc.durationCount + (r.durationMs ? 1 : 0),
        }),
        { pax: 0, charges: 0, totalDiscount: 0, sales: 0, durationMs: 0, durationCount: 0 }
      ),
    [rows]
  );

  const avgDuration = totals.durationCount > 0 ? totals.durationMs / totals.durationCount : 0;

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader
        title="Daily Session Timeline"
        description="Every closed session for one day, with dwell time, discounts and charges."
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

        {state.status === "loaded" && rows.length > 0 && (
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Start</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Pax</TableHead>
                    <TableHead>Package / Items</TableHead>
                    <TableHead className="text-right">Total Discount</TableHead>
                    <TableHead className="text-right">Charge</TableHead>
                    <TableHead>Close</TableHead>
                    <TableHead className="text-right">Session Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.receiptId}>
                      <TableCell className="whitespace-nowrap font-medium tabular-nums">
                        {clock(r.startedAtMs)}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {r.receiptNumber ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={r.sessionMode === "package_dinein" ? "default" : "outline"}>
                          {r.sessionMode === "package_dinein" ? "Dine-in" : "Ala carte"}
                        </Badge>
                        {r.isRefund && (
                          <Badge variant="destructive" className="ml-1">Refund</Badge>
                        )}
                      </TableCell>
                      <TableCell>{r.tableNumber ?? NONE}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{r.customerName ?? NONE}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pax ?? NONE}</TableCell>
                      <TableCell>
                        {r.sessionMode === "package_dinein"
                          ? (r.packageName ?? NONE)
                          : `${r.itemCount} item${r.itemCount === 1 ? "" : "s"}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money value={r.totalDiscount} tone="discount" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money value={r.chargesTotal} tone="charge" />
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{clock(r.closedAtMs)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {r.durationMs ? formatDurationHuman(r.durationMs) : NONE}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5}>{rows.length} session{rows.length === 1 ? "" : "s"}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.pax || NONE}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      <Money value={totals.totalDiscount} tone="discount" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Money value={totals.charges} tone="charge" />
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      avg {formatDurationHuman(avgDuration, "—")}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </RoleGuard>
  );
}
