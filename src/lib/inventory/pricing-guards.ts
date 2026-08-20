/**
 * Pricing sanity checks for a store's inventory row.
 *
 * Shared by the inline table edit and the edit dialog, because a rule enforced
 * in only one of them is not enforced at all — the table is the fast path
 * managers actually use.
 *
 * Two different strengths, on purpose:
 *
 *   BLOCK  selling below cost. That is a pricing decision, and a manager
 *          setting it is almost always a typo (a transposed 15/51).
 *   WARN   everything else. A cost that rises above the selling price is a
 *          FACT — the supplier put their price up — and refusing to record it
 *          would just mean the cost stays wrong in the system. Same for an
 *          aggressive online discount, which may be a deliberate promo.
 */

/** How far the online price may sit under the store price before it is flagged. */
export const ONLINE_UNDERCUT_THRESHOLD = 0.15;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when a selling price would be set below a known cost.
 *
 * A cost of 0 means "not set up yet", not "free", so it never blocks —
 * otherwise every un-costed item would be unpriceable.
 */
export function sellsBelowCost(cost: unknown, sellingPrice: unknown): boolean {
  const c = num(cost);
  const s = num(sellingPrice);
  return c > 0 && s > 0 && s < c;
}

/**
 * True when the online price undercuts the store price by more than the
 * threshold.
 *
 * NOTE there is no customer-app equivalent: `rebuildCustomerCatalog` always
 * charges `sellingPrice`, so the customer app's price IS the store price and
 * cannot diverge from it. `onlinePrice` is the only per-channel override that
 * exists.
 *
 * An unset online price means "match the store price" and is never flagged; an
 * online price of 0 means WITHHELD (the item stays off the storefront) and is
 * already surfaced separately, so it is not an undercut either.
 */
export function onlineUndercutsStore(sellingPrice: unknown, onlinePrice: unknown): boolean {
  if (onlinePrice === null || onlinePrice === undefined || onlinePrice === "") return false;
  const store = num(sellingPrice);
  const online = num(onlinePrice);
  if (store <= 0 || online <= 0) return false;
  return online < store * (1 - ONLINE_UNDERCUT_THRESHOLD);
}

/** How far under, as a whole percent — for the warning copy. */
export function undercutPercent(sellingPrice: unknown, onlinePrice: unknown): number {
  const store = num(sellingPrice);
  const online = num(onlinePrice);
  if (store <= 0) return 0;
  return Math.round(((store - online) / store) * 100);
}

export type PricingWarning = { kind: "below_cost" | "online_undercut"; message: string };

/**
 * Everything wrong with one row's pricing, for the red-row treatment.
 * Empty when the row is fine.
 */
export function pricingWarnings(item: {
  cost?: unknown;
  sellingPrice?: unknown;
  onlinePrice?: unknown;
  onlineEnabled?: boolean;
}): PricingWarning[] {
  const out: PricingWarning[] = [];

  if (sellsBelowCost(item.cost, item.sellingPrice)) {
    out.push({
      kind: "below_cost",
      message: `Store price ₱${num(item.sellingPrice)} is below cost ₱${num(item.cost)} — this item sells at a loss.`,
    });
  }

  // Only meaningful while the item is actually offered online.
  if (item.onlineEnabled === true && onlineUndercutsStore(item.sellingPrice, item.onlinePrice)) {
    out.push({
      kind: "online_undercut",
      message: `Online price is ${undercutPercent(item.sellingPrice, item.onlinePrice)}% below the store price.`,
    });
  }

  return out;
}
