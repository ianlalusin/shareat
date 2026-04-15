

'use client';

import { collection, doc, setDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { ActivityLog } from "@/lib/types";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { computeSessionLabel } from "@/lib/utils/session";

type SessionContext = {
    sessionStatus?: 'pending_verification' | 'active' | 'closed' | 'voided';
    sessionStartedAt?: any;
    sessionMode?: 'package_dinein' | 'alacarte' | null;
    customerName?: string | null;
    tableNumber?: string | null;
};

type ActivityLogPayload = {
    storeId: string;
    sessionId: string;
    user: AppUser | null;
    action: ActivityLog['action'];
    sessionContext?: SessionContext;
    lineId?: string;
    qty?: number;
    reason?: string | null;
    note?: string | null;
    meta?: ActivityLog['meta'];
    serverProfile?: { id: string; name: string } | null;
};

/**
 * Logs an activity to the session's activityLogs subcollection and a denormalized,
 * store-level partitioned collection for efficient querying.
 * This is a "best-effort" fire-and-forget operation.
 */
export async function writeActivityLog(payload: ActivityLogPayload): Promise<void> {
  const { storeId, sessionId, user, action, qty, sessionContext, serverProfile, ...rest } = payload;

  if (!user) {
    console.warn("Activity log skipped: User is not authenticated.");
    return;
  }
  if (!storeId || !sessionId) {
    console.warn("Activity log skipped: Store ID or Session ID is missing.");
    return;
  }

  try {
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

      serverProfileId: serverProfile?.id ?? null,
      serverProfileName: serverProfile?.name ?? null,

      // Denormalized session context
      sessionStatus: sessionContext?.sessionStatus,
      sessionStartedAt: sessionContext?.sessionStartedAt,
      sessionMode: sessionContext?.sessionMode ?? undefined,
      customerName: sessionContext?.customerName,
      tableNumber: sessionContext?.tableNumber,
      sessionLabel: computeSessionLabel({
        sessionMode: sessionContext?.sessionMode,
        customerName: sessionContext?.customerName,
        tableNumber: sessionContext?.tableNumber,
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
