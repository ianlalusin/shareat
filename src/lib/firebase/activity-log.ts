"use client";

import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";

/**
 * Logs an activity to the activityLogs collection for a store.
 * Fire-and-forget.
 *
 * @param storeId The active store ID (from store context / localStorage), NOT from user profile.
 * @param user The user performing the action.
 * @param action The type of action (e.g., 'session_started', 'payment_processed').
 * @param details A descriptive string of the action.
 * @param associatedIds Optional object with related IDs like sessionId, ticketId, etc.
 */
export async function logActivity(
  storeId: string | null | undefined,
  user: AppUser | null,
  action: string,
  details: string,
  associatedIds: Record<string, string> = {}
) {
  if (!user || !storeId) {
    console.warn("Activity log skipped: User or storeId is missing.");
    return;
  }

  try {
    const activityLogsRef = collection(db, "stores", storeId, "activityLogs");
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
  }
}
