"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineChart, Clock, Sparkles, AlertTriangle, Lightbulb, CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useLocalProfile } from "@/context/local-profile-context";
import { useDailyInsight, yesterdayInsightDayId } from "@/hooks/useDailyInsight";
import { InsightSection } from "@/components/insights/InsightSection";
import type { DailyInsightSuggestion } from "@/lib/types";

type RoleKey = "cashier" | "server" | "kitchen";
const ROLE_CONFIG: Record<RoleKey, { section: "sales" | "operations"; title: string; icon: React.ElementType; area: DailyInsightSuggestion["area"] }> = {
  cashier: { section: "sales", title: "Sales", icon: LineChart, area: "sales" },
  server: { section: "operations", title: "Operations", icon: Clock, area: "ops" },
  kitchen: { section: "operations", title: "Kitchen & Operations", icon: Clock, area: "ops" },
};

const SENTIMENT = {
  good: { label: "Good day", className: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CircleCheck },
  mixed: { label: "Mixed day", className: "bg-amber-100 text-amber-700 border-amber-200", Icon: CircleAlert },
  poor: { label: "Tough day", className: "bg-rose-100 text-rose-700 border-rose-200", Icon: CircleX },
} as const;

/**
 * Shows yesterday's AI brief once per shift-start for cashier/server/kitchen
 * local users (admin/manager bypass — they have the dashboard badge). Reads the
 * SAME cached insight doc; "seen" is remembered per device+day+profile+role.
 */
export function RoleBriefGate() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { currentProfile, isReady } = useLocalProfile();
  const { insight } = useDailyInsight(activeStore?.id);
  const [open, setOpen] = useState(false);

  const role = appUser?.role as string | undefined;
  const cfg = role && (role in ROLE_CONFIG) ? ROLE_CONFIG[role as RoleKey] : null;
  const profileId = currentProfile?.profileId ?? null;
  const storeId = activeStore?.id ?? null;
  const seenKey = storeId && profileId && cfg ? `aiBrief:${storeId}:${yesterdayInsightDayId()}:${profileId}:${role}` : null;

  useEffect(() => {
    if (!cfg || !isReady || !profileId || !seenKey) return;
    if (!insight || insight.status !== "ok") return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(seenKey)) return;
    setOpen(true);
  }, [cfg, isReady, profileId, seenKey, insight]);

  if (!cfg || !insight || insight.status !== "ok") return null;

  const markSeenAndClose = () => {
    if (seenKey && typeof window !== "undefined") {
      try { window.localStorage.setItem(seenKey, "1"); } catch {}
    }
    setOpen(false);
  };

  const section = insight[cfg.section];
  const s = SENTIMENT[insight.summary.sentiment] ?? SENTIMENT.mixed;
  const suggestions = (insight.suggestions ?? []).filter((x) => x.area === cfg.area || x.area === "general");
  const watch = insight.anomalies?.flags ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) markSeenAndClose(); }}>
      <DialogContent
        className="max-w-md grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Yesterday's Brief
          </DialogTitle>
          <DialogDescription>
            Quick read for {currentProfile?.name ? `${currentProfile.name} — ` : ""}{cfg.title.toLowerCase()} before you start.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 space-y-4">
          {/* Summary */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <Badge variant="outline" className={cn("gap-1 font-medium", s.className)}>
              <s.Icon className="h-3.5 w-3.5" /> {s.label}
            </Badge>
            <p className="text-sm font-medium">{insight.summary.headline}</p>
          </div>

          {/* Role section */}
          <InsightSection title={cfg.title} icon={cfg.icon} section={section} />

          {/* Watch list (store-wide flags to settle) */}
          {watch.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" /> Watch today</div>
              <ul className="space-y-1">
                {watch.map((f, i) => <li key={i} className="text-sm text-muted-foreground">• {f}</li>)}
              </ul>
            </div>
          )}

          {/* Role suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-1.5 pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-primary" /> Today's focus</div>
              <ul className="space-y-1">
                {suggestions.map((sug, i) => <li key={i} className="text-sm">• {sug.text}</li>)}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="p-6 pt-2">
          <Button className="w-full" onClick={markSeenAndClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
