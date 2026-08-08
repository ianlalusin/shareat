"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle, ChevronDown, Clock, CreditCard, DoorClosed, ShieldCheck, Utensils, UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { SessionStage, StageAdjustment, StageItem, StageKind, StageTone } from "@/lib/session-timeline/stages";

const STAGE_ICON: Record<StageKind, typeof Clock> = {
  start: UserPlus,
  verify: ShieldCheck,
  service: Utensils,
  adjustments: AlertTriangle,
  billout: CreditCard,
  closed: DoorClosed,
};

const TONE_TEXT: Record<StageTone, string> = {
  neutral: "",
  warn: "text-amber-600 dark:text-amber-500",
  danger: "text-red-600 dark:text-red-500",
};

const TONE_BORDER: Record<StageTone, string> = {
  neutral: "border-border",
  warn: "border-amber-300 dark:border-amber-800",
  danger: "border-red-300 dark:border-red-800",
};

const ADJ_CHIP: Record<StageAdjustment["kind"], string> = {
  void: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
  free: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
  discount: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  charge: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
  override: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900",
  change: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  other: "",
};

const clock = (ms: number | null | undefined) => (ms ? format(new Date(ms), "h:mm a") : null);
const clockSeconds = (ms: number | null | undefined) => (ms ? format(new Date(ms), "h:mm:ss a") : "—");

function lapseLabel(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** How many service items to show before hiding the rest behind a toggle. */
const ITEM_PREVIEW = 6;

function ServiceItemRow({ item }: { item: StageItem }) {
  const lapse = lapseLabel(item.lapseMs);
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="truncate">
          <span className="font-medium">{item.qtyLabel}×</span> {item.name}
          {item.kind === "refill" && (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] align-middle">refill</Badge>
          )}
        </p>
        {item.flavors.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">{item.flavors.join(", ")}</p>
        )}
        {item.batches.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {item.batches.map((b, i) => `#${i + 1} ${b.qty}×`).join(" · ")}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 tabular-nums text-xs">
        {lapse ? (
          <p className={cn(TONE_TEXT[item.tone], item.tone !== "neutral" && "font-medium")}>{lapse}</p>
        ) : (
          <p className="text-muted-foreground">{item.servedAtMs ? "—" : "not served"}</p>
        )}
        <p className="text-muted-foreground">{item.priceLabel ?? (item.free ? "free" : "")}</p>
      </div>
    </li>
  );
}

function AdjustmentRow({ adj, focused }: { adj: StageAdjustment; focused: boolean }) {
  return (
    <li
      className={cn(
        "py-1.5 border-b border-border/50 last:border-0 -mx-1 px-1 rounded",
        focused && "ring-2 ring-primary bg-primary/5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn("h-4 px-1 text-[10px]", ADJ_CHIP[adj.kind])}>
              {adj.kind}
            </Badge>
            <span className="truncate">{adj.title}</span>
          </p>
          {adj.detail && <p className="text-xs text-muted-foreground">{adj.detail}</p>}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {clockSeconds(adj.atMs)}
            {adj.actorName ? ` · ${adj.actorName}` : ""}
          </p>
        </div>
        {adj.amount != null && (
          <span className="shrink-0 tabular-nums text-xs">
            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(adj.amount)}
          </span>
        )}
      </div>
    </li>
  );
}

export function StageCard({ stage, focusId }: { stage: SessionStage; focusId?: string | null }) {
  const [showAllItems, setShowAllItems] = useState(false);
  const Icon = STAGE_ICON[stage.kind];
  const time = clock(stage.atMs);
  const lapse = lapseLabel(stage.lapseMs);

  const items = stage.items ?? [];
  const visibleItems = showAllItems ? items : items.slice(0, ITEM_PREVIEW);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className={cn("rounded-lg border bg-background p-3 text-sm h-full", TONE_BORDER[stage.tone])}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="font-medium flex items-center gap-1.5 min-w-0">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE_TEXT[stage.tone])} aria-hidden />
          <span className="truncate">{stage.label}</span>
        </p>
        {time && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{time}</span>}
      </div>

      {lapse && (
        <Badge variant="secondary" className="mb-2 h-5 px-1.5 text-[11px] font-normal">
          <Clock className="mr-1 h-3 w-3" aria-hidden /> {lapse}
        </Badge>
      )}

      {stage.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {stage.facts.map((fact, i) => (
            <div key={`${fact.label}-${i}`} className="contents">
              <dt className="text-muted-foreground whitespace-nowrap">{fact.label}</dt>
              <dd className={cn("text-right break-words", TONE_TEXT[fact.tone ?? "neutral"])} title={fact.hint}>
                {fact.value}
                {fact.hint && <span className="block text-[10px] text-muted-foreground">{fact.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {stage.summary && <p className="text-xs text-muted-foreground mt-2">{stage.summary}</p>}

      {items.length > 0 && (
        <div className="mt-2">
          <ul className={cn("text-xs", showAllItems && "max-h-64 overflow-y-auto")}>
            {visibleItems.map((item) => <ServiceItemRow key={item.id} item={item} />)}
          </ul>
          {(hiddenCount > 0 || showAllItems) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 mt-1 text-xs"
              onClick={() => setShowAllItems((v) => !v)}
            >
              {showAllItems ? "Show less" : `Show all ${items.length}`}
              <ChevronDown className={cn("ml-1 h-3 w-3 transition-transform", showAllItems && "rotate-180")} aria-hidden />
            </Button>
          )}
        </div>
      )}

      {stage.adjustments && stage.adjustments.length > 0 && (
        <Collapsible defaultOpen={stage.adjustments.length <= 4} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-xs">
              {stage.adjustments.length} adjustment{stage.adjustments.length === 1 ? "" : "s"}
              <ChevronDown className="ml-1 h-3 w-3" aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="text-xs max-h-64 overflow-y-auto">
              {stage.adjustments.map((adj) => (
                <AdjustmentRow key={adj.id} adj={adj} focused={!!focusId && adj.logId === focusId} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {stage.actors.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2 truncate" title={stage.actors.join(", ")}>
          {stage.actors.join(", ")}
        </p>
      )}

      {stage.empty && stage.facts.length === 0 && (
        <p className="text-xs text-muted-foreground">Nothing recorded.</p>
      )}
    </div>
  );
}
