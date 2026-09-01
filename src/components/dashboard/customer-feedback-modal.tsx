"use client";

import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FeedbackStars, formatManilaDate } from "./customer-feedback-stars";
import { WEEK_MS, DAY_MS, getManilaWeekStartMs } from "@/lib/analytics/customer-feedback-window";

type WeekRow = { id: string; rating: number; comment: string; dateMs: number; customerName?: string };

interface CustomerFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** Manila week Sun 00:00 epoch ms the modal opens to. Re-snapped defensively on open. */
  initialWeekStartMs: number;
}

export function CustomerFeedbackModal({ open, onOpenChange, storeId, initialWeekStartMs }: CustomerFeedbackModalProps) {
  const [weekStartMs, setWeekStartMs] = useState(() => getManilaWeekStartMs(initialWeekStartMs));
  const [rows, setRows] = useState<WeekRow[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-anchor to whatever week the card resolved to each time the modal opens.
  useEffect(() => {
    if (open) setWeekStartMs(getManilaWeekStartMs(initialWeekStartMs));
  }, [open, initialWeekStartMs]);

  useEffect(() => {
    if (!open || !storeId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const user = getAuth().currentUser;
        if (!user) throw new Error("Not signed in.");

        const qs = new URLSearchParams({ storeId, weekStartMs: String(weekStartMs) });
        const res = await fetch(`/api/admin/customer-feedback/week?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Could not load feedback.");

        setRows(Array.isArray(json.rows) ? json.rows : []);
        setAvgRating(Number(json.avgRating || 0));
        setCount(Number(json.count || 0));
      } catch (e: any) {
        if (!cancelled) {
          setRows([]);
          setAvgRating(0);
          setCount(0);
          setError(e?.message || "Could not load feedback.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, storeId, weekStartMs]);

  const isCurrentWeek = weekStartMs >= getManilaWeekStartMs(Date.now());
  const weekLabel = `${formatManilaDate(weekStartMs, { month: "short", day: "numeric" })} - ${formatManilaDate(
    weekStartMs + 6 * DAY_MS,
    { month: "short", day: "numeric" }
  )}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0 px-6 pb-4 pr-12 pt-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setWeekStartMs((v) => v - WEEK_MS)}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DialogTitle className="text-base font-semibold">{weekLabel}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setWeekStartMs((v) => v + WEEK_MS)}
            disabled={isCurrentWeek}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <ScrollArea className="max-h-[55dvh] px-6">
          {error ? (
            <p className="py-10 text-center text-sm text-destructive">{error}</p>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No feedback this week.</p>
          ) : (
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.id} className="py-4 first:pt-2 last:pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <FeedbackStars value={r.rating} />
                    <span className="text-xs text-muted-foreground">
                      {formatManilaDate(r.dateMs, { month: "short", day: "numeric" })},{" "}
                      {formatManilaDate(r.dateMs, { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {r.comment || <span className="text-muted-foreground">No comment.</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t px-6 py-4 text-center text-sm text-muted-foreground">
          Average for this period:{" "}
          <span className="font-semibold text-foreground">{count > 0 ? avgRating.toFixed(1) : "—"}</span> ★ ({count}{" "}
          rating{count === 1 ? "" : "s"})
        </div>
      </DialogContent>
    </Dialog>
  );
}
