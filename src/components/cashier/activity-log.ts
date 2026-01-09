
"use client";

import { collection, addDoc, serverTimestamp, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { ActivityLog } from "@/lib/types";

type ActivityLogPayload = {
    storeId: string;
    sessionId: string;
    user: AppUser | null;
    action: ActivityLog['action'];
    lineId?: string;
    ticketIds?: string[];
    fromLineId?: string | null;
    toLineId?: string | null;
    reason?: string | null;
    note?: string | null;
    meta?: ActivityLog['meta'];
};

/**
 * Logs an activity to both the session's subcollection and a store-level
 * collection for easy dashboard querying.
 * This is a "best-effort" fire-and-forget operation.
 */
export async function writeActivityLog(payload: ActivityLogPayload): Promise<void> {
  const { storeId, sessionId, user, action, ...rest } = payload;

  if (!user) {
    console.warn("Activity log skipped: User is not authenticated.");
    return;
  }
  if (!storeId || !sessionId) {
    console.warn("Activity log skipped: Store ID or Session ID is missing.");
    return;
  }

  try {
    const sessionLogsRef = collection(db, "stores", storeId, "sessions", sessionId, "activityLogs");
    const logDocRef = doc(sessionLogsRef); // Create a reference with a new auto-ID

    const logDoc: Omit<ActivityLog, 'id'> = {
      storeId,
      sessionId,
      action,
      actorUid: user.uid,
      actorRole: user.role || null,
      actorName: user.displayName || user.name || null,
      ...rest,
      createdAt: serverTimestamp(),
    };

    // 1. Write to the session-specific log
    await setDoc(logDocRef, logDoc);
    
    // 2. Write a mirror to the store-level log for dashboard querying
    const storeLogRef = doc(db, "stores", storeId, "activityLogs", logDocRef.id);
    await setDoc(storeLogRef, { ...logDoc, id: logDocRef.id });


  } catch (error) {
    console.warn("Failed to write activity log. This error is non-critical.", {
      error,
      payload,
    });
  }
}
