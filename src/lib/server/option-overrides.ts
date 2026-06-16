import type { Firestore } from "firebase-admin/firestore";

/**
 * Per-store availability overlay for option groups / values.
 *
 * Option groups (and their attachment to products) are global and reusable. A
 * store that doesn't carry a particular modifier — e.g. Malvar has no "Cheese"
 * dip — records that here instead of mutating the shared group. This keeps the
 * groups canonical while letting each store turn individual groups or values
 * off without affecting the others.
 *
 * Stored at `stores/{storeId}/optionOverrides/main`:
 *   {
 *     disabledGroupIds:  string[]            // whole groups hidden at this store
 *     disabledValueKeys: string[]            // "<groupId>:<valueId>" pairs hidden here
 *   }
 *
 * Value keys are compound (group + value) so a value id that happens to repeat
 * across two groups can never be turned off in the wrong one.
 *
 * Read-only by the cashier option-groups route and the storefront catalog
 * rebuild; written by the per-store availability admin UI. An empty / missing
 * doc means "everything on", so existing stores are unaffected by default.
 */
export type OptionOverrides = {
  disabledGroupIds: Set<string>;
  disabledValueKeys: Set<string>;
};

export function emptyOverrides(): OptionOverrides {
  return { disabledGroupIds: new Set(), disabledValueKeys: new Set() };
}

export function valueKey(groupId: string, valueId: string): string {
  return `${groupId}:${valueId}`;
}

export async function loadOptionOverrides(db: Firestore, storeId: string): Promise<OptionOverrides> {
  if (!storeId) return emptyOverrides();
  const snap = await db.doc(`stores/${storeId}/optionOverrides/main`).get();
  if (!snap.exists) return emptyOverrides();
  const d = snap.data() as any;
  const groupIds = Array.isArray(d?.disabledGroupIds) ? d.disabledGroupIds : [];
  const valueKeys = Array.isArray(d?.disabledValueKeys) ? d.disabledValueKeys : [];
  return {
    disabledGroupIds: new Set(groupIds.map((x: any) => String(x))),
    disabledValueKeys: new Set(valueKeys.map((x: any) => String(x))),
  };
}

type FilterableValue = { id: string; isActive?: boolean };
type FilterableGroup = { id: string; values?: FilterableValue[] };

/**
 * Returns a new array with this store's disabled groups removed and disabled
 * values stripped from each remaining group. A group whose values are all
 * disabled (no active value left) is dropped entirely — an empty or
 * unsatisfiable group is never worth showing. The admin UI guards against
 * disabling the last value of a still-enabled group, so this is defensive.
 */
export function filterGroupsForStore<T extends FilterableGroup>(groups: T[], ov: OptionOverrides): T[] {
  const out: T[] = [];
  for (const g of groups) {
    if (ov.disabledGroupIds.has(g.id)) continue;
    const values = (g.values || []).filter((v) => !ov.disabledValueKeys.has(valueKey(g.id, v.id)));
    if (!values.some((v) => v.isActive !== false)) continue;
    out.push({ ...g, values });
  }
  return out;
}
