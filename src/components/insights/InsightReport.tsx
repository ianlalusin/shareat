"use client";

import { LineChart, Clock, Boxes, AlertTriangle, Lightbulb, Sparkles, CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { DailyInsight, DailyInsightSuggestion } from "@/lib/types";
import { InsightSection } from "./InsightSection";

const SENTIMENT = {
  good: { label: "Good day", className: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CircleCheck },
  mixed: { label: "Mixed day", className: "bg-amber-100 text-amber-700 border-amber-200", Icon: CircleAlert },
  poor: { label: "Tough day", className: "bg-rose-100 text-rose-700 border-rose-200", Icon: CircleX },
} as const;

const PRIORITY: Record<DailyInsightSuggestion["priority"], string> = {
  high: "border-rose-300 text-rose-700",
  medium: "border-amber-300 text-amber-700",
  low: "border-muted-foreground/30 text-muted-foreground",
};

export function InsightReport({ insight }: { insight: DailyInsight }) {
  if (insight.status === "no_data") {
    return <p className="text-sm text-muted-foreground">No sales were recorded for the analyzed day, so there's nothing to report yet.</p>;
  }
  const s = SENTIMENT[insight.summary.sentiment] ?? SENTIMENT.mixed;
  return (
    <div className="space-y-6">
      {/* Summary */}
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold">At a glance</h2>
          </div>
          <Badge variant="outline" className={cn("gap-1 font-medium", s.className)}>
            <s.Icon className="h-3.5 w-3.5" /> {s.label}
          </Badge>
        </div>
        <p className="text-sm font-medium">{insight.summary.headline}</p>
        {insight.summary.bullets.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {insight.summary.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
      </section>

      <InsightSection title="Sales" icon={LineChart} section={insight.sales} />
      <Separator />
      <InsightSection title="Operations" icon={Clock} section={insight.operations} />
      <Separator />
      <InsightSection title="Inventory movement" icon={Boxes} section={insight.inventory} />
      <Separator />
      <InsightSection title="Anomalies & watch" icon={AlertTriangle} section={insight.anomalies} tone="warn" />

      {insight.suggestions.length > 0 && (
        <>
          <Separator />
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              <h3 className="text-base font-bold">Suggestions for today</h3>
            </div>
            <ul className="space-y-2">
              {insight.suggestions.map((sug, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className={cn("shrink-0 text-[10px] uppercase", PRIORITY[sug.priority])}>{sug.priority}</Badge>
                  <span>{sug.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="pt-2 text-[11px] text-muted-foreground">
        Figures are computed from recorded analytics; the written analysis is AI-generated. Inventory reflects menu-item sell-through, not raw stock.
      </p>
    </div>
  );
}
