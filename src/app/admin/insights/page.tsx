"use client";

import { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { useInsightList } from "@/hooks/useDailyInsight";
import { InsightReport } from "@/components/insights/InsightReport";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";
import type { DailyInsight } from "@/lib/types";

const SENTIMENT_DOT: Record<string, string> = {
  good: "bg-emerald-500",
  mixed: "bg-amber-500",
  poor: "bg-rose-500",
};

function dayIdLabel(dayId: string): { weekday: string; date: string } {
  if (!/^\d{8}$/.test(dayId)) return { weekday: "", date: dayId };
  const y = +dayId.slice(0, 4), m = +dayId.slice(4, 6), d = +dayId.slice(6, 8);
  const dt = new Date(y, m - 1, d);
  return {
    weekday: dt.toLocaleDateString("en-US", { weekday: "short" }),
    date: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function DateListItem({ item, selected, onClick }: { item: DailyInsight; selected: boolean; onClick: () => void }) {
  const { weekday, date } = dayIdLabel(item.dayId);
  const dot = item.status === "ok" ? (SENTIMENT_DOT[item.summary?.sentiment] ?? "bg-muted-foreground") : "bg-slate-300";
  const flagCount = item.status === "ok" ? (item.anomalies?.flags?.length ?? 0) : 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
          <span className="truncate text-sm font-semibold">{date}</span>
          <span className="text-xs text-muted-foreground">{weekday}</span>
        </div>
        {flagCount > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700">
            <AlertTriangle className="h-3 w-3" />{flagCount}
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {item.status === "ok" ? item.summary?.headline : "No sales recorded"}
      </div>
    </button>
  );
}

export default function AiInsightsPage() {
  const { activeStore } = useStoreContext();
  const { items, isLoading } = useInsightList(activeStore?.id);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  // Default to the newest insight; keep selection valid as the list changes.
  useEffect(() => {
    if (items.length === 0) { setSelectedDayId(null); return; }
    if (!selectedDayId || !items.some((i) => i.dayId === selectedDayId)) {
      setSelectedDayId(items[0].dayId);
    }
  }, [items, selectedDayId]);

  const selected = useMemo(() => items.find((i) => i.dayId === selectedDayId) ?? null, [items, selectedDayId]);

  const generate = async (force: boolean) => {
    const user = getAuth().currentUser;
    if (!user || !activeStore) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeId: activeStore.id, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Generation failed");
      if (json.cached) toast({ title: "Already up to date", description: "Showing the latest generated insight." });
      else if (json.status === "no_data") toast({ title: "No sales yesterday", description: "Nothing to analyze." });
      else toast({ title: "Insight generated" });
      if (json.dayId) setSelectedDayId(json.dayId);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Generation failed", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="AI Daily Insights" description="Yesterday's performance, analyzed — pick a date to read its brief." />
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <div className="mb-3 flex items-center justify-end">
          <Button variant="outline" onClick={() => generate(true)} disabled={busy || !activeStore}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Regenerate yesterday
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          {/* Left: date list */}
          <Card className="md:sticky md:top-4 md:self-start">
            <CardContent className="p-2">
              {isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : items.length === 0 ? (
                <div className="space-y-3 px-2 py-8 text-center">
                  <Sparkles className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No briefs yet.</p>
                  <Button size="sm" onClick={() => generate(false)} disabled={busy || !activeStore}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Generate
                  </Button>
                </div>
              ) : (
                <ScrollArea className="md:h-[calc(100vh-200px)]">
                  <div className="space-y-1.5 pr-2">
                    {items.map((item) => (
                      <DateListItem
                        key={item.dayId}
                        item={item}
                        selected={item.dayId === selectedDayId}
                        onClick={() => setSelectedDayId(item.dayId)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Right: selected brief */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              {selected ? (
                <InsightReport insight={selected} />
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  {isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : "Select a date to read its brief."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </RoleGuard>
  );
}
