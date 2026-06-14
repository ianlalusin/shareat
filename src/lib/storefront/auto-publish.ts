import { getAuth } from "firebase/auth";

/**
 * Shared client helper to auto-republish the public website storefront catalog
 * after an edit that affects it (product toggle/save, variant edits, or per-store
 * inventory price / availability changes).
 *
 * It only fires when the edited store IS the configured storefront pilot store
 * (NEXT_PUBLIC_STOREFRONT_STORE_ID), and is debounced + overlap-guarded at module
 * scope so a burst of edits across handlers collapses into a single rebuild.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

export type StorefrontPublishResult = { ok: true; itemCount: number } | { ok: false; error: string };
type Notify = (r: StorefrontPublishResult) => void;

async function publish(storeId: string, notify?: Notify) {
  if (inFlight) return;
  inFlight = true;
  try {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Not signed in.");
    const idToken = await user.getIdToken();
    const res = await fetch("/api/admin/storefront-catalog", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "rebuild", storeId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || `Rebuild failed (${res.status})`);
    notify?.({ ok: true, itemCount: Number(json.itemCount ?? 0) });
  } catch (e: any) {
    notify?.({ ok: false, error: e?.message || "Auto-publish failed" });
  } finally {
    inFlight = false;
  }
}

/**
 * Schedule a debounced storefront republish for `editedStoreId`. No-op unless it
 * matches the configured pilot store. `notify` is called once with the outcome.
 */
export function scheduleStorefrontAutoPublish(editedStoreId: string, notify?: Notify, delayMs = 1500) {
  const pilot = process.env.NEXT_PUBLIC_STOREFRONT_STORE_ID;
  if (!pilot || !editedStoreId || editedStoreId !== pilot) return;
  if (timer) clearTimeout(timer);
  const fire = () => {
    if (inFlight) {
      timer = setTimeout(fire, 800);
      return;
    }
    void publish(pilot, notify);
  };
  timer = setTimeout(fire, delayMs);
}
