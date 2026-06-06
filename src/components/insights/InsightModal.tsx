"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, CircleCheck, CircleAlert, CircleX, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyInsight } from "@/lib/types";

const SENTIMENT = {
  good: { label: "Good day", className: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CircleCheck },
  mixed: { label: "Mixed day", className: "bg-amber-100 text-amber-700 border-amber-200", Icon: CircleAlert },
  poor: { label: "Tough day", className: "bg-rose-100 text-rose-700 border-rose-200", Icon: CircleX },
} as const;

export function InsightModal({
  open,
  onOpenChange,
  insight,
  isLoading,
  reportHref = "/admin/insights",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  insight: DailyInsight | null;
  isLoading?: boolean;
  reportHref?: string;
}) {
  const router = useRouter();
  const s = insight ? (SENTIMENT[insight.summary.sentiment] ?? SENTIMENT.mixed) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Yesterday's AI Brief
          </DialogTitle>
          <DialogDescription>A quick read on how the store did yesterday.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !insight || insight.status === "no_data" ? (
          <p className="py-6 text-sm text-muted-foreground">
            {insight?.status === "no_data"
              ? "No sales were recorded yesterday, so there's no brief to show."
              : "No insight has been generated yet. Open the full report to generate one."}
          </p>
        ) : (
          <div className="space-y-3">
            {s && (
              <Badge variant="outline" className={cn("gap-1 font-medium", s.className)}>
                <s.Icon className="h-3.5 w-3.5" /> {s.label}
              </Badge>
            )}
            <p className="text-sm font-medium">{insight.summary.headline}</p>
            {insight.summary.bullets.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {insight.summary.bullets.slice(0, 4).map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => { onOpenChange(false); router.push(reportHref); }}>
            View full report <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
