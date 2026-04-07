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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
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

export default function SalesReportPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const storeId = activeStore?.id ?? null;
  const { settings: receiptSettings, isLoading: settingsLoading } = useReceiptSettings(storeId);
  const { toast } = useToast();

  const reportType = (searchParams?.get("type") ?? "daily") as "daily" | "monthly";
  const dateParam = searchParams?.get("date");
  const monthParam = searchParams?.get("month");
  const widthParam = searchParams?.get("width");

  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(
    widthParam === "58mm" ? "58mm" : widthParam === "80mm" ? "80mm" : "80mm"
  );
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);

  // Fetch ModeOfPayment list
  useEffect(() => {
    if (!storeId) return;
    const mopRef = collection(db, "stores", storeId, "storeModesOfPayment");
    const mopQuery = query(mopRef, where("isArchived", "==", false), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(mopQuery, (snap) => {
      setPaymentMethods(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ModeOfPayment)));
    });
    return () => unsub();
  }, [storeId]);

  // Fetch DailyMetric data
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    setIsLoading(true);

    async function fetchData() {
      if (!storeId) return;

      if (reportType === "daily" && dateParam) {
        // Single day: fetch analytics/{YYYYMMDD}
        const dayId = dateParam.replace(/-/g, "");
        const docRef = doc(db, "stores", storeId, "analytics", dayId);
        const snap = await getDoc(docRef);
        if (!cancelled) {
          setDailyMetrics(snap.exists() ? [snap.data() as DailyMetric] : []);
        }
      } else if (reportType === "monthly" && monthParam) {
        // Month range: query analytics where dayStartMs in month
        const monthDate = parse(monthParam, "yyyy-MM", new Date());
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
  }, [storeId, reportType, dateParam, monthParam]);

  // Build report data
  const reportData = useMemo<SalesReportData | null>(() => {
    if (!activeStore || isLoading) return null;

    const agg = aggregateMetrics(dailyMetrics);
    const { cashRemitted, onlineRemitted } = classifyRemittance(agg.byMethod, paymentMethods);

    let dateLabel = "";
    if (reportType === "daily" && dateParam) {
      dateLabel = format(parse(dateParam, "yyyy-MM-dd", new Date()), "MMMM d, yyyy");
    } else if (reportType === "monthly" && monthParam) {
      dateLabel = format(parse(monthParam, "yyyy-MM", new Date()), "MMMM yyyy");
    }

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
  }, [activeStore, dailyMetrics, paymentMethods, isLoading, reportType, dateParam, monthParam, receiptSettings, appUser]);

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

  if (isLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin h-10 w-10" />
      </div>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <div className="flex flex-col items-center py-8 min-h-screen print:py-0 print:items-start print:block">
        {/* Controls (hidden when printing) */}
        <div className="w-full max-w-lg mb-4 space-y-4 no-print px-4">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Select value={paperWidth} onValueChange={(v) => setPaperWidth(v as "58mm" | "80mm")}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58mm Thermal</SelectItem>
                  <SelectItem value="80mm">80mm Thermal</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handlePrint} disabled={!reportData || isPrinting}>
                {isPrinting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-2 h-4 w-4" />
                )}
                Print
              </Button>
            </div>
          </div>
        </div>

        {/* Report Preview */}
        <div
          id="receipt-print-root"
          data-paper={paperWidth}
          className="w-full flex justify-center px-4"
        >
          <div
            id="print-receipt-area"
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              padding: "12px 8px",
              width: "fit-content",
            }}
          >
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
      </div>
    </RoleGuard>
  );
}
