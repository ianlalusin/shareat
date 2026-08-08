import { getAuth } from "firebase/auth";

/**
 * Shared client helper to republish the public website storefront catalog after
 * an edit that affects it (product toggle/save, variant edits, or per-store
 * inventory price / availability changes).
 *
 * - `scheduleStorefrontAutoPublish` is debounced + overlap-guarded PER STORE, so
 *   a burst of edits to one store collapses into a single rebuild without
 *   blocking a concurrent edit to a different store. Used by the auto paths.
 * - `publishStorefrontNow` is the immediate path for the manual "Rebuild
 *   Storefront" button (caller manages its own loading UI).
 *
 * The website itself is multi-store (a customer picks a branch), so every
 * store that accepts online orders publishes its own catalog independently —
 * there is no single "pilot" store gate here anymore. `getStorefrontStoreId`
 * is kept only for the one remaining single-store call site
 * (admin/menu/products' auto-publish after a *global* product edit, which
 * isn't scoped to any one store — see the comment there).
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();

export type StorefrontPublishResult = { ok: true; itemCount: number } | { ok: false; error: string };
type Notify = (r: StorefrontPublishResult) => void;

/** The configured "primary" store id used only by the global-product-edit auto-publish, or "" when unset. */
export function getStorefrontStoreId(): string {
  return String(process.env.NEXT_PUBLIC_STOREFRONT_STORE_ID || "").trim();
}

async function doPublish(storeId: string): Promise<StorefrontPublishResult> {
  try {
    const user = getAuth().currentUser;
    if (!user) return { ok: false, error: "Not signed in." };
    const idToken = await user.getIdToken();
    const res = await fetch("/api/admin/storefront-catalog", {
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

/**
 * Immediate rebuild for `storeId` (manual button). Awaitable; reports via
 * `notify`. Shares the per-store in-flight flag so a concurrent debounced
 * rebuild for the SAME store is deferred rather than stacked.
 */
export async function publishStorefrontNow(storeId: string, notify?: Notify): Promise<StorefrontPublishResult> {
  inFlight.add(storeId);
  try {
    const r = await doPublish(storeId);
    notify?.(r);
    return r;
  } finally {
    inFlight.delete(storeId);
  }
}

/**
 * Schedule a debounced storefront republish for `editedStoreId`. Every store
 * publishes for itself — no pilot-store restriction.
 */
export function scheduleStorefrontAutoPublish(editedStoreId: string, notify?: Notify, delayMs = 1500) {
  if (!editedStoreId) return;
  const existing = timers.get(editedStoreId);
  if (existing) clearTimeout(existing);
  const fire = async () => {
    if (inFlight.has(editedStoreId)) {
      timers.set(editedStoreId, setTimeout(fire, 800));
      return;
    }
    inFlight.add(editedStoreId);
    try {
      notify?.(await doPublish(editedStoreId));
    } finally {
      inFlight.delete(editedStoreId);
    }
  };
  timers.set(editedStoreId, setTimeout(fire, delayMs));
}
