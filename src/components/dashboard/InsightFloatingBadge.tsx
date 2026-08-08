"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useDailyInsight } from "@/hooks/useDailyInsight";
import { InsightModal, type InsightScope } from "@/components/insights/InsightModal";

const SENTIMENT_DOT: Record<string, string> = {
  good: "bg-emerald-400",
  mixed: "bg-amber-400",
  poor: "bg-rose-400",
};

/** Which slice of the brief is relevant for this role + page. */
function scopeFor(role: string | undefined, pathname: string): InsightScope {
  if (role === "cashier") return "sales";
  if (role === "server" || role === "kitchen") return "operations";
  // admin/manager roam all pages — scope by what page they're on.
  const p = pathname || "";
  if (p.startsWith("/kitchen") || p.startsWith("/server")) return "operations";
  if (p.startsWith("/cashier") || p.startsWith("/sales-report") || p.startsWith("/receipts")) return "sales";
  return "full";
}

/**
 * Global floating AI-brief badge — available on every page once signed in, so
 * anyone can re-read yesterday's brief anytime. Content is scoped to the role +
 * current page. Hidden when there's no usable insight for the day.
 */
export function InsightFloatingBadge() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { insight } = useDailyInsight(activeStore?.id);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Master AI switch: hide the brief entirely for stores with AI off.
  if (activeStore?.aiEnabled !== true) return null;
  if (!insight || insight.status !== "ok") return null;
  // The billing/payment view (/cashier?sessionId=...) used to pin Bill
  // Discount/Add Charge to this same bottom-left corner, which the fixed
  // badge would sit on top of. That action bar now lives under the right
  // (Billable Items) column instead of full-width, so the bottom-left corner
  // is clear here too — no special-case hide needed.

  const role = appUser?.role;
  const scope = scopeFor(role, pathname);
  const isManager = role === "admin" || role === "manager";
  const dot = SENTIMENT_DOT[insight.summary.sentiment];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-50 flex h-14 items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 px-4 shadow-lg outline-none transition-all duration-150 hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
        aria-label="Open AI brief"
      >
        <Sparkles className="h-6 w-6 text-white drop-shadow-sm" strokeWidth={1.8} />
        <span className="text-sm font-bold text-white">AI Brief</span>
        {dot && <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-white/70", dot)} />}
      </button>

      <InsightModal
        open={open}
        onOpenChange={setOpen}
        insight={insight}
        scope={scope}
        showFullReportButton={isManager}
      />
    </>
  );
}
