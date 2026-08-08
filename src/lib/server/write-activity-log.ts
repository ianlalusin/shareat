import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

export async function writeServerActivityLog(
  db: Firestore,
  opts: {
    storeId: string;
    sessionId: string;
    actorUid: string;
    action: string;
    meta?: Record<string, any>;
    dayId: string;
  }
): Promise<void> {
  const { storeId, sessionId, actorUid, action, meta, dayId } = opts;
  try {
    const payload = {
      storeId,
      sessionId,
      action,
      actorUid,
      actorRole: null,
      actorName: null,
      meta: meta ?? {},
      createdAt: FieldValue.serverTimestamp(),
    };
    const batch = db.batch();
    batch.set(
      db.collection(`stores/${storeId}/sessions/${sessionId}/activityLogs`).doc(),
      payload
    );
    batch.set(
      db.collection(`stores/${storeId}/activityLogsByDay/${dayId}/logs`).doc(),
      payload
    );
    await batch.commit();
  } catch (e) {
    console.warn("[writeServerActivityLog] non-critical write failed:", e);
  }
}
