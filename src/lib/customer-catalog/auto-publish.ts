import { getAuth } from "firebase/auth";

/**
 * Shared client helper to republish a store's CUSTOMER app catalog cache after
 * an edit that affects it: the `customerEnabled` toggle, a `sellingPrice`
 * change, or the store-level `customerOrderingEnabled` switch.
 *
 * NOTE: there is no customer-app price override. `rebuildCustomerCatalog`
 * always charges `sellingPrice`. A retired backfill
 * (scripts/backfill-customer-catalog.ts) wrote a `customerPrice` field that is
 * not on the InventoryItem type and that nothing reads — this comment used to
 * name it as a trigger, which promised an override that does not exist.
 *
 * Mirrors `src/lib/storefront/auto-publish.ts`, but every
 * store publishes its own cache — there is no single "pilot store" gate here,
 * since the CUSTOMER app serves each store's own menu.
 *
 * Debounce + in-flight state is keyed per store so edits across different
 * stores never block on each other.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();

export type CustomerCatalogPublishResult = { ok: true; itemCount: number } | { ok: false; error: string };
type Notify = (r: CustomerCatalogPublishResult) => void;

async function doPublish(storeId: string): Promise<CustomerCatalogPublishResult> {
  try {
    const user = getAuth().currentUser;
    if (!user) return { ok: false, error: "Not signed in." };
    const idToken = await user.getIdToken();
    const res = await fetch("/api/admin/customer-catalog-cache", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "rebuild", storeId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) return { ok: false, error: json?.error || `Rebuild failed (${res.status})` };
    return { ok: true, itemCount: Number(json.itemCount ?? 0) };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Auto-publish failed" };
  }
}

/** Immediate rebuild for `storeId`. Awaitable; reports via `notify`. */
export async function publishCustomerCatalogNow(storeId: string, notify?: Notify): Promise<CustomerCatalogPublishResult> {
  inFlight.add(storeId);
  try {
    const r = await doPublish(storeId);
    notify?.(r);
    return r;
  } finally {
    inFlight.delete(storeId);
  }
}

/** Schedule a debounced customer-catalog republish for `storeId`. */
export function scheduleCustomerCatalogAutoPublish(storeId: string, notify?: Notify, delayMs = 1500) {
  if (!storeId) return;
  const existing = timers.get(storeId);
  if (existing) clearTimeout(existing);
  const fire = async () => {
    if (inFlight.has(storeId)) {
      timers.set(storeId, setTimeout(fire, 800));
      return;
    }
    inFlight.add(storeId);
    try {
      notify?.(await doPublish(storeId));
    } finally {
      inFlight.delete(storeId);
    }
  };
  timers.set(storeId, setTimeout(fire, delayMs));
}
