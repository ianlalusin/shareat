
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp, getDocs, collectionGroup, documentId } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Loader2, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { SessionLogCard, formatLogForExport } from "@/components/logs/SessionLogCard";
import { Accordion } from "@/components/ui/accordion";
import type { ActivityLog, PendingSession } from "@/lib/types";
import * as XLSX from "xlsx";
import { format as formatDate } from "date-fns";

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
function customBtnLabel(range: { start: Date; end: Date } | null, active: boolean) {
  if (!active || !range) return "Custom";
  return isSameDay(range.start, range.end)
    ? `Custom: ${fmtDate(range.start)}`
    : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}

type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
];

type GroupedLog = {
    session: PendingSession;
    logs: ActivityLog[];
};


export default function LogsPage() {
  const { activeStore, loading: storeLoading } = useStoreContext();
  const [groupedLogs, setGroupedLogs] = useState<GroupedLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

  const sessionCacheRef = useRef(new Map<string, PendingSession>());
  const reqIdRef = useRef(0);

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
    if (!activeStore?.id) {
        setIsLoading(false);
        return;
    };
    setIsLoading(true);

    const logsQuery = query(
        collectionGroup(db, "activityLogs"),
        where("storeId", "==", activeStore.id),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<=", Timestamp.fromDate(end)),
        orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(logsQuery, async (snapshot) => {
        const currentReqId = ++reqIdRef.current;
        const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog));
        const uniqueLogs = Array.from(new Map(logsData.map(l => [l.id, l])).values());

        const sessionIds = [...new Set(uniqueLogs.map(log => log.sessionId))];
        if (sessionIds.length === 0) {
            setGroupedLogs([]);
            setIsLoading(false);
            return;
        }

        const missingSessionIds = sessionIds.filter(id => !sessionCacheRef.current.has(id));
        
        if (missingSessionIds.length > 0) {
            const idChunks: string[][] = [];
            for (let i = 0; i < missingSessionIds.length; i += 10) {
                idChunks.push(missingSessionIds.slice(i, i + 10));
            }
            
            for (const chunk of idChunks) {
                const sessionQuery = query(collection(db, "stores", activeStore.id, "sessions"), where(documentId(), "in", chunk));
                const sessionsSnap = await getDocs(sessionQuery);
                sessionsSnap.forEach(doc => {
                    sessionCacheRef.current.set(doc.id, { id: doc.id, ...doc.data() } as PendingSession);
                });
            }
        }
        
        if (reqIdRef.current !== currentReqId) return; // Stale request

        const logsBySessionId = new Map<string, ActivityLog[]>();
        for (const log of uniqueLogs) {
            if (!logsBySessionId.has(log.sessionId)) {
                logsBySessionId.set(log.sessionId, []);
            }
            logsBySessionId.get(log.sessionId)!.push(log);
        }
        
        const finalGroupedLogs: GroupedLog[] = [];
        for (const [sessionId, logs] of logsBySessionId.entries()) {
            const session = sessionCacheRef.current.get(sessionId);
            if (session) {
                logs.sort((a,b)=> (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
                finalGroupedLogs.push({ session, logs });
            }
        }
        
        finalGroupedLogs.sort((a, b) => {
            const lastLogA = a.logs[0]?.createdAt.toMillis() || 0;
            const lastLogB = b.logs[0]?.createdAt.toMillis() || 0;
            return lastLogB - lastLogA;
        });

        setGroupedLogs(finalGroupedLogs);
        setIsLoading(false);
    }, (error) => {
        console.error("Error fetching logs:", error);
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [activeStore?.id, start, end]);


  const handleCalendarChange = (range: { start: Date; end: Date }, preset: string | null) => {
    const presetMap: Record<string, DatePreset> = {
      today: "today",
      yesterday: "yesterday",
      lastWeek: "week",
      lastMonth: "month",
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
  
  const handleExport = () => {
    const allLogs = groupedLogs.flatMap(g => g.logs.map(log => formatLogForExport(log)));
    const worksheet = XLSX.utils.json_to_sheet(allLogs);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Activity Logs");
    XLSX.writeFile(workbook, `activity_logs_${formatDate(new Date(), 'yyyy-MM-dd')}.xlsx`);
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
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader
        title="Activity Logs"
        description={`Audit trail for ${activeStore.name}.`}
        className="flex-col items-start gap-4 md:flex-row md:items-center"
      >
        <div className="flex items-center gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-1">
                {presets.map((p) => (
                <Button
                    key={p.value}
                    variant={datePreset === p.value ? "default" : "ghost"}
                    size="sm"
                    onClick={() => {
                    setDatePreset(p.value);
                    setCustomRange(null);
                    }}
                    className="h-8"
                >
                    {p.label}
                </Button>
                ))}
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                    <Button
                    variant={datePreset === "custom" ? "default" : "ghost"}
                    size="sm"
                    className="h-8 min-w-[100px]"
                    >
                    {customBtnLabel(customRange, datePreset === "custom")}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                    <CompactCalendar onChange={handleCalendarChange} />
                </PopoverContent>
                </Popover>
            </div>
             <Button variant="outline" onClick={handleExport} disabled={groupedLogs.length === 0}><Download className="mr-2"/> Export</Button>
        </div>
        <p className="text-sm text-muted-foreground w-full md:w-auto md:text-right">{dateRangeLabel}</p>
      </PageHeader>
      <div className="mt-6">
        {isLoading ? (
             <div className="flex justify-center items-center h-40"><Loader2 className="animate-spin" /></div>
        ) : groupedLogs.length > 0 ? (
            <Accordion type="single" collapsible className="w-full space-y-4">
                {groupedLogs.map(({ session, logs }) => (
                    <SessionLogCard key={session.id} session={session} initialLogs={logs} />
                ))}
            </Accordion>
        ) : (
            <Card>
                <CardContent className="p-10 text-center text-muted-foreground">
                    No activity found for the selected date range.
                </CardContent>
            </Card>
        )}
      </div>
    </RoleGuard>
  );
}
