

"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp, getDocs, collectionGroup, documentId } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Loader2, Download, ArrowLeft, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SessionLogCard, formatLogForExport } from "@/components/logs/SessionLogCard";
import { VoidsAndCompsCard } from "@/components/logs/VoidsAndCompsCard";
import { Accordion } from "@/components/ui/accordion";
import type { ActivityLog, PendingSession } from "@/lib/types";
import { format as formatDate, addDays } from "date-fns";
import { exportToXlsx } from "@/lib/export/export-xlsx-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";

// Helper functions for date manipulation
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
function customBtnLabel(range: {start: Date; end: Date} | null, active: boolean) {
    if (!active || !range) return "Custom";
    return isSameDay(range.start, range.end)
        ? `Custom: ${fmtDate(range.start)}`
        : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}

type GroupedLog = {
    session: PendingSession;
    logs: ActivityLog[];
};

type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];

const ITEMS_PER_PAGE = 10;


export default function LogsPage() {
  const router = useRouter();
  const { appUser, isSigningOut } = useAuthContext();
  const { activeStore, loading: storeLoading } = useStoreContext();
  const [groupedLogs, setGroupedLogs] = useState<GroupedLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

  const { start, end } = useMemo(() => {
    const now = new Date();
    let s = new Date();
    let e = new Date();

    switch (datePreset) {
        case "today":
            s.setHours(0, 0, 0, 0);
            e.setHours(23, 59, 59, 999);
            break;
        case "yesterday":
            s.setDate(now.getDate() - 1);
            s.setHours(0, 0, 0, 0);
            e.setDate(now.getDate() - 1);
            e.setHours(23, 59, 59, 999);
            break;
        case "week":
            s.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
            s.setHours(0, 0, 0, 0);
            break;
        case "month":
            s = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case "custom":
            if (customRange) {
                s = startOfDay(customRange.start);
                e = endOfDay(customRange.end);
            } else {
                s.setHours(0, 0, 0, 0);
                e.setHours(23, 59, 59, 999);
            }
            break;
    }
    return { start: s, end: e };
  }, [datePreset, customRange]);

   const dateRangeLabel = useMemo(() => {
        if (isSameDay(start, end)) {
            return fmtDate(start);
        }
        return `${fmtDate(start)} - ${fmtDate(end)}`;
    }, [start, end]);
  
   useEffect(() => {
    if (!activeStore?.id || !appUser) {
        setIsLoading(false);
        return;
    };
    
    setIsLoading(true);
    setCurrentPage(0);

    const fetchLogs = async () => {
        const dayIds: string[] = [];
        let currentDate = new Date(start);
        while (currentDate <= end) {
            dayIds.push(getDayIdFromTimestamp(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        if (dayIds.length === 0) {
            setGroupedLogs([]);
            setIsLoading(false);
            return;
        }

        const logPromises = dayIds.map(dayId => {
            const logsQuery = query(
                collection(db, "stores", activeStore.id, "activityLogsByDay", dayId, "logs"),
                orderBy("createdAt", "desc")
            );
            return getDocs(logsQuery);
        });

        try {
            const snapshots = await Promise.all(logPromises);
            const allLogs = snapshots.flatMap(snap => snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog)));

            // Group logs by session ID on the client
            const logsBySessionId = new Map<string, ActivityLog[]>();
            allLogs.forEach(log => {
                if (!logsBySessionId.has(log.sessionId)) {
                    logsBySessionId.set(log.sessionId, []);
                }
                logsBySessionId.get(log.sessionId)!.push(log);
            });

            // Create pseudo-session objects for the UI
            const finalGroupedLogs: GroupedLog[] = Array.from(logsBySessionId.entries()).map(([sessionId, logs]) => {
                const newestLog = logs.sort((a,b) => (toJsDate(b.createdAt)?.getTime() ?? 0) - (toJsDate(a.createdAt)?.getTime() ?? 0))[0];
                
                const pseudoSession: PendingSession = {
                    id: sessionId,
                    storeId: newestLog.storeId,
                    status: newestLog.sessionStatus ?? 'closed',
                    startedAt: newestLog.sessionStartedAt,
                    tableNumber: newestLog.tableNumber || '',
                    sessionMode: newestLog.sessionMode || 'package_dinein',
                    customerName: newestLog.customerName,
                    // Dummy data to satisfy the PendingSession type for the card
                    packageName: '',
                    guestCountCashierInitial: 0,
                    guestCountFinal: 0,
                    guestCountServerVerified: 0,
                    guestCountVerifyLocked: false,
                    packageOfferingId: '',
                };
                return { session: pseudoSession, logs };
            });

            // Sort groups by the newest log in each group
            finalGroupedLogs.sort((a, b) => {
                const timeA = toJsDate(a.logs[0]?.createdAt)?.getTime() ?? 0;
                const timeB = toJsDate(b.logs[0]?.createdAt)?.getTime() ?? 0;
                return timeB - timeA;
            });
            
            setGroupedLogs(finalGroupedLogs);
        } catch (error) {
            if (isSigningOut || !appUser) return;
            console.error("Error fetching logs:", error);
        } finally {
            setIsLoading(false);
        }
    }

    fetchLogs();

  }, [activeStore?.id, start, end, appUser, isSigningOut]);

  const voidAndFreeLogs = useMemo(() => {
    const relevantActions: ActivityLog['action'][] = ["SESSION_VOIDED", "VOID_TICKETS", "MARK_FREE", "RECEIPT_VOIDED"];
    return groupedLogs
        .flatMap(({ session, logs }) => 
            logs
                .filter(log => relevantActions.includes(log.action))
                .map(log => ({ ...log, session })) // Attach session to each log
        )
        .sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });
  }, [groupedLogs]);
  
  const discountLogs = useMemo(() => {
    const relevantActions: ActivityLog['action'][] = ["DISCOUNT_APPLIED", "DISCOUNT_REMOVED", "DISCOUNT_EDITED"];
    return groupedLogs
        .flatMap(({ session, logs }) => 
            logs
                .filter(log => relevantActions.includes(log.action))
                .map(log => ({ ...log, session })) // Attach session to each log
        )
        .sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });
  }, [groupedLogs]);

  const totalPages = Math.ceil(groupedLogs.length / ITEMS_PER_PAGE);
  const paginatedLogs = useMemo(() => {
      const startIndex = currentPage * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      return groupedLogs.slice(startIndex, endIndex);
  }, [groupedLogs, currentPage]);

  const goToNextPage = () => {
      setCurrentPage((prev) => Math.min(prev + 1, totalPages - 1));
  };

  const goToPreviousPage = () => {
      setCurrentPage((prev) => Math.max(prev - 1, 0));
  };

  const handleExport = async () => {
    setIsExporting(true);
    const allLogs = groupedLogs.flatMap(g => g.logs);
    const dataToExport = allLogs.map(formatLogForExport);
    
    await exportToXlsx({
        rows: dataToExport,
        sheetName: "Activity Logs",
        filename: `ActivityLogs_${activeStore?.code}_${formatDate(start, 'yyyyMMdd')}_${formatDate(end, 'yyyyMMdd')}.xlsx`
    });

    setIsExporting(false);
  };
  
  const handleCalendarChange = (range: { start: Date; end: Date }, preset: string | null) => {
    const presetMap: Record<string, DatePreset> = {
      today: "today", yesterday: "yesterday", lastWeek: "week", lastMonth: "month",
    };
    if (preset && preset !== "custom" && presetMap[preset]) {
      setDatePreset(presetMap[preset]);
      setCustomRange(null);
    } else {
      setCustomRange({ start: range.start, end: range.end });
      setDatePreset("custom");
    }
    setIsCalendarOpen(false);
  };


  if (storeLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
  }

  if (!activeStore) {
    return (
      <Card className="w-full max-w-md mx-auto text-center">
        <CardHeader>
          <CardTitle>No Store Selected</CardTitle>
          <CardDescription>Please select a store to view its activity logs.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <PageHeader
        title="Activity Logs"
        description={`Audit trail for ${activeStore.name}.`}
      >
        <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => router.back()} size="sm">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                 <Button onClick={handleExport} disabled={isExporting || isLoading || groupedLogs.length === 0} variant="outline" size="sm">
                    {isExporting ? <Loader2 className="mr-2 animate-spin"/> : <Download className="mr-2" />}
                    Export
                </Button>
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-1">
                    {presets.map(p => (
                        <Button key={p.value} variant={datePreset === p.value ? 'default' : 'ghost'} size="sm" onClick={() => { setDatePreset(p.value); setCustomRange(null); }} className="h-8">{p.label}</Button>
                    ))}
                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                        <PopoverTrigger asChild>
                            <Button variant={datePreset === "custom" ? "default" : "ghost"} size="sm" className="h-8 min-w-[100px]">{customBtnLabel(customRange, datePreset === "custom")}</Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0"><CompactCalendar onChange={handleCalendarChange}/></PopoverContent>
                    </Popover>
                </div>
            </div>
            <p className="text-sm text-muted-foreground w-full md:w-auto text-right">{dateRangeLabel}</p>
        </div>
      </PageHeader>
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
             <Card>
                <CardHeader>
                    <CardTitle>Session Logs</CardTitle>
                    <CardDescription>All activities grouped by session.</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-40"><Loader2 className="animate-spin" /></div>
                    ) : groupedLogs.length > 0 ? (
                        <Accordion type="single" collapsible className="w-full space-y-4">
                            {paginatedLogs.map(({ session, logs }) => (
                                <SessionLogCard key={session.id} session={{...session, startedAtClientMs: session.startedAtClientMs ?? undefined}} initialLogs={logs} />
                            ))}
                        </Accordion>
                    ) : (
                        <p className="p-10 text-center text-muted-foreground">
                            No activity found for the selected date range.
                        </p>
                    )}
                </CardContent>
                {totalPages > 1 && (
                    <CardFooter className="flex justify-between items-center">
                        <Button variant="outline" onClick={goToPreviousPage} disabled={currentPage === 0}>
                             <ArrowLeft className="mr-2 h-4 w-4" /> Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                            Page {currentPage + 1} of {totalPages}
                        </span>
                        <Button variant="outline" onClick={goToNextPage} disabled={currentPage >= totalPages - 1}>
                            Next <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </CardFooter>
                )}
            </Card>
        </div>
        <div>
            <VoidsAndCompsCard logs={voidAndFreeLogs} discountLogs={discountLogs} isLoading={isLoading} />
        </div>
      </div>
    </RoleGuard>
  );
}
