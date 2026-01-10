

"use client";

import { collection, doc, setDoc } from "firebase/firestore";
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
    const logDocRef = doc(collection(db, "stores", storeId, "activityLogs"));

    const logDoc: Omit<ActivityLog, 'id' | 'createdAt'> = {
      storeId,
      sessionId,
      action,
      actorUid: user.uid,
      actorRole: user.role || null,
      actorName: user.displayName || user.name || null,
      ...rest,
    };
    
    // Add server timestamp on the client for immediate consistency
    const finalPayload = { ...logDoc, createdAt: new Date() };

    // Set with doc ref to ensure same ID in both locations
    await setDoc(logDocRef, finalPayload);
    // Don't write to the session subcollection anymore, query via collectionGroup
    // const sessionLogRef = doc(db, "stores", storeId, "sessions", sessionId, "activityLogs", logDocRef.id);
    // await setDoc(sessionLogRef, finalPayload);


  } catch (error) {
    console.warn("Failed to write activity log. This error is non-critical.", {
      error,
      payload,
    });
  }
}
