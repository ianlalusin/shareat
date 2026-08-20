"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, Loader2, Receipt, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DailySessionRow } from "@/lib/analytics/session-row";
import { buildSessionStages } from "@/lib/session-timeline/stages";
import {
  actorLabel, collectActorUids, collectLocalActorNames, resolveStaffNames, type ActorNameMap,
} from "@/lib/session-timeline/actors";
import type { SessionAuditFlag, SessionTrailSources } from "@/lib/session-timeline/types";
import { AuditTail } from "./AuditTail";
import { StageRail } from "./StageRail";

export type TrailEntry =
  | { status: "loading" }
  | { status: "ready"; sources: SessionTrailSources }
  | { status: "error"; message: string };

function summaryText(row: DailySessionRow, stages: ReturnType<typeof buildSessionStages>): string {
  const lines = [
    `Receipt ${row.receiptNumber ?? row.receiptId}`,
    row.tableNumber ? `Table ${row.tableNumber}` : null,
    "",
    ...stages.map((s) => {
      const facts = s.facts.map((f) => `${f.label}: ${f.value}`).join(", ");
      return `${s.label}${s.summary ? ` (${s.summary})` : ""}${facts ? ` — ${facts}` : ""}`;
    }),
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function ExpandedSessionPanel({
  storeId,
  row,
  entry,
  flavorNames,
  siblingRows,
  focusId,
  onRetry,
  onExpandSibling,
}: {
  storeId: string;
  row: DailySessionRow;
  entry: TrailEntry | undefined;
  flavorNames: Map<string, string>;
  siblingRows: DailySessionRow[];
  focusId?: string | null;
  onRetry: () => void;
  onExpandSibling?: (receiptId: string) => void;
}) {
  const [staffNames, setStaffNames] = useState<ActorNameMap>(() => new Map());
  const [flagOverride, setFlagOverride] = useState<SessionAuditFlag | null>(null);
  const [copied, setCopied] = useState(false);

  const sources = entry?.status === "ready" ? entry.sources : null;

  const localNames = useMemo(
    () => (sources ? collectLocalActorNames(sources) : new Map<string, string>()),
    [sources]
  );

  // Only the UIDs the documents could not name themselves reach the staff
  // collection — usually none, since activity logs carry their own actor names.
  useEffect(() => {
    if (!sources) return;
    const missing = collectActorUids(sources).filter((uid) => !localNames.has(uid));
    if (missing.length === 0) return;
    let cancelled = false;
    resolveStaffNames(missing)
      .then((resolved) => { if (!cancelled && resolved.size) setStaffNames((prev) => new Map([...prev, ...resolved])); })
      .catch(() => {/* a shortened uid is rendered instead */});
    return () => { cancelled = true; };
  }, [sources, localNames]);

  const effectiveSources = useMemo(
    () => (sources && flagOverride ? { ...sources, flag: flagOverride } : sources),
    [sources, flagOverride]
  );

  const stages = useMemo(
    () => (effectiveSources ? buildSessionStages({ row, sources: effectiveSources, flavorNames, siblingRows }) : []),
    [effectiveSources, row, flavorNames, siblingRows]
  );

  if (!entry || entry.status === "loading") {
    return (
      <div className="p-4 space-y-2" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }

  if (entry.status === "error") {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>Could not load this session</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{entry.message}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const nameMaps = [localNames, staffNames];
  const siblings = siblingRows.filter((r) => r.receiptId !== row.receiptId);
  const openedBy = actorLabel((effectiveSources?.session as any)?.startedByUid, nameMaps);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(row, stages));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable on insecure origins — nothing useful to say.
    }
  };

  return (
    <div className={cn("p-4", row.isRefund && "border-l-2 border-red-400")}>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {openedBy.resolved && <span>Opened by {openedBy.name}</span>}
          {siblings.length > 0 && (
            <span className="block mt-1">
              This session produced {siblings.length + 1} receipts —{" "}
              {siblings.map((s) => (
                <Button
                  key={s.receiptId}
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => onExpandSibling?.(s.receiptId)}
                >
                  {s.receiptNumber ?? s.receiptId.slice(0, 8)}
                  {s.isRefund && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">refund</Badge>}
                </Button>
              ))}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copySummary}>
            {copied ? <Check className="mr-2 h-3.5 w-3.5" aria-hidden /> : <ClipboardCopy className="mr-2 h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy summary"}
          </Button>
          {/* Same tab on purpose: the timeline keeps its date/receipt/focus in the
              URL, so Back returns to this exact expanded session. */}
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/receipt?id=${encodeURIComponent(row.receiptId)}`}>
              <Receipt className="mr-2 h-3.5 w-3.5" aria-hidden />
              View receipt
            </Link>
          </Button>
        </div>
      </div>

      <StageRail stages={stages} focusId={focusId} />

      {effectiveSources && (
        <AuditTail
          storeId={storeId}
          sources={effectiveSources}
          nameMaps={nameMaps}
          focusId={focusId}
          onFlagSaved={setFlagOverride}
        />
      )}
    </div>
  );
}

export function PanelLoadingRow() {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading session…
    </div>
  );
}
