"use client";

import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FeedbackStars, formatManilaDate } from "./customer-feedback-stars";
import { CustomerFeedbackModal } from "./customer-feedback-modal";
import { getManilaWeekStartMs, hasFeedbackToday } from "@/lib/analytics/customer-feedback-window";

type RecentComment = { id: string; rating: number; comment: string; dateMs: number };

interface CustomerFeedbackCardProps {
  storeId?: string | null;
  dateRange: { start: Date; end: Date };
}

export function CustomerFeedbackCard({ storeId, dateRange }: CustomerFeedbackCardProps) {
  const [avgRating, setAvgRating] = useState(0);
  const [count, setCount] = useState(0);
  const [recentComments, setRecentComments] = useState<RecentComment[]>([]);
  const [windowStartMs, setWindowStartMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const user = getAuth().currentUser;
        if (!user) throw new Error("Not signed in.");

        const qs = new URLSearchParams({
          storeId,
          start: String(dateRange.start.getTime()),
          end: String(dateRange.end.getTime()),
        });
        const res = await fetch(`/api/admin/customer-feedback/summary?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Could not load feedback.");

        setAvgRating(Number(json.avgRating || 0));
        setCount(Number(json.count || 0));
        setRecentComments(Array.isArray(json.recentComments) ? json.recentComments : []);
        setWindowStartMs(Number(json.windowStartMs ?? getManilaWeekStartMs(Date.now())));
      } catch (e: any) {
        if (!cancelled) {
          setAvgRating(0);
          setCount(0);
          setRecentComments([]);
          setWindowStartMs(null);
          setError(e?.message || "Could not load feedback.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeId, dateRange.start, dateRange.end]);

  // recentComments is sorted newest-first, so the freshest entry alone tells
  // us whether anything came in today — anything older can't be today either.
  const isNewToday =
    !loading && !error &&
    hasFeedbackToday(recentComments[0]?.dateMs ?? null, Date.now());

  return (
    <>
      <Card className={cn(isNewToday && "border-red-500 border-2")}>
        <CardHeader className="flex-row items-center justify-between pb-3 space-y-0">
          <CardTitle className="text-base">Customer Feedback</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setModalOpen(true)} disabled={!storeId}>
            View all
          </Button>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : count === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No feedback yet.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <FeedbackStars value={avgRating} />
                <span className="text-2xl font-semibold tabular-nums">{avgRating.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground">
                  ({count} rating{count === 1 ? "" : "s"})
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {recentComments.map((c) => (
                  <div key={c.id}>
                    <div className="flex items-center justify-between gap-3">
                      <FeedbackStars value={c.rating} />
                      <span className="text-xs text-muted-foreground">
                        {formatManilaDate(c.dateMs, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {c.comment || "No comment."}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {storeId && (
        <CustomerFeedbackModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          storeId={storeId}
          initialWeekStartMs={windowStartMs ?? getManilaWeekStartMs(Date.now())}
        />
      )}
    </>
  );
}
