"use client";

import { Fragment, useCallback, useEffect, useRef } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDurationHuman } from "@/lib/utils/date";
import type { DailySessionRow } from "@/lib/analytics/session-row";
import type { RiskCounts } from "@/lib/session-timeline/types";
import { riskTotal } from "@/lib/session-timeline/types";
import { ExpandedSessionPanel, type TrailEntry } from "./ExpandedSessionPanel";

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n || 0);

const clock = (ms: number | null | undefined) => (ms ? format(new Date(ms), "h:mm a") : "—");

const NONE = <span className="text-muted-foreground">—</span>;

/**
 * Money cell that renders nothing at all for zero — the point of the column is
 * to let someone scan for the sessions that DID carry a discount or a charge,
 * and a column of zeros buries them.
 */
function Money({ value, tone }: { value: number | null | undefined; tone: "discount" | "charge" }) {
  if (!value) return NONE;
  return <span className={tone === "discount" ? "text-green-600" : "text-red-600"}>{peso(value)}</span>;
}

function RiskChips({ risk, className }: { risk?: RiskCounts; className?: string }) {
  if (!risk || riskTotal(risk) === 0) return null;
  const chips: [string, number, string][] = [
    ["Void", risk.voids, "bg-red-100 text-red-700 border-red-200"],
    ["Disc", risk.discounts, "bg-amber-100 text-amber-700 border-amber-200"],
    ["Free", risk.freeItems, "bg-green-100 text-green-700 border-green-200"],
    ["Guest", risk.guestChanges, "bg-blue-100 text-blue-700 border-blue-200"],
    ["Pkg", risk.packageChanges, "bg-blue-100 text-blue-700 border-blue-200"],
    ["Override", risk.priceOverrides, "bg-violet-100 text-violet-700 border-violet-200"],
  ];
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {chips.filter(([, n]) => n > 0).map(([label, n, cls]) => (
        <Badge key={label} variant="outline" className={cn("h-4 px-1 text-[10px] font-normal", cls)}>
          {label} {n}
        </Badge>
      ))}
    </span>
  );
}

export type SessionRowListProps = {
  storeId: string;
  rows: DailySessionRow[];
  expanded: Set<string>;
  onToggle: (receiptId: string) => void;
  trails: Record<string, TrailEntry>;
  trailKeyFor: (row: DailySessionRow) => string;
  flavorNames: Map<string, string>;
  riskBySession?: Map<string, RiskCounts>;
  flaggedSessionIds?: Set<string>;
  focusId?: string | null;
  /** Receipt id to scroll to and focus once, on deep-link arrival. */
  scrollToReceiptId?: string | null;
  onRetry: (row: DailySessionRow) => void;
  onExpandSibling?: (receiptId: string) => void;
};

export function SessionRowList(props: SessionRowListProps) {
  const isMobile = useIsMobile();
  const scrollTargetRef = useRef<HTMLElement | null>(null);
  const scrolledFor = useRef<string | null>(null);

  const { scrollToReceiptId } = props;

  // Only on deep-link arrival — a plain click should never yank the viewport.
  useEffect(() => {
    if (!scrollToReceiptId || scrolledFor.current === scrollToReceiptId) return;
    const el = scrollTargetRef.current;
    if (!el) return;
    scrolledFor.current = scrollToReceiptId;
    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [scrollToReceiptId, props.rows]);

  const rowProps = useCallback(
    (row: DailySessionRow) => {
      const open = props.expanded.has(row.receiptId);
      return {
        open,
        panelId: `session-panel-${row.receiptId}`,
        risk: row.sessionId ? props.riskBySession?.get(row.sessionId) : undefined,
        flagged: !!row.sessionId && !!props.flaggedSessionIds?.has(row.sessionId),
        onActivate: () => props.onToggle(row.receiptId),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onToggle(row.receiptId);
          }
        },
      };
    },
    [props]
  );

  const panelFor = (row: DailySessionRow) => (
    <ExpandedSessionPanel
      storeId={props.storeId}
      row={row}
      entry={props.trails[props.trailKeyFor(row)]}
      flavorNames={props.flavorNames}
      siblingRows={row.sessionId ? props.rows.filter((r) => r.sessionId === row.sessionId) : [row]}
      focusId={props.focusId}
      onRetry={() => props.onRetry(row)}
      onExpandSibling={props.onExpandSibling}
    />
  );

  const totals = props.rows.reduce(
    (acc, r) => ({
      pax: acc.pax + (r.pax ?? 0),
      charges: acc.charges + (r.chargesTotal || 0),
      totalDiscount: acc.totalDiscount + (r.totalDiscount || 0),
      durationMs: acc.durationMs + (r.durationMs || 0),
      durationCount: acc.durationCount + (r.durationMs ? 1 : 0),
    }),
    { pax: 0, charges: 0, totalDiscount: 0, durationMs: 0, durationCount: 0 }
  );
  const avgDuration = totals.durationCount > 0 ? totals.durationMs / totals.durationCount : 0;

  // --- Mobile: cards. An eleven-column table is unusable at 390px, and
  // horizontal scrolling to read a receipt is worse than a stacked card.
  if (isMobile) {
    return (
      <div className="grid gap-2">
        {props.rows.map((row) => {
          const { open, panelId, risk, flagged, onActivate } = rowProps(row);
          return (
            <Card key={row.receiptId} className={cn(open && "ring-1 ring-primary/30")}>
              <button
                type="button"
                onClick={onActivate}
                aria-expanded={open}
                aria-controls={panelId}
                ref={props.scrollToReceiptId === row.receiptId ? (el) => { scrollTargetRef.current = el; } : undefined}
                className="w-full text-left p-3 min-h-[44px] flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    {clock(row.startedAtMs)} → {clock(row.closedAtMs)}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
                    {row.durationMs ? formatDurationHuman(row.durationMs) : "—"}
                    <ChevronRight
                      className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
                      aria-hidden
                    />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{row.tableNumber ?? row.customerName ?? "—"}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {flagged && <Badge variant="destructive" className="h-4 px-1 text-[10px] gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> Flagged
                    </Badge>}
                    <Badge variant={row.sessionMode === "package_dinein" ? "default" : "outline"}>
                      {row.sessionMode === "package_dinein" ? "Dine-in" : "Ala carte"}
                    </Badge>
                    {row.isRefund && <Badge variant="destructive">Refund</Badge>}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span className="truncate">
                    {row.pax ? `${row.pax} pax · ` : ""}
                    {row.sessionMode === "package_dinein"
                      ? row.packageName ?? "—"
                      : `${row.itemCount} item${row.itemCount === 1 ? "" : "s"}`}
                  </span>
                  <span className="tabular-nums shrink-0">{peso(row.total)}</span>
                </div>
                <RiskChips risk={risk} />
              </button>
              {open && (
                <div id={panelId} role="region" aria-label={`Session details for receipt ${row.receiptNumber ?? row.receiptId}`}>
                  {panelFor(row)}
                </div>
              )}
            </Card>
          );
        })}

        <Card>
          <CardContent className="py-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div><p className="text-muted-foreground text-xs">Pax</p><p className="tabular-nums">{totals.pax || "—"}</p></div>
            <div><p className="text-muted-foreground text-xs">Discounts</p><p className="tabular-nums">{peso(totals.totalDiscount)}</p></div>
            <div><p className="text-muted-foreground text-xs">Charges</p><p className="tabular-nums">{peso(totals.charges)}</p></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Desktop: the original table, plus an expander column. Customer, Charge
  // and Close hide below `lg` so twelve columns still fit a tablet.
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10" />
          <TableHead>Start</TableHead>
          <TableHead>Receipt</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Table</TableHead>
          <TableHead className="hidden lg:table-cell">Customer</TableHead>
          <TableHead className="text-right">Pax</TableHead>
          <TableHead>Package / Items</TableHead>
          <TableHead className="text-right">Total Discount</TableHead>
          <TableHead className="text-right hidden lg:table-cell">Charge</TableHead>
          <TableHead className="hidden lg:table-cell">Close</TableHead>
          <TableHead className="text-right">Session Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row) => {
          const { open, panelId, risk, flagged, onActivate, onKeyDown } = rowProps(row);
          return (
            <Fragment key={row.receiptId}>
              <TableRow
                role="button"
                tabIndex={0}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={onActivate}
                onKeyDown={onKeyDown}
                ref={props.scrollToReceiptId === row.receiptId ? (el) => { scrollTargetRef.current = el; } : undefined}
                className={cn("cursor-pointer", open && "bg-muted/40")}
              >
                <TableCell className="pr-0">
                  <ChevronRight
                    className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")}
                    aria-hidden
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap font-medium tabular-nums">{clock(row.startedAtMs)}</TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {row.receiptNumber ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={row.sessionMode === "package_dinein" ? "default" : "outline"}>
                    {row.sessionMode === "package_dinein" ? "Dine-in" : "Ala carte"}
                  </Badge>
                  {row.isRefund && <Badge variant="destructive" className="ml-1">Refund</Badge>}
                  {flagged && (
                    <Badge variant="destructive" className="ml-1 gap-0.5">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> Flagged
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{row.tableNumber ?? NONE}</TableCell>
                <TableCell className="max-w-[180px] truncate hidden lg:table-cell">{row.customerName ?? NONE}</TableCell>
                <TableCell className="text-right tabular-nums">{row.pax ?? NONE}</TableCell>
                <TableCell>
                  <span className="block">
                    {row.sessionMode === "package_dinein"
                      ? row.packageName ?? NONE
                      : `${row.itemCount} item${row.itemCount === 1 ? "" : "s"}`}
                  </span>
                  <RiskChips risk={risk} className="mt-0.5" />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Money value={row.totalDiscount} tone="discount" />
                </TableCell>
                <TableCell className="text-right tabular-nums hidden lg:table-cell">
                  <Money value={row.chargesTotal} tone="charge" />
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums hidden lg:table-cell">{clock(row.closedAtMs)}</TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {row.durationMs ? formatDurationHuman(row.durationMs) : NONE}
                </TableCell>
              </TableRow>
              {open && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={12} className="p-0">
                    <div id={panelId} role="region" aria-label={`Session details for receipt ${row.receiptNumber ?? row.receiptId}`}>
                      {panelFor(row)}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={6}>{props.rows.length} session{props.rows.length === 1 ? "" : "s"}</TableCell>
          <TableCell className="text-right tabular-nums">{totals.pax || NONE}</TableCell>
          <TableCell />
          <TableCell className="text-right tabular-nums">
            <Money value={totals.totalDiscount} tone="discount" />
          </TableCell>
          <TableCell className="text-right tabular-nums hidden lg:table-cell">
            <Money value={totals.charges} tone="charge" />
          </TableCell>
          <TableCell className="hidden lg:table-cell" />
          <TableCell className="text-right whitespace-nowrap tabular-nums">
            avg {formatDurationHuman(avgDuration, "—")}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
