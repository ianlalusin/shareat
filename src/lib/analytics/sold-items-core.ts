// Pure per-item sold-quantity aggregation over a day's receipts, for the ERP's
// inventory-usage pull (GET /api/external/sold-items).
//
// Deliberately NOT derived from the pre-aggregated `analytics/{dayId}` day doc,
// even though that doc already carries `sales.addonSalesByItem`. Three reasons:
//   1. the day doc is keyed by display NAME (and safeKey-mangled: "."→"·",
//      "/"→"∕"), so a rename silently breaks any downstream mapping — whereas
//      `line.itemId` is the stable `stores/{storeId}/inventory/{id}` doc id;
//   2. historical day docs written before refunds were signed in
//      `getSalesContribution` over-count refunds (a refund receipt carries
//      positive-qty clones of the original lines — see createRefundReceipt);
//   3. it folds `freeQty` away irrecoverably, but a comped item still physically
//      left stock, so the ERP needs that number separately.
//
// No Firestore imports here — the route does the reads and passes plain objects
// in, so this stays unit-testable (same split as delta-core.ts).

/** Structural subset of `Receipt` this module actually reads — lets tests build
 *  fixtures without constructing a full Receipt (Timestamps, analytics, …). */
export interface ReceiptLineLite {
  type?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  category?: string | null;
  barcode?: string | null;
  unitPrice?: number | null;
  modifiersTotal?: number | null;
  qtyOrdered?: number | null;
  freeQty?: number | null;
  voidedQty?: number | null;
}

export interface ReceiptLite {
  status?: string | null;
  isVoided?: boolean | null;
  isRefund?: boolean | null;
  lines?: ReceiptLineLite[] | null;
}

export interface SoldItemAgg {
  /** stores/{storeId}/inventory/{id} — the stable mapping key. */
  posItemId: string;
  /** Last-seen line snapshot name; the route prefers the inventory master name. */
  itemName: string;
  category: string | null;
  barcode: string | null;
  /** qtyOrdered − voidedQty − freeQty. What was CHARGED for. Refund-netted. */
  billableQty: number;
  /** qtyOrdered − voidedQty. What physically LEFT STOCK (billable + comped). Refund-netted. */
  physicalQty: number;
  /** Comped/free units — physically consumed but not charged. Refund-netted. */
  freeQty: number;
  /** Line-voided units — never left stock. Refund-netted. */
  voidedQty: number;
  /** billableQty × (unitPrice + modifiersTotal), refund-netted, before
   *  discounts. Display/sanity-check only. Same per-unit price as analytics. */
  grossAmount: number;
}

export interface SoldItemsAggResult {
  items: SoldItemAgg[];
  receiptCount: number;
  refundReceiptCount: number;
  voidedReceiptCount: number;
  skippedSyntheticLines: number;
}

import { lineUnitGross } from '@/lib/analytics/line-amounts';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Mirrors daily.ts's isVoidReceipt — `status` is current, `isVoided` is legacy. */
function isVoidReceipt(r: ReceiptLite): boolean {
  return r.status === 'voided' || r.isVoided === true;
}

/**
 * Addon lines POS synthesizes for non-product concepts. They carry an `itemId`
 * that resolves to no inventory doc, so they must never reach the ERP mapping:
 *   - `__delivery`            — the delivery fee on an online order
 *   - `bundleextra_{pkgId}`   — an extra-pax charge on a bundle package
 */
export function isSyntheticAddonLine(itemId: string): boolean {
  return itemId === '__delivery' || /^bundleextra_/.test(itemId);
}

/**
 * Folds a day's receipts into per-item quantities keyed by POS inventory id.
 *
 * Refunds are netted (a refund receipt's positive-qty line clones are
 * subtracted), voided receipts are skipped entirely, and only `type:'addon'`
 * lines are considered — packages are unli/dine-in covers with no 1:1 stock
 * counterpart and are explicitly out of scope for the ERP usage pull.
 */
export function aggregateSoldItems(receipts: ReceiptLite[]): SoldItemsAggResult {
  const byId = new Map<string, SoldItemAgg>();
  let receiptCount = 0;
  let refundReceiptCount = 0;
  let voidedReceiptCount = 0;
  let skippedSyntheticLines = 0;

  for (const r of receipts) {
    if (!r) continue;
    if (isVoidReceipt(r)) { voidedReceiptCount++; continue; }

    // A refund receipt clones the original lines with POSITIVE qty and only
    // negates `total` — so its quantities must be subtracted explicitly.
    const isRefund = r.isRefund === true;
    const sign = isRefund ? -1 : 1;
    if (isRefund) refundReceiptCount++;
    receiptCount++;

    for (const line of r.lines ?? []) {
      if (!line || line.type !== 'addon') continue;
      const itemId = String(line.itemId ?? '').trim();
      if (!itemId) continue;
      if (isSyntheticAddonLine(itemId)) { skippedSyntheticLines++; continue; }

      const qtyOrdered = num(line.qtyOrdered);
      const voidedQty = num(line.voidedQty);
      const freeQty = num(line.freeQty);
      const billableQty = qtyOrdered - voidedQty - freeQty;
      const physicalQty = qtyOrdered - voidedQty;

      let agg = byId.get(itemId);
      if (!agg) {
        agg = {
          posItemId: itemId, itemName: '', category: null, barcode: null,
          billableQty: 0, physicalQty: 0, freeQty: 0, voidedQty: 0, grossAmount: 0,
        };
        byId.set(itemId, agg);
      }

      agg.billableQty += sign * billableQty;
      agg.physicalQty += sign * physicalQty;
      agg.freeQty += sign * freeQty;
      agg.voidedQty += sign * voidedQty;
      agg.grossAmount += sign * billableQty * lineUnitGross(line);

      // Keep the last non-empty descriptor seen — a later receipt reflects a
      // more recent rename than an earlier one.
      const name = String(line.itemName ?? '').trim();
      if (name) agg.itemName = name;
      const category = String(line.category ?? '').trim();
      if (category) agg.category = category;
      const barcode = String(line.barcode ?? '').trim();
      if (barcode) agg.barcode = barcode;
    }
  }

  // An item whose sales were fully refunded/voided nets to nothing — drop it
  // rather than emit a zero row the ERP would have to filter anyway.
  const items = [...byId.values()]
    .filter((a) => a.billableQty !== 0 || a.physicalQty !== 0)
    .sort((a, b) => a.posItemId.localeCompare(b.posItemId));

  return { items, receiptCount, refundReceiptCount, voidedReceiptCount, skippedSyntheticLines };
}
