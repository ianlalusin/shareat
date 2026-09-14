import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getManilaDayId } from "@/lib/pins/day-id";
import { endAllParticipants } from "@/lib/server/customer-participants";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { writeServerActivityLog } from "@/lib/server/write-activity-log";

export type FinalizeReason =
  | "manual_disable"
  | "payment_closed"
  | "session_voided"
  | "expired_cleanup"
  | "reissued";

export const FINALIZE_REASONS: ReadonlySet<FinalizeReason> = new Set([
  "manual_disable",
  "payment_closed",
  "session_voided",
  "expired_cleanup",
  "reissued",
]);

/**
 * Archive a session's PIN and disable customer access. Shared by both
 * /api/pins/finalize and /api/pins/disable so the latter no longer makes an
 * HTTP round-trip to the former (which is fragile in serverless/edge hosting).
 * Caller is responsible for verifying the bearer token and validating inputs.
 */
export async function finalizePinLogic(params: {
  decoded: DecodedIdToken;
  storeId: string;
  sessionId: string;
  pin?: string;
  reason: FinalizeReason;
}): Promise<{ ok: boolean; pin: string | null; reason: FinalizeReason; archivedDayId: string }> {
  const { decoded, storeId, sessionId, reason } = params;
  const pin = params.pin || "";

  const adminDb = getAdminDb();
  const { uid: actorUid } = await requireStaffStoreAccess(adminDb, decoded, storeId, ["admin", "manager", "cashier"]);
  const activeSessionRef = adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`);

  const result = await adminDb.runTransaction(async (tx) => {
    const activeSnap = await tx.get(activeSessionRef);

    let currentPin = pin;
    const activeData = activeSnap.exists ? (activeSnap.data() as any) : null;
    if (!currentPin && activeData?.customerPin) {
      currentPin = String(activeData.customerPin);
    }

    const nowMs = Date.now();
    const dayId = getManilaDayId(nowMs);

    if (currentPin) {
      const pinRef = adminDb.doc(`pinRegistry/${currentPin}`);
      const pinSnap = await tx.get(pinRef);

      if (pinSnap.exists) {
        tx.set(
          adminDb.doc(`stores/${storeId}/pinArchiveByDay/${dayId}/pins/${currentPin}`),
          {
            ...pinSnap.data(),
            pin: currentPin,
            storeId,
            sessionId,
            customerName: pinSnap.data()?.customerName ?? activeData?.customerName ?? null,
            tableDisplayName: pinSnap.data()?.tableDisplayName ?? activeData?.tableDisplayName ?? null,
            tableNumber: pinSnap.data()?.tableNumber ?? activeData?.tableNumber ?? activeData?.tableDisplayName ?? null,
            archivedAt: FieldValue.serverTimestamp(),
            archivedByUid: actorUid,
            archiveReason: reason,
            originalStatus: pinSnap.data()?.status || "active",
            status: "archived",
          },
          { merge: true }
        );
        tx.update(pinRef, {
          status: "archived",
          archivedAtMs: nowMs,
          archivedAt: FieldValue.serverTimestamp(),
          archivedByUid: actorUid,
          archiveReason: reason,
        });
      }
    }

    if (activeSnap.exists) {
      tx.set(
        activeSessionRef,
        {
          customerAccessEnabled: false,
          customerPin: null,
          customerAccessExpiresAtMs: null,
          customerJoinVersion: FieldValue.increment(1),
          customerParticipantActiveCount: 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return { ok: true, pin: currentPin || null, reason, archivedDayId: dayId };
  });

  const { revoked: revokedCount, authDeleted } = await endAllParticipants(
    adminDb,
    getAdminAuth(),
    storeId,
    sessionId,
    "ended",
    actorUid,
    `finalize_${reason}`
  );
  await writeServerActivityLog(adminDb, {
    storeId,
    sessionId,
    actorUid,
    action: "CUSTOMER_PARTICIPANTS_RESET",
    meta: { revokedCount, authDeleted, reason },
    dayId: getManilaDayId(Date.now()),
  });

  return result;
}
