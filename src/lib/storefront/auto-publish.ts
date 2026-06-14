import { getAuth } from "firebase/auth";

/**
 * Shared client helper to republish the public website storefront catalog after
 * an edit that affects it (product toggle/save, variant edits, or per-store
 * inventory price / availability changes).
 *
 * - `scheduleStorefrontAutoPublish` is debounced + overlap-guarded and only fires
 *   when the edited store IS the configured pilot store. Used by the auto paths.
 * - `publishStorefrontNow` is the immediate path for the manual "Rebuild
 *   Storefront" button (caller manages its own loading UI).
 *
 * Debounce + in-flight state is module-scoped, so a burst of edits across
 * different handlers/pages collapses into a single rebuild and a manual rebuild
 * never stacks on a debounced one.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

export type StorefrontPublishResult = { ok: true; itemCount: number } | { ok: false; error: string };
type Notify = (r: StorefrontPublishResult) => void;

/** The configured storefront pilot store id, or "" when unset. */
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
 * `notify`. Shares the module in-flight flag so a concurrent debounced rebuild
 * is deferred rather than stacked.
 */
export async function publishStorefrontNow(storeId: string, notify?: Notify): Promise<StorefrontPublishResult> {
  inFlight = true;
  try {
    const r = await doPublish(storeId);
    notify?.(r);
    return r;
  } finally {
    inFlight = false;
  }
}

/**
 * Schedule a debounced storefront republish for `editedStoreId`. No-op unless it
 * matches the configured pilot store. `notify` is called once with the outcome.
 */
export function scheduleStorefrontAutoPublish(editedStoreId: string, notify?: Notify, delayMs = 1500) {
  const pilot = getStorefrontStoreId();
  if (!pilot || !editedStoreId || editedStoreId !== pilot) return;
  if (timer) clearTimeout(timer);
  const fire = async () => {
    if (inFlight) {
      timer = setTimeout(fire, 800);
      return;
    }
    inFlight = true;
    try {
      notify?.(await doPublish(pilot));
    } finally {
      inFlight = false;
    }
  };
  timer = setTimeout(fire, delayMs);
}
