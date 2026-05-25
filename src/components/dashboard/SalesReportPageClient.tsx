"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useReceiptSettings } from "@/hooks/use-receipt-settings";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Printer, ArrowLeft, CalendarIcon } from "lucide-react";
import { format, parse, startOfMonth, endOfMonth, addDays } from "date-fns";
import { startOfDay } from "@/lib/utils/date";

import type { DailyMetric, ModeOfPayment } from "@/lib/types";
import {
  formatSalesReportText,
  type SalesReportData,
} from "@/lib/printing/salesReportFormatter";
import {
  isNativeBluetoothAvailable,
  getLastPrinterAddress,
  printViaNativeBluetooth,
} from "@/lib/printing/printHub";
import { getReceiptSettings } from "@/lib/receipts/receipt-settings";

function aggregateMetrics(metrics: DailyMetric[]) {
  const byMethod: Record<string, number> = {};
  let totalGross = 0;
  let txCount = 0;
  let discountsTotal = 0;
  let chargesTotal = 0;
  let voidedQty = 0;
  let voidedAmount = 0;
  let freeQty = 0;
  let freeAmount = 0;
  let discountedQty = 0;
  let discountedAmount = 0;
  let refundCount = 0;
  let refundTotal = 0;
  const addonSalesByItem: Record<string, { qty: number; amount: number; categoryName: string }> = {};

  for (const m of metrics) {
    totalGross += m.payments?.totalGross ?? 0;
    txCount += m.payments?.txCount ?? 0;
    discountsTotal += m.payments?.discountsTotal ?? 0;
    chargesTotal += m.payments?.chargesTotal ?? 0;

    const methods = m.payments?.byMethod ?? {};
    for (const [method, amount] of Object.entries(methods)) {
      byMethod[method] = (byMethod[method] ?? 0) + amount;
    }

    const items = (m as any).items;
    if (items) {
      voidedQty += items.voidedQty ?? 0;
      voidedAmount += items.voidedAmount ?? 0;
      freeQty += items.freeQty ?? 0;
      freeAmount += items.freeAmount ?? 0;
      discountedQty += items.discountedQty ?? 0;
      discountedAmount += items.discountedAmount ?? 0;
      refundCount += items.refundCount ?? 0;
      refundTotal += items.refundTotal ?? 0;
    }

    const addons = (m.sales as any)?.addonSalesByItem ?? {};
    for (const [name, data] of Object.entries(addons as Record<string, any>)) {
      if (!addonSalesByItem[name]) {
        addonSalesByItem[name] = { qty: 0, amount: 0, categoryName: data.categoryName ?? "Uncategorized" };
      }
      addonSalesByItem[name].qty += data.qty ?? 0;
      addonSalesByItem[name].amount += data.amount ?? 0;
    }
  }

  return {
    totalGross,
    txCount,
    byMethod,
    discountsTotal,
    chargesTotal,
    voidedQty,
    voidedAmount,
    freeQty,
    freeAmount,
    discountedQty,
    discountedAmount,
    refundCount,
    refundTotal,
    addonSalesByItem,
  };
}

function classifyRemittance(
  byMethod: Record<string, number>,
  mopList: ModeOfPayment[]
): { cashRemitted: number; onlineRemitted: number } {
  const typeMap: Record<string, string> = {};
  for (const mop of mopList) {
    typeMap[mop.name] = mop.type;
  }

  let cashRemitted = 0;
  let onlineRemitted = 0;

  for (const [name, amount] of Object.entries(byMethod)) {
    const mopType = typeMap[name] ?? (name.toLowerCase().includes("cash") ? "cash" : "online");
    if (mopType === "cash") {
      cashRemitted += amount;
    } else {
      onlineRemitted += amount;
    }
  }

  return { cashRemitted, onlineRemitted };
}

const peso = (n: number) =>
  `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, sub, strong, muted }: { label: string; value: string; sub?: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className={`text-sm ${muted ? "text-muted-foreground" : ""}`}>
        {label}
        {sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
      </div>
      <div className={`tabular-nums ${strong ? "text-base font-semibold" : "text-sm"}`}>{value}</div>
    </div>
  );
}

export default function SalesReportPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const storeId = activeStore?.id ?? null;
  const { settings: receiptSettings, isLoading: settingsLoading } = useReceiptSettings(storeId);
  const { toast } = useToast();

  // Seed from URL params (so the dashboard "Print Sales Report" deep-link still works),
  // then drive everything from in-page controls.
  const [reportType, setReportType] = useState<"daily" | "monthly">(
    searchParams?.get("type") === "monthly" ? "monthly" : "daily"
  );
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = searchParams?.get("date");
    return d ? parse(d, "yyyy-MM-dd", new Date()) : new Date();
  });
  const [selectedMonth, setSelectedMonth] = useState<string>(
    searchParams?.get("month") ?? format(new Date(), "yyyy-MM")
  );
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(
    searchParams?.get("width") === "58mm" ? "58mm" : "80mm"
  );
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push({ value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") });
    }
    return options;
  }, []);

  // Fetch ModeOfPayment list (for cash vs online remittance classification).
  useEffect(() => {
    if (!storeId) return;
    const mopRef = collection(db, "stores", storeId, "storeModesOfPayment");
    const mopQuery = query(mopRef, where("isArchived", "==", false), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(mopQuery, (snap) => {
      setPaymentMethods(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ModeOfPayment)));
    });
    return () => unsub();
  }, [storeId]);

  // Fetch DailyMetric data for the selected day / month.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    setIsLoading(true);

    async function fetchData() {
      if (!storeId) return;

      if (reportType === "daily") {
        const dayId = format(selectedDate, "yyyyMMdd");
        const docRef = doc(db, "stores", storeId, "analytics", dayId);
        const snap = await getDoc(docRef);
        if (!cancelled) {
          setDailyMetrics(snap.exists() ? [snap.data() as DailyMetric] : []);
        }
      } else {
        const monthDate = parse(selectedMonth, "yyyy-MM", new Date());
        const monthStart = startOfMonth(monthDate);
        const monthEnd = addDays(endOfMonth(monthDate), 1);
        const q = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", startOfDay(monthStart).getTime()),
          where("meta.dayStartMs", "<", startOfDay(monthEnd).getTime())
        );
        const snap = await getDocs(q);
        if (!cancelled) {
          setDailyMetrics(snap.docs.map((d) => d.data() as DailyMetric));
        }
      }
    }

    fetchData().finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [storeId, reportType, selectedDate, selectedMonth]);

  const reportData = useMemo<SalesReportData | null>(() => {
    if (!activeStore) return null;

    const agg = aggregateMetrics(dailyMetrics);
    const { cashRemitted, onlineRemitted } = classifyRemittance(agg.byMethod, paymentMethods);

    const dateLabel =
      reportType === "daily"
        ? format(selectedDate, "MMMM d, yyyy")
        : format(parse(selectedMonth, "yyyy-MM", new Date()), "MMMM yyyy");

    return {
      storeName: receiptSettings?.businessName ?? activeStore.name ?? "",
      branchName: receiptSettings?.branchName,
      address: receiptSettings?.address,
      reportType,
      dateLabel,
      generatedAt: new Date(),
      generatedBy: appUser?.displayName ?? appUser?.email ?? undefined,
      ...agg,
      cashRemitted,
      onlineRemitted,
    };
  }, [activeStore, dailyMetrics, paymentMethods, reportType, selectedDate, selectedMonth, receiptSettings, appUser]);

  const formattedText = useMemo(() => {
    if (!reportData) return "";
    const w: 58 | 80 = paperWidth === "58mm" ? 58 : 80;
    return formatSalesReportText(reportData, w);
  }, [reportData, paperWidth]);

  const handlePrint = useCallback(async () => {
    if (!reportData || isPrinting) return;
    setIsPrinting(true);

    try {
      if (isNativeBluetoothAvailable()) {
        const lastAddress = getLastPrinterAddress();
        if (!lastAddress) {
          toast({
            variant: "destructive",
            title: "No Printer",
            description: "Go to Manager Tools → Printer Setup to connect a printer.",
          });
          return;
        }
        const liveSettings = storeId ? await getReceiptSettings(db, storeId) : null;
        const w: 58 | 80 = (liveSettings?.paperWidth ?? paperWidth) === "58mm" ? 58 : 80;
        const text = formatSalesReportText(reportData, w);
        await printViaNativeBluetooth({
          target: "receipt",
          text,
          widthMm: w,
          cut: true,
          beep: true,
          encoding: "CP437",
          showLogo: liveSettings?.showLogo ?? false,
          storeId,
        });
        toast({ title: "Printed", description: "Sales report sent to thermal printer." });
      } else {
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r()))
        );
        window.print();
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Print Failed",
        description: e?.message ?? "Unknown print error",
      });
    } finally {
      setIsPrinting(false);
    }
  }, [reportData, isPrinting, storeId, paperWidth, toast]);

  const agg = reportData;
  const sortedMethods = useMemo(
    () => (agg ? Object.entries(agg.byMethod).sort(([, a], [, b]) => b - a) : []),
    [agg]
  );
  const sortedAddons = useMemo(
    () => (agg ? Object.entries(agg.addonSalesByItem).sort(([, a], [, b]) => b.amount - a.amount) : []),
    [agg]
  );
  const hasData = !!agg && agg.txCount > 0;

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <PageHeader title="Sales Report" description="Daily and monthly sales summary for printing and cash-up.">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </PageHeader>

      {/* Controls */}
      <Card className="mb-4 no-print">
        <CardContent className="p-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label>Report Type</Label>
              <div className="flex gap-2">
                <Button variant={reportType === "daily" ? "default" : "outline"} size="sm" onClick={() => setReportType("daily")}>Daily</Button>
                <Button variant={reportType === "monthly" ? "default" : "outline"} size="sm" onClick={() => setReportType("monthly")}>Monthly</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{reportType === "daily" ? "Date" : "Month"}</Label>
              {reportType === "daily" ? (
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[200px] justify-start text-left font-normal h-9">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(selectedDate, "MMMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => { if (date) { setSelectedDate(date); setCalendarOpen(false); } }}
                      disabled={(date) => date > new Date()}
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label>Paper</Label>
              <Select value={paperWidth} onValueChange={(v) => setPaperWidth(v as "58mm" | "80mm")}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58mm Thermal</SelectItem>
                  <SelectItem value="80mm">80mm Thermal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handlePrint} disabled={!hasData || isPrinting}>
              {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              Print
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Readable on-screen report */}
      <div className="no-print max-w-3xl">
        {isLoading || settingsLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground" /></div>
        ) : !hasData || !agg ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              No sales recorded for {agg?.dateLabel ?? "this period"}.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 text-sm text-muted-foreground">
              {agg.storeName} · {agg.reportType === "daily" ? "Daily" : "Monthly"} report — <span className="font-medium text-foreground">{agg.dateLabel}</span>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Total Sales</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <Row label="Gross Sales" value={peso(agg.totalGross)} strong />
                <Row label="Transactions" value={agg.txCount.toLocaleString("en-US")} />
                <Row label="Avg / Transaction" value={peso(agg.txCount > 0 ? agg.totalGross / agg.txCount : 0)} muted />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Remittance</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <Row label="Cash" value={peso(agg.cashRemitted)} />
                <Row label="Online / Non-cash" value={peso(agg.onlineRemitted)} />
                <div className="border-t mt-1 pt-1"><Row label="Total Collected" value={peso(agg.cashRemitted + agg.onlineRemitted)} strong /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Mode of Payment</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {sortedMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No payments.</p>
                ) : (
                  <>
                    {sortedMethods.map(([method, amount]) => (
                      <Row key={method} label={method} value={peso(amount)} />
                    ))}
                    <div className="border-t mt-1 pt-1"><Row label="Total" value={peso(agg.totalGross)} strong /></div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Discounts, Charges & Adjustments</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <Row label="Discounts" value={agg.discountsTotal > 0 ? `(${peso(agg.discountsTotal)})` : peso(0)} />
                <Row label="Charges" value={agg.chargesTotal > 0 ? `+${peso(agg.chargesTotal)}` : peso(0)} />
                <div className="border-t mt-1 pt-1">
                  <Row label="Discounted items" value={peso(agg.discountedAmount)} sub={`${agg.discountedQty} pcs`} />
                  <Row label="Voided items" value={peso(agg.voidedAmount)} sub={`${agg.voidedQty} pcs`} />
                  <Row label="Free items" value={peso(agg.freeAmount)} sub={`${agg.freeQty} pcs`} />
                  <Row label="Refunds" value={peso(agg.refundTotal)} sub={`${agg.refundCount} txn`} />
                </div>
              </CardContent>
            </Card>

            {sortedAddons.length > 0 && (
              <Card className="md:col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-base">Items Sold Breakdown</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-1 mb-1">
                    <span>Item</span>
                    <span className="flex gap-8"><span className="w-12 text-right">Qty</span><span className="w-24 text-right">Amount</span></span>
                  </div>
                  {sortedAddons.map(([name, info]) => (
                    <div key={name} className="flex items-center justify-between py-1 text-sm">
                      <span className="truncate pr-2">{name}</span>
                      <span className="flex gap-8 tabular-nums">
                        <span className="w-12 text-right">{info.qty.toLocaleString("en-US")}</span>
                        <span className="w-24 text-right">{peso(info.amount)}</span>
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Thermal print preview — hidden on screen, printed by window.print() (see @media print in globals.css). */}
      <div id="receipt-print-root" data-paper={paperWidth} className="hidden">
        <div id="print-receipt-area" style={{ background: "#fff", padding: "12px 8px", width: "fit-content" }}>
          <pre
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: paperWidth === "58mm" ? "10px" : "11px",
              lineHeight: 1.5,
              whiteSpace: "pre",
              margin: 0,
              padding: 0,
              background: "transparent",
              color: "#000",
            }}
          >
            {formattedText}
          </pre>
        </div>
      </div>
    </RoleGuard>
  );
}
