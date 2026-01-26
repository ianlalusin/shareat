

"use client";

import { collection, doc, setDoc, serverTimestamp, writeBatch, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { ActivityLog } from "@/lib/types";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { computeSessionLabel } from "@/lib/utils/session";

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
 * Logs an activity to the session's activityLogs subcollection and a denormalized,
 * store-level partitioned collection for efficient querying.
 * This is a "best-effort" fire-and-forget operation.
 */
export async function writeActivityLog(payload: ActivityLogPayload): Promise<void> {
  const { storeId, sessionId, user, action, qty, ...rest } = payload;

  if (!user) {
    console.warn("Activity log skipped: User is not authenticated.");
    return;
  }
  if (!storeId || !sessionId) {
    console.warn("Activity log skipped: Store ID or Session ID is missing.");
    return;
  }

  try {
    // Fetch session doc to get denormalized data
    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    const sessionSnap = await getDoc(sessionRef);
    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};
    
    const now = new Date();
    const serverTs = serverTimestamp();
    const dayId = getDayIdFromTimestamp(now);

    const meta = { ...rest.meta, ...(qty !== undefined && { qty }), ...(rest.reason && { reason: rest.reason }) };
    
    const logDoc: Omit<ActivityLog, 'id' | 'createdAt'> = {
      storeId,
      sessionId,
      action,
      actorUid: user.uid,
      actorRole: user.role || null,
      actorName: user.displayName || user.name || null,
      
      // Denormalized session context
      sessionStatus: sessionData.status,
      sessionStartedAt: sessionData.startedAt,
      sessionMode: sessionData.sessionMode,
      customerName: sessionData.customer?.name ?? sessionData.customerName,
      tableNumber: sessionData.tableNumber,
      sessionLabel: computeSessionLabel({
        sessionMode: sessionData.sessionMode,
        customerName: sessionData.customer?.name ?? sessionData.customerName,
        tableNumber: sessionData.tableNumber,
      }),

      ...rest,
      meta,
    };
    
    const finalPayload = { ...logDoc, createdAt: serverTs };
    
    // Use a batch for atomic dual write
    const batch = writeBatch(db);

    // 1. Legacy Write (to keep old functionality)
    const legacyLogRef = doc(collection(db, `stores/${storeId}/sessions/${sessionId}/activityLogs`));
    batch.set(legacyLogRef, finalPayload);

    // 2. New Partitioned Write
    const newLogRef = doc(collection(db, `stores/${storeId}/activityLogsByDay/${dayId}/logs`));
    batch.set(newLogRef, finalPayload);

    await batch.commit();

  } catch (error) {
    console.warn("Failed to write activity log. This error is non-critical.", {
      error,
      payload,
    });
  }
}
