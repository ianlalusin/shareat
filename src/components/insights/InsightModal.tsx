"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, CircleCheck, CircleAlert, CircleX, Loader2, LineChart, Clock, Lightbulb, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyInsight } from "@/lib/types";
import { InsightSection } from "./InsightSection";

const SENTIMENT = {
  good: { label: "Good day", className: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CircleCheck },
  mixed: { label: "Mixed day", className: "bg-amber-100 text-amber-700 border-amber-200", Icon: CircleAlert },
  poor: { label: "Tough day", className: "bg-rose-100 text-rose-700 border-rose-200", Icon: CircleX },
} as const;

export type InsightScope = "full" | "sales" | "operations";

export function InsightModal({
  open,
  onOpenChange,
  insight,
  isLoading,
  scope = "full",
  reportHref = "/admin/insights",
  showFullReportButton = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  insight: DailyInsight | null;
  isLoading?: boolean;
  scope?: InsightScope;
  reportHref?: string;
  showFullReportButton?: boolean;
}) {
  const router = useRouter();
  const s = insight ? (SENTIMENT[insight.summary.sentiment] ?? SENTIMENT.mixed) : null;
  const ok = insight && insight.status === "ok";

  const section = ok && scope === "sales" ? insight.sales : ok && scope === "operations" ? insight.operations : null;
  const sectionMeta = scope === "sales"
    ? { title: "Sales", icon: LineChart, area: "sales" as const }
    : scope === "operations"
      ? { title: "Operations", icon: Clock, area: "ops" as const }
      : null;
  const suggestions = ok && sectionMeta ? (insight.suggestions ?? []).filter((x) => x.area === sectionMeta.area || x.area === "general") : [];
  const watch = ok && sectionMeta ? (insight.anomalies?.flags ?? []) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[88vh]">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Yesterday's AI Brief
          </DialogTitle>
          <DialogDescription>A quick read on how the store did yesterday.</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !ok ? (
            <p className="py-6 text-sm text-muted-foreground">
              {insight?.status === "no_data"
                ? "No sales were recorded yesterday, so there's no brief to show."
                : "No insight has been generated yet."}
            </p>
          ) : (
            <>
              {s && (
                <Badge variant="outline" className={cn("gap-1 font-medium", s.className)}>
                  <s.Icon className="h-3.5 w-3.5" /> {s.label}
                </Badge>
              )}
              <p className="text-sm font-medium">{insight!.summary.headline}</p>

              {/* Full scope: quick bullets. Scoped: the relevant section. */}
              {scope === "full" && insight!.summary.bullets.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {insight!.summary.bullets.slice(0, 4).map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}

              {section && sectionMeta && <InsightSection title={sectionMeta.title} icon={sectionMeta.icon} section={section} />}

              {watch.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" /> Watch today</div>
                  <ul className="space-y-1">{watch.map((f, i) => <li key={i} className="text-sm text-muted-foreground">• {f}</li>)}</ul>
                </div>
              )}

              {suggestions.length > 0 && (
                <div className="space-y-1.5 pb-1">
                  <div className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-primary" /> Today's focus</div>
                  <ul className="space-y-1">{suggestions.map((sug, i) => <li key={i} className="text-sm">• {sug.text}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="p-6 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {showFullReportButton && (
            <Button onClick={() => { onOpenChange(false); router.push(reportHref); }}>
              View full report <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
