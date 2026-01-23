

"use client";

import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { ActivityLog } from "@/lib/types";

type ActivityLogPayload = {
    storeId: string;
    sessionId: string;
    user: AppUser | null;
    action: ActivityLog['action'];
    lineId?: string;
    qty?: number;
    reason?: string | null;
    note?: string | null;
    meta?: ActivityLog['meta'];
};

/**
 * Logs an activity to the store's top-level activityLogs collection.
 * This is a "best-effort" fire-and-forget operation.
 */
export async function writeActivityLog(payload: ActivityLogPayload): Promise<void> {
  const { storeId, sessionId, user, action, qty, ...rest } = payload;

  if (!user) {
    console.warn("Activity log skipped: User is not authenticated.");
    return;
  }
  if (!storeId) {
    console.warn("Activity log skipped: Store ID is missing.");
    return;
  }

  try {
    // Write to the top-level subcollection under the store.
    const logDocRef = doc(collection(db, `stores/${storeId}/activityLogs`));
    
    const meta = { ...rest.meta, ...(qty !== undefined && { qty }), ...(rest.reason && { reason: rest.reason }) };

    const logDoc: Omit<ActivityLog, 'id' | 'createdAt'> = {
      storeId,
      sessionId,
      action,
      actorUid: user.uid,
      actorRole: user.role || null,
      actorName: user.displayName || user.name || null,
      ...rest,
      meta,
    };
    
    const finalPayload = { ...logDoc, createdAt: serverTimestamp() };

    await setDoc(logDocRef, finalPayload);

  } catch (error) {
    console.warn("Failed to write activity log. This error is non-critical.", {
      error,
      payload,
    });
  }
}
