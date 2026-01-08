
"use client";

import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { ActivityLog } from "@/lib/types";

type ActivityLogPayload = {
    storeId: string;
    sessionId: string;
    user: AppUser | null;
    action: ActivityLog['action'];
    lineIds?: string[];
    ticketIds?: string[];
    fromLineId?: string | null;
    toLineId?: string | null;
    reason?: string | null;
    note?: string | null;
    meta?: ActivityLog['meta'];
};

/**
 * Logs an activity to the activityLogs subcollection for a session.
 * This is a "best-effort" fire-and-forget operation. It will not
 * block the main thread or throw an error that stops a critical process.
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
    const activityLogsRef = collection(db, "stores", storeId, "sessions", sessionId, "activityLogs");
    
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

    await addDoc(activityLogsRef, logDoc);

  } catch (error) {
    console.warn("Failed to write activity log. This error is non-critical.", {
      error,
      payload,
    });
  }
}
