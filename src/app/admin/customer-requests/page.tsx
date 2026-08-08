"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Download, Loader, MessageCircle, Search, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { exportToXlsx } from "@/lib/export/export-xlsx-client";

type CustomerRequest = {
  id: string;
  text: string;
  tableNumber?: string | null;
  tableDisplayName?: string | null;
  customerName?: string | null;
  status: "pending" | "done";
  createdAtClientMs: number;
  doneAtClientMs?: number | null;
  doneAt?: any;
  doneByUsername?: string | null;
  doneByProfileName?: string | null;
};

type Preset = "today" | "7d" | "30d" | "all";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All" },
];

function startMsFor(preset: Preset): number | null {
  const now = new Date();
  if (preset === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (preset === "7d") return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (preset === "30d") return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return null; // all
}

function tsToMs(input: any): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input.toMillis === "function") return input.toMillis();
  if (typeof input.seconds === "number") return input.seconds * 1000;
  return null;
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function CustomerRequestsAnalysisPage() {
  const router = useRouter();
  const { activeStore, loading: storeLoading } = useStoreContext();
  const { toast } = useToast();

  const [preset, setPreset] = useState<Preset>("30d");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "done">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 250);

  const [rows, setRows] = useState<CustomerRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!activeStore?.id) return;
    setIsLoading(true);
    (async () => {
      try {
        const ref = collection(db, "stores", activeStore.id, "customerRequests");
        const startMs = startMsFor(preset);
        const q = startMs == null
          ? query(ref, orderBy("createdAtClientMs", "desc"), limit(1000))
          : query(ref, where("createdAtClientMs", ">=", startMs), orderBy("createdAtClientMs", "desc"), limit(1000));
        const snap = await getDocs(q);
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as CustomerRequest[]);
      } catch (e: any) {
        toast({ variant: "destructive", title: "Failed to load requests", description: e?.message });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [activeStore?.id, preset, toast]);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    if (debouncedSearch) {
      const s = debouncedSearch.toLowerCase();
      r = r.filter(
        (x) =>
          (x.text || "").toLowerCase().includes(s) ||
          (x.customerName || "").toLowerCase().includes(s) ||
          (x.tableDisplayName || "").toLowerCase().includes(s) ||
          (x.tableNumber || "").toLowerCase().includes(s),
      );
    }
    return r;
  }, [rows, statusFilter, debouncedSearch]);

  const stats = useMemo(() => {
    const total = rows.length;
    const done = rows.filter((r) => r.status === "done");
    const pending = total - done.length;
    let sum = 0;
    let counted = 0;
    for (const r of done) {
      const doneMs = r.doneAtClientMs ?? tsToMs(r.doneAt);
      if (doneMs != null) {
        sum += Math.max(0, doneMs - r.createdAtClientMs);
        counted += 1;
      }
    }
    const avgMs = counted > 0 ? sum / counted : null;
    return { total, done: done.length, pending, avgMs };
  }, [rows]);

  const handleExport = () => {
    if (filtered.length === 0) {
      toast({ variant: "destructive", title: "Nothing to export" });
      return;
    }
    exportToXlsx({
      rows: filtered.map((r) => {
        const doneMs = r.doneAtClientMs ?? tsToMs(r.doneAt);
        return {
          "Time": fmtDateTime(r.createdAtClientMs),
          "Table / Customer": r.tableDisplayName || (r.tableNumber ? `Table ${r.tableNumber}` : "") || r.customerName || "",
          "Request": r.text,
          "Status": r.status,
          "Done by": r.doneByProfileName || r.doneByUsername || "",
          "Response time": r.status === "done" && doneMs != null ? fmtDuration(doneMs - r.createdAtClientMs) : "",
        };
      }),
      sheetName: "Customer Requests",
      filename: `customer_requests_${activeStore?.code ?? "store"}.xlsx`,
    });
  };

  if (storeLoading) {
    return <div className="flex items-center justify-center h-full"><Loader className="animate-spin" /></div>;
  }
  if (!activeStore) {
    return (
      <Card className="w-full max-w-md mx-auto text-center">
        <CardHeader>
          <CardTitle>No Store Selected</CardTitle>
          <CardDescription>Please select a store from the header to view customer requests.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Customer Requests" description={`Requests sent from the floor at ${activeStore.name}`}>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreset((p) => p)} disabled={isLoading} title="Refresh">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total requests" value={String(stats.total)} />
        <StatCard label="Pending" value={String(stats.pending)} />
        <StatCard label="Completed" value={String(stats.done)} />
        <StatCard label="Avg response" value={stats.avgMs != null ? fmtDuration(stats.avgMs) : "—"} sub="created → done" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1 rounded-md bg-muted p-1 flex-wrap">
              {PRESETS.map((p) => (
                <Button key={p.value} variant={preset === p.value ? "default" : "ghost"} size="sm" className="h-8" onClick={() => setPreset(p.value)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                {(["all", "pending", "done"] as const).map((s) => (
                  <Button key={s} variant={statusFilter === s ? "default" : "ghost"} size="sm" className="h-8 capitalize" onClick={() => setStatusFilter(s)}>
                    {s}
                  </Button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search requests…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 w-full sm:w-56" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-12"><Loader className="animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No customer requests in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Table / Customer</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Done by</TableHead>
                    <TableHead className="text-right">Response</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const doneMs = r.doneAtClientMs ?? tsToMs(r.doneAt);
                    const responseMs = r.status === "done" && doneMs != null ? Math.max(0, doneMs - r.createdAtClientMs) : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAtClientMs)}</TableCell>
                        <TableCell className="text-xs">
                          {r.tableDisplayName || (r.tableNumber ? `Table ${r.tableNumber}` : "—")}
                          {r.customerName ? <span className="text-muted-foreground"> · {r.customerName}</span> : null}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <span className="line-clamp-2">{r.text}</span>
                        </TableCell>
                        <TableCell>
                          {r.status === "done" ? (
                            <Badge variant="outline" className="border-emerald-400 bg-emerald-50 text-emerald-600 text-[10px]">Done</Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-600 text-[10px]">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.doneByProfileName || r.doneByUsername || "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {responseMs != null ? fmtDuration(responseMs) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </RoleGuard>
  );
}
