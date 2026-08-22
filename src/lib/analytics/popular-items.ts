import { isSyntheticAddonLine } from "./sold-items-core";

/**
 * What the table actually orders, counted as it is sold.
 *
 * Feeds the customer app's "Popular" group. Kept as a running tally on
 * `stores/{storeId}/catalogCache/popularItems` rather than computed on demand:
 * the alternative is scanning a date range of receipts on every menu load, and
 * the customer catalog cache is rebuilt only on menu EDITS, so anything folded
 * into that document would freeze until someone next touched the menu.
 *
 * Counts key on the INVENTORY DOC ID (`line.itemId`), which is what POS bill
 * lines and sold-items analytics already key on — NOT the productId. The
 * published catalog carries `inventoryId` on both entries and variants for
 * exactly this kind of join.
 *
 * Pure: the Firestore write lives in the analytics apply-delta route, which
 * applies these as atomic per-key increments inside the same transaction that
 * marks the receipt applied, so a retry cannot double-count.
 */

/** How many items the customer menu shows under Popular. */
export const POPULAR_DISPLAY_LIMIT = 10;

type ReceiptLine = {
  type?: string;
  itemId?: string;
  qtyOrdered?: unknown;
  voidedQty?: unknown;
  freeQty?: unknown;
};

type ReceiptLike = {
  lines?: ReceiptLine[] | null;
  isRefund?: boolean;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Per-item quantity change this receipt represents.
 *
 * `sign` is 1 when applying a receipt and -1 when reversing a voided one,
 * matching how the analytics delta route replays a contribution.
 *
 * Counts PHYSICAL quantity — ordered minus voided — so a comped dish still
 * counts. Popularity is a measure of demand, not of revenue: an item given
 * away was chosen just as deliberately as one paid for, and `billableQty`
 * would quietly erase exactly the items a store is pushing hardest.
 *
 * A refund receipt clones its lines with POSITIVE quantities and only negates
 * the total, so its quantities have to be subtracted explicitly — the same
 * trap `aggregateSoldItems` documents.
 */
export function popularityDeltaFromReceipt(
  receipt: ReceiptLike | null | undefined,
  sign: 1 | -1
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!receipt) return out;

  const direction = (receipt.isRefund === true ? -1 : 1) * sign;

  for (const line of receipt.lines ?? []) {
    if (!line || line.type !== "addon") continue;
    const itemId = String(line.itemId ?? "").trim();
    if (!itemId) continue;
    // "Griller charge" and friends are billing constructs, not menu items.
    if (isSyntheticAddonLine(itemId)) continue;

    const physicalQty = num(line.qtyOrdered) - num(line.voidedQty);
    if (physicalQty === 0) continue;

    out[itemId] = (out[itemId] ?? 0) + direction * physicalQty;
  }

  // A line that nets to zero is noise; writing it would grow the document
  // without ever changing an answer.
  for (const id of Object.keys(out)) {
    if (out[id] === 0) delete out[id];
  }

  return out;
}

/**
 * Combine two deltas into one.
 *
 * An edit is a reversal of the old receipt plus an application of the new one,
 * and both must land as a SINGLE write: two set-with-merge calls on the same
 * document inside one transaction do not compound their increments, so the
 * reversal would be lost and every edit would inflate the counts.
 *
 * Keys that cancel out are dropped rather than written as a zero increment.
 */
export function mergePopularityDeltas(
  a: Record<string, number>,
  b: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [id, n] of Object.entries(b)) out[id] = (out[id] ?? 0) + n;
  for (const id of Object.keys(out)) {
    if (out[id] === 0) delete out[id];
  }
  return out;
}

/**
 * The most-ordered item ids, highest first.
 *
 * Ties break on the id so the menu does not reshuffle between two reads of the
 * same data — a group whose order changes for no visible reason reads as a bug.
 * Items at zero or below are dropped: never ordered, or refunded back to
 * nothing, and neither is popular.
 */
export function topPopularIds(
  counts: Record<string, unknown> | null | undefined,
  limit: number = POPULAR_DISPLAY_LIMIT
): string[] {
  if (!counts || typeof counts !== "object") return [];

  return Object.entries(counts)
    .map(([id, raw]) => [id, Number(raw)] as const)
    .filter(([, n]) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([id]) => id);
}
