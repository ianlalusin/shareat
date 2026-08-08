import "server-only";

import type { Firestore } from "firebase-admin/firestore";

/**
 * Master per-store switch for Google GenAI features (daily insights, sales
 * forecasts, AI briefings). **Default OFF** — a store must explicitly set
 * `aiEnabled: true` on its store doc. This is the single gate consulted by
 * every GenAI entry point (cron + manual generation), so flipping it off stops
 * all Gemini calls for that store.
 */
export async function isStoreAiEnabled(db: Firestore, storeId: string): Promise<boolean> {
  if (!storeId) return false;
  const snap = await db.doc(`stores/${storeId}`).get();
  return snap.exists && (snap.data() as any)?.aiEnabled === true;
}
