"use client";

import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsightSectionData, InsightMetric } from "@/lib/types";

function MetricChip({ m, neutral }: { m: InsightMetric; neutral?: boolean }) {
  const Icon = m.direction === "up" ? TrendingUp : m.direction === "down" ? TrendingDown : m.direction === "flat" ? Minus : null;
  const color = neutral || !m.direction
    ? "text-muted-foreground"
    : m.direction === "up" ? "text-emerald-600" : m.direction === "down" ? "text-rose-600" : "text-muted-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
      <div className="text-lg font-bold leading-tight">{m.value}</div>
      {m.sub && (
        <div className={cn("mt-0.5 flex items-center gap-1 text-xs", color)}>
          {Icon && <Icon className="h-3.5 w-3.5" />}
          <span>{m.sub}</span>
        </div>
      )}
    </div>
  );
}

export function InsightSection({
  title,
  icon: Icon,
  section,
  tone = "default",
}: {
  title: string;
  icon: React.ElementType;
  section: InsightSectionData;
  tone?: "default" | "warn";
}) {
  const neutral = tone === "warn";
  const hasContent = section.metrics.length > 0 || section.narrative || section.flags.length > 0;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-5 w-5", neutral ? "text-amber-600" : "text-primary")} />
        <h3 className="text-base font-bold">{title}</h3>
      </div>
      {section.headline && <p className="text-sm font-medium">{section.headline}</p>}
      {section.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {section.metrics.map((m, i) => <MetricChip key={i} m={m} neutral={neutral} />)}
        </div>
      )}
      {section.narrative && <p className="text-sm leading-relaxed text-muted-foreground">{section.narrative}</p>}
      {section.flags.length > 0 && (
        <ul className="space-y-1.5">
          {section.flags.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      {!hasContent && <p className="text-sm text-muted-foreground">No notable activity.</p>}
    </section>
  );
}
