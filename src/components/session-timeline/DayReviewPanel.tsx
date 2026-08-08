"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { format } from "date-fns";
import { ChevronDown, Download } from "lucide-react";
import { db } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { exportToXlsx } from "@/lib/export/export-xlsx-client";
import { formatLogAmount, formatLogDescription, actionLabel } from "@/lib/logs/describe-log";
import { toJsDate } from "@/lib/utils/date";
import type { ActivityLog } from "@/lib/types";
import { VoidsAndCompsCard } from "./VoidsAndCompsCard";
import { StaffAdjustmentsCard } from "./StaffAdjustmentsCard";

/**
 * Day-wide review of exceptions, folded in from the deleted `/logs` page.
 *
 * Scoped to whichever date the table above is showing, and its query does not
 * run until the panel is opened — the timeline's whole design is one document
 * read per day, and this must not quietly become a second mandatory fetch.
 */

const VOID_AND_FREE_ACTIONS = [
  "SESSION_VOIDED", "VOID_TICKETS", "MARK_FREE", "RECEIPT_VOIDED", "RECEIPT_REFUND",
];
const DISCOUNT_ACTIONS = ["DISCOUNT_APPLIED", "DISCOUNT_REMOVED", "DISCOUNT_EDITED"];

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; logs: ActivityLog[] }
  | { status: "error"; message: string };

function formatLogForExport(log: ActivityLog) {
  const d = toJsDate(log.createdAt);
  return {
    "Session ID": log.sessionId.substring(0, 8),
    "Date": d ? format(d, "yyyy-MM-dd") : "N/A",
    "Time": d ? format(d, "HH:mm:ss") : "N/A",
    "Action": actionLabel(log.action),
    "Server": log.serverProfileName || "",
    "Actor": log.actorName || log.actorUid,
    "Description": formatLogDescription(log),
    "Amount": formatLogAmount(log),
  };
}

export function DayReviewPanel({
  storeId,
  storeCode,
  dayId,
  selectedDate,
  open,
  onOpenChange,
  onLogsLoaded,
  onFocusLog,
  sessionsSheet,
}: {
  storeId: string;
  storeCode?: string | null;
  dayId: string;
  selectedDate: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the page derive per-session exception chips at no extra read cost. */
  onLogsLoaded: (logs: ActivityLog[]) => void;
  onFocusLog: (log: ActivityLog) => void;
  /** Rows of the day's session table, exported as a second sheet. */
  sessionsSheet?: Record<string, unknown>[];
}) {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "idle" });

  // Changing the date resets to idle but leaves the panel open, so it refetches
  // for the new day only because the user asked for the panel in the first place.
  useEffect(() => {
    setState({ status: "idle" });
  }, [dayId, storeId]);

  useEffect(() => {
    if (!open || state.status !== "idle" || !storeId) return;
    let cancelled = false;
    setState({ status: "loading" });
    getDocs(query(
      collection(db, "stores", storeId, "activityLogsByDay", dayId, "logs"),
      orderBy("createdAt", "desc")
    ))
      .then((snap) => {
        if (cancelled) return;
        const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog));
        onLogsLoaded(logs);
        setState({ status: "loaded", logs });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setState({ status: "error", message: err?.message || "Could not load the day's activity." });
      });
    return () => { cancelled = true; };
  }, [open, state.status, storeId, dayId, onLogsLoaded]);

  const logs = state.status === "loaded" ? state.logs : [];
  const voidAndFreeLogs = logs.filter((l) => VOID_AND_FREE_ACTIONS.includes(l.action));
  const discountLogs = logs.filter((l) => DISCOUNT_ACTIONS.includes(l.action));
  const isLoading = state.status === "loading";

  const handleExport = () => {
    if (logs.length === 0) return;
    try {
      const sheets = [{ name: "Activity Logs", data: logs.map(formatLogForExport) }];
      if (sessionsSheet?.length) sheets.push({ name: "Sessions", data: sessionsSheet as any[] });
      void exportToXlsx({ filename: `ActivityLogs_${storeCode || storeId}_${dayId}.xlsx`, sheets });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Export failed", description: err?.message });
    }
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card>
        <div className="flex items-start justify-between gap-2 pr-4">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex-1 text-left group">
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <ChevronDown
                  className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden
                />
                <div>
                  <CardTitle className="text-base">Day Review</CardTitle>
                  <CardDescription>
                    Voids, comps, discounts and staff attribution for {format(selectedDate, "MMMM d, yyyy")}.
                  </CardDescription>
                </div>
              </CardHeader>
            </button>
          </CollapsibleTrigger>
          <Button
            variant="outline"
            size="sm"
            className="mt-6 shrink-0"
            disabled={state.status !== "loaded" || logs.length === 0}
            onClick={handleExport}
          >
            <Download className="mr-2 h-3.5 w-3.5" aria-hidden /> Export
          </Button>
        </div>

        <CollapsibleContent>
          <CardContent>
            {state.status === "error" ? (
              <p className="text-sm text-destructive py-4">{state.message}</p>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <VoidsAndCompsCard
                  logs={voidAndFreeLogs}
                  discountLogs={discountLogs}
                  isLoading={isLoading}
                  onFocusLog={onFocusLog}
                />
                <StaffAdjustmentsCard logs={logs} isLoading={isLoading} />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
