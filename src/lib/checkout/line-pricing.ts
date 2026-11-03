/**
 * Bill-line price validation for the server checkout (audit P1 follow-up, B01:
 * "kitchen/server clients can alter prices / bill lines").
 *
 * Bill lines are written by the client (servers and kitchen add items, cashiers
 * edit), so checkout must not trust `unitPrice`. Each billable line is checked
 * against the store's own pricing source:
 *   - package line (`package_{id}`)       -> storeConfig/current.packages[].pricePerHead
 *                                            (bundlePrice for bundles)
 *   - bundle extra-pax line (`bundleextra_{id}`) -> packages[].bundleExtraHeadPrice
 *   - add-on line                          -> stores/{s}/inventory/{itemId}.sellingPrice
 *                                            (or the inventory row whose productId == itemId)
 * A line that differs is accepted only with a `priceOverride` marker
 * `{ unitPrice, byUid }` matching the line's price and written by an account
 * whose staff role may override prices (cashier / manager / admin) for this
 * store. firestore.rules additionally stop server / kitchen accounts from
 * writing prices, overrides or discounts on lines at all.
 *
 * Pure (no Firestore); the checkout transaction does the reads.
 */
import type { SessionBillLine } from "@/lib/types";

export type CatalogPackage = {
  packageId?: string;
  id?: string;
  pricePerHead?: number;
  isBundle?: boolean;
  bundlePrice?: number;
  bundleExtraHeadPrice?: number;
};

export type PriceOverride = { unitPrice?: unknown; byUid?: unknown };

export const PRICE_OVERRIDE_ROLES = ["admin", "manager", "cashier"] as const;

const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;

const billableQty = (l: SessionBillLine) =>
  Number(l.qtyOrdered || 0) - Number(l.voidedQty || 0) - Number(l.freeQty || 0);

export type LineCatalogKey =
  | { kind: "package"; packageId: string }
  | { kind: "bundleExtra"; packageId: string }
  | { kind: "inventory"; itemId: string };

/** Which catalog entry prices this line. */
export function catalogKeyFor(line: SessionBillLine): LineCatalogKey | null {
  const id = String((line as any).id ?? "");
  if (id.startsWith("bundleextra_")) return { kind: "bundleExtra", packageId: id.slice("bundleextra_".length) };
  if (line.type === "package") {
    const pkgId = String((line as any).itemId || (id.startsWith("package_") ? id.slice("package_".length) : ""));
    return pkgId ? { kind: "package", packageId: pkgId } : null;
  }
  const itemId = (line as any).itemId;
  return typeof itemId === "string" && itemId ? { kind: "inventory", itemId } : null;
}

export function catalogPrice(
  key: LineCatalogKey | null,
  packages: CatalogPackage[],
  inventoryPrice: (itemId: string) => number | null,
): number | null {
  if (!key) return null;
  if (key.kind === "inventory") return inventoryPrice(key.itemId);
  const pkg = packages.find((p) => (p.packageId ?? p.id) === key.packageId);
  if (!pkg) return null;
  const v = key.kind === "bundleExtra" ? pkg.bundleExtraHeadPrice : pkg.isBundle ? pkg.bundlePrice : pkg.pricePerHead;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The catalog's own name for the line (package name / inventory display name),
 * so the receipt never shows a client-chosen name next to a catalog price
 * ("Premium Wagyu" billed at the price of a cheap item id).
 */
export function catalogName(
  key: LineCatalogKey | null,
  packages: Array<CatalogPackage & { packageName?: string; name?: string }>,
  inventoryName: (itemId: string) => string | null,
): string | null {
  if (!key) return null;
  if (key.kind === "inventory") return inventoryName(key.itemId);
  const pkg = packages.find((p) => (p.packageId ?? p.id) === key.packageId);
  const n = pkg?.packageName ?? pkg?.name;
  if (typeof n !== "string" || !n.trim()) return null;
  return key.kind === "bundleExtra" ? `Extra Pax — ${n}` : n;
}

/** Kitchen-voided quantity must be backed by cancelled kitchen tickets for the line. */
export function kitchenVoidProblems(
  lines: SessionBillLine[],
  tickets: Array<Record<string, any>>,
): LinePriceProblem[] {
  const out: LinePriceProblem[] = [];
  for (const line of lines) {
    const kv = Number((line as any).kitchenVoidedQty || 0);
    if (!(kv > 0)) continue;
    const lineId = String((line as any).id ?? "");
    const allowed = tickets
      .filter((t) => t?.billLineId === lineId && t?.status === "cancelled")
      // Full ticket quantity: the kitchen cancel flow voids the whole ticket qty.
      .reduce((s, t) => s + Math.max(0, Number(t.qty ?? t.qtyOrdered ?? 1)), 0);
    if (kv > allowed + 1e-9) {
      out.push({ lineId, itemName: String(line.itemName ?? lineId), reason: `kitchen voided ${kv} but cancelled kitchen tickets cover only ${allowed}` });
    }
  }
  return out;
}

export type LinePriceProblem ={ lineId: string; itemName: string; reason: string };

/**
 * Returns one problem per line whose price cannot be proven. `overrideAllowed`
 * answers whether a uid may override prices in this store (staff role check
 * done by the caller).
 */
export function validateLinePrices(args: {
  lines: SessionBillLine[];
  packages: CatalogPackage[];
  inventoryPrice: (itemId: string) => number | null;
  overrideAllowed: (uid: string) => boolean;
}): LinePriceProblem[] {
  const problems: LinePriceProblem[] = [];
  for (const line of args.lines) {
    if (billableQty(line) <= 0) continue; // fully voided / free: price is irrelevant
    const lineId = String((line as any).id ?? "");
    const itemName = String(line.itemName ?? lineId);
    const mods = (line as any).modifiersTotal;
    if (mods != null && !(typeof mods === "number" && Number.isFinite(mods) && mods >= 0)) {
      problems.push({ lineId, itemName, reason: "invalid modifier total" });
      continue;
    }
    if (!(typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice) && line.unitPrice >= 0)) {
      problems.push({ lineId, itemName, reason: "invalid price" });
      continue;
    }
    const expected = catalogPrice(catalogKeyFor(line), args.packages, args.inventoryPrice);
    if (expected !== null && same(line.unitPrice, expected)) continue;
    const ov = (line as any).priceOverride as PriceOverride | undefined;
    if (ov && same(ov.unitPrice, line.unitPrice) && typeof ov.byUid === "string" && args.overrideAllowed(ov.byUid)) continue;
    problems.push({
      lineId,
      itemName,
      reason: expected === null ? "item is not in the store's price list" : `price ${line.unitPrice} differs from the store price ${expected}`,
    });
  }
  return problems;
}

/** Override uids referenced by the lines (for the caller's staff reads). */
export function overrideUids(lines: SessionBillLine[]): string[] {
  const out = new Set<string>();
  for (const l of lines) {
    const uid = (l as any).priceOverride?.byUid;
    if (typeof uid === "string" && uid && !uid.includes("/")) out.add(uid);
  }
  return [...out];
}
