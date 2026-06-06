"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDailyInsight } from "@/hooks/useDailyInsight";
import { InsightModal } from "@/components/insights/InsightModal";

const SENTIMENT_DOT: Record<string, string> = {
  good: "bg-emerald-400",
  mixed: "bg-amber-400",
  poor: "bg-rose-400",
};

/** Floating AI brief badge for the manager dashboard (bottom, left of the weather button). */
export function InsightFloatingBadge({ storeId }: { storeId: string }) {
  const { insight, isLoading } = useDailyInsight(storeId);
  const [open, setOpen] = useState(false);
  const dot = insight && insight.status === "ok" ? SENTIMENT_DOT[insight.summary.sentiment] : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-24 z-50 flex h-14 items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 px-4 shadow-lg outline-none transition-all duration-150 hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
        aria-label="Open AI daily brief"
      >
        <Sparkles className="h-6 w-6 text-white drop-shadow-sm" strokeWidth={1.8} />
        <span className="text-sm font-bold text-white">AI Brief</span>
        {dot && <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-white/70", dot)} />}
      </button>

      <InsightModal open={open} onOpenChange={setOpen} insight={insight} isLoading={isLoading} />
    </>
  );
}
