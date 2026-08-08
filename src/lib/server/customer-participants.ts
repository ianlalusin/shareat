import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

export async function endAllParticipants(
  db: Firestore,
  storeId: string,
  sessionId: string,
  status: "revoked" | "ended",
  byUid: string,
  reason: string
): Promise<number> {
  const ref = db.collection(
    `stores/${storeId}/activeSessions/${sessionId}/customerParticipants`
  );
  const snap = await ref.where("status", "==", "active").get();
  if (snap.empty) return 0;

  const sessionRef = db.doc(`stores/${storeId}/activeSessions/${sessionId}`);
  const batch = db.batch();
  const nowTs = FieldValue.serverTimestamp();
  for (const d of snap.docs) {
    batch.update(d.ref, { status, revokedAt: nowTs, revokedByUid: byUid, revokeReason: reason });
  }
  batch.update(sessionRef, { customerParticipantActiveCount: 0 });
  await batch.commit();
  return snap.size;
}
