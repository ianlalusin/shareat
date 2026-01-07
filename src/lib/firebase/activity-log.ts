
"use client";

import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";

/**
 * Logs an activity to the activityLogs collection for a store.
 * This is a fire-and-forget operation.
 * @param user The user performing the action.
 * @param action The type of action (e.g., 'session_started', 'payment_processed').
 * @param details A descriptive string of the action.
 * @param associatedIds Optional object with related IDs like sessionId, ticketId, etc.
 */
export async function logActivity(
  user: AppUser | null,
  action: string,
  details: string,
  associatedIds: Record<string, string> = {}
) {
  if (!user || !user.storeId) {
    console.warn("Activity log skipped: User or storeId is missing.");
    return;
  }

  try {
    const activityLogsRef = collection(db, "stores", user.storeId, "activityLogs");
    await addDoc(activityLogsRef, {
      action,
      details,
      user: {
        uid: user.uid,
        name: user.displayName || user.email,
        role: user.role,
      },
      ...associatedIds,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
    // We don't throw an error here because logging is a non-critical background task.
  }
}
