/**
 * Pure checkout / receipt math shared by the server financial commands
 * (audit P1). No Firestore and no "use client" imports, so route handlers and
 * unit tests can use it. Logic is transcribed from the pre-P1 client paths
 * (completePaymentFromUnits, EditReceiptDialog) so receipts written by the
 * server match the ones the client used to write field for field.
 */
import { roundMoney } from "@/lib/money";
import type { LineAdjustment, ReceiptAnalyticsV2, SessionBillLine } from "@/lib/types";

/** Formats a receipt number from a template ("SELIP-######") and a sequence. */
export function formatReceiptNumber(fmt: string, seq: number): string {
  const m = fmt.match(/#+/g);
  if (!m) return `${fmt}${seq}`;
  const run = m.sort((a, b) => b.length - a.length)[0];
  return fmt.replace(run, String(seq).padStart(run.length, "0"));
}

/**
 * Strict peso -> centavo conversion for tender amounts. Rejects anything that
 * is not a finite number with at most two decimals (no NaN / Infinity / 1e-9
 * dust / strings), so the server never rounds a forged amount into a valid one.
 */
export function strictCentavos(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const raw = amount * 100;
  const cents = Math.round(raw);
  if (Math.abs(raw - cents) > 1e-6) return null;
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export type MopMethod = { id: string; name?: string; type?: string };
export type TenderInput = { methodId?: string; amount?: number };

/**
 * Tender/change validation and the receipt's mode-of-payment map. Same rules as
 * the pre-P1 online checkout: underpayment beyond 1 centavo is refused; change
 * is only given from a cash tender and never exceeds it. Amounts in pesos.
 */
export function summarizeTenders(args: {
  payments: TenderInput[];
  paymentMethods: MopMethod[];
  amountDueCents: number;
}): { mopMap: Record<string, number>; totalPaid: number; change: number; totalPaidCents: number; changeCents: number } {
  const { payments, paymentMethods, amountDueCents } = args;
  const totalPaidCents = payments.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
  if (totalPaidCents < amountDueCents - 1) {
    throw new Error(
      `Cannot complete payment: balance is not zero. Paid: ₱${(totalPaidCents / 100).toFixed(2)}, Due: ₱${(amountDueCents / 100).toFixed(2)}`,
    );
  }
  const mopCentsMap: Record<string, number> = {};
  for (const payment of payments) {
    const method = paymentMethods.find((m) => m.id === payment.methodId);
    const key = method?.name || payment.methodId || "unknown";
    mopCentsMap[key] = (mopCentsMap[key] || 0) + Math.round(Number(payment.amount || 0) * 100);
  }
  const changeCents = Math.max(0, totalPaidCents - amountDueCents);
  if (changeCents > 1) {
    const cashMethod =
      paymentMethods.find((pm) => String(pm.type || "").toLowerCase() === "cash") ||
      paymentMethods.find((pm) => String(pm.name || "").toLowerCase().includes("cash"));
    let cashKey = cashMethod?.name;
    if (!cashKey) cashKey = Object.keys(mopCentsMap).find((k) => k.toLowerCase().includes("cash"));
    if (!cashKey || mopCentsMap[cashKey] == null) {
      throw new Error("Change exists but no Cash payment was included. Add Cash payment.");
    }
    if (mopCentsMap[cashKey] < changeCents) {
      throw new Error(
        `Invalid payment: change (₱${(changeCents / 100).toFixed(2)}) exceeds cash paid (₱${(mopCentsMap[cashKey] / 100).toFixed(2)}).`,
      );
    }
    mopCentsMap[cashKey] -= changeCents;
  }
  const mopMap: Record<string, number> = {};
  for (const [key, cents] of Object.entries(mopCentsMap)) mopMap[key] = cents / 100;
  return { mopMap, totalPaid: totalPaidCents / 100, change: changeCents / 100, totalPaidCents, changeCents };
}

type TaxStore = { taxType?: string | null; taxRatePct?: number | null };

/** Per-item / per-category net sales for receipt analytics (packages + add-ons). */
export function computeSalesAnalytics(
  billLines: SessionBillLine[],
  store: TaxStore,
): { salesByItem?: ReceiptAnalyticsV2["salesByItem"]; salesByCategory?: ReceiptAnalyticsV2["salesByCategory"] } {
  return billLines.reduce(
    (acc, line) => {
      if (line.type !== "package" && line.type !== "addon") return acc;
      const netQty = Math.max(0, line.qtyOrdered - (line.freeQty || 0) - (line.voidedQty || 0));
      if (netQty <= 0) return acc;
      const grossAmount = netQty * line.unitPrice;
      const discountBaseUnit =
        store.taxType === "VAT_INCLUSIVE" && store.taxRatePct && store.taxRatePct > 0
          ? line.unitPrice / (1 + store.taxRatePct / 100)
          : line.unitPrice;
      const adjs = Object.values((line as any).lineAdjustments ?? {}) as LineAdjustment[];
      const discountAdjs = adjs
        .filter((a) => a.kind === "discount")
        .sort((a, b) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0));
      let discountAmount = 0;
      if (discountAdjs.length > 0) {
        let remaining = netQty;
        for (const a of discountAdjs) {
          const q = Math.min(Number(a.qty || 0), remaining);
          if (q <= 0) continue;
          if (a.type === "percent") discountAmount += q * discountBaseUnit * (Number(a.value || 0) / 100);
          else discountAmount += Math.min(discountBaseUnit, Number(a.value || 0)) * q;
          remaining -= q;
          if (remaining <= 0) break;
        }
      } else {
        const discountQty = Math.min(line.discountQty || 0, netQty);
        if (discountQty > 0) {
          if (line.discountType === "percent") discountAmount = discountQty * discountBaseUnit * ((line.discountValue || 0) / 100);
          else discountAmount = Math.min(discountBaseUnit, line.discountValue ?? 0) * discountQty;
        }
      }
      const netAmount = roundMoney(grossAmount - discountAmount);
      const categoryName = (line as any).category || "Uncategorized";
      acc.salesByItem ??= {};
      acc.salesByCategory ??= {};
      if (!acc.salesByItem[line.itemName]) acc.salesByItem[line.itemName] = { qty: 0, amount: 0, categoryName };
      acc.salesByItem[line.itemName].qty += netQty;
      acc.salesByItem[line.itemName].amount += netAmount;
      if (!acc.salesByCategory[categoryName]) acc.salesByCategory[categoryName] = { qty: 0, amount: 0 };
      acc.salesByCategory[categoryName].qty += netQty;
      acc.salesByCategory[categoryName].amount += netAmount;
      return acc;
    },
    {} as { salesByItem?: ReceiptAnalyticsV2["salesByItem"]; salesByCategory?: ReceiptAnalyticsV2["salesByCategory"] },
  );
}

/** Package-cover snapshot for dine-in receipts (rule MAX, bundles bill flat units). */
export function computeGuestCountSnapshot(
  sessionData: Record<string, any>,
  billLines: SessionBillLine[],
  nowMs: number,
): ReceiptAnalyticsV2["guestCountSnapshot"] | undefined {
  if (sessionData.sessionMode !== "package_dinein") return undefined;
  const cashierInitial = sessionData.guestCountCashierInitial ?? 0;
  const serverVerified = sessionData.guestCountServerVerified ?? 0;
  const finalGuestCount = sessionData.guestCountFinal ?? Math.max(cashierInitial, serverVerified);
  const pkgLine = billLines.find((l) => l.type === "package");
  const billableUnits = Math.max(0, (pkgLine?.qtyOrdered ?? 0) - (pkgLine?.voidedQty ?? 0) - (pkgLine?.freeQty ?? 0));
  const isBundle = !!sessionData.packageSnapshot?.isBundle;
  const billedPackageCovers = isBundle ? finalGuestCount : billableUnits;
  return {
    packageOfferingId: sessionData.packageOfferingId ?? null,
    packageName: sessionData.packageSnapshot?.name ?? pkgLine?.itemName ?? null,
    finalGuestCount,
    billedPackageCovers,
    discrepancy: billedPackageCovers - finalGuestCount,
    computedAtClientMs: nowMs,
    rule: "MAX",
    ...(isBundle ? { isBundle: true, billedUnits: billableUnits } : {}),
  } as ReceiptAnalyticsV2["guestCountSnapshot"];
}

export type SettleTender = { id?: string; methodId: string; amount: number; [k: string]: unknown };

/**
 * Settles a correction's tenders down to `targetTotal`, refunding any excess
 * (cash first). Same as the pre-P1 EditReceiptDialog helper.
 */
export function settleTendersToTotal<T extends SettleTender>(
  payments: T[],
  targetTotal: number,
  paymentMethods: MopMethod[],
): { settled: T[]; refund: number } {
  const targetCents = Math.round(targetTotal * 100);
  const totalCents = payments.reduce((s, p) => s + Math.round((p.amount || 0) * 100), 0);
  if (totalCents <= targetCents) return { settled: payments, refund: 0 };
  const cashIds = new Set(
    paymentMethods
      .filter((pm) => String(pm.type || "").toLowerCase() === "cash" || String(pm.name || "").toLowerCase().includes("cash"))
      .map((pm) => pm.id),
  );
  const keyed = payments.map((p, i) => ({ p, k: String(p.id ?? i) }));
  const drainOrder = [...keyed].sort((a, b) => (cashIds.has(b.p.methodId) ? 1 : 0) - (cashIds.has(a.p.methodId) ? 1 : 0));
  const remaining = new Map<string, number>(keyed.map(({ p, k }) => [k, Math.round((p.amount || 0) * 100)]));
  let toRefund = totalCents - targetCents;
  for (const { k } of drainOrder) {
    if (toRefund <= 0) break;
    const cur = remaining.get(k) || 0;
    const cut = Math.min(cur, toRefund);
    remaining.set(k, cur - cut);
    toRefund -= cut;
  }
  const settled = keyed
    .map(({ p, k }) => ({ ...p, amount: (remaining.get(k) || 0) / 100 }))
    .filter((p) => p.amount > 0);
  return { settled, refund: (totalCents - targetCents) / 100 };
}

/** Removes `undefined` recursively (Firestore rejects it). Server-safe copy. */
export function dropUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.filter((x) => x !== undefined).map((x) => dropUndefined(x)) as T;
  if (typeof obj !== "object" || obj instanceof Date) return obj;
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return obj; // Timestamps, sentinels
  const out: any = {};
  for (const [k, v] of Object.entries(obj as any)) if (v !== undefined) out[k] = dropUndefined(v);
  return out;
}
