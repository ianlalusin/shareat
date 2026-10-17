import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";

/**
 * End (revoke/finalize) every active customer participant for a session.
 *
 * Each participant doc carries `claimedByUid`, the uid of the Firebase Auth
 * user `signInWithCustomToken` auto-created for that diner on the customer
 * app. Nothing else in the codebase ever deletes that Auth user, so without
 * this step every PIN join leaks one throwaway account forever (7,000+
 * observed in production). Deleting it here is pure best-effort cleanup, not
 * a security boundary: every customer API call re-validates the participant
 * doc's status via validateActiveParticipant, so an Auth user surviving a
 * moment longer than its participant doc cannot grant access. Auth deletion
 * failures are logged and swallowed — they must never make the retirement
 * (the batch commit above) fail or be retried.
 */
export async function endAllParticipants(
  db: Firestore,
  auth: Auth,
  storeId: string,
  sessionId: string,
  status: "revoked" | "ended",
  byUid: string,
  reason: string
): Promise<{ revoked: number; authDeleted: number }> {
  const ref = db.collection(
    `stores/${storeId}/activeSessions/${sessionId}/customerParticipants`
  );
  const snap = await ref.where("status", "==", "active").get();
  if (snap.empty) return { revoked: 0, authDeleted: 0 };

  const sessionRef = db.doc(`stores/${storeId}/activeSessions/${sessionId}`);
  const batch = db.batch();
  const nowTs = FieldValue.serverTimestamp();
  const uids = new Set<string>();
  for (const d of snap.docs) {
    batch.update(d.ref, { status, revokedAt: nowTs, revokedByUid: byUid, revokeReason: reason });
    const claimedByUid = (d.data() as any)?.claimedByUid;
    // Defensive guard: only ever delete the customer-app's own auto-created
    // accounts. A mis-set claimedByUid must never be able to delete a staff
    // or loyalty Auth account.
    if (typeof claimedByUid === "string" && claimedByUid.startsWith("cust_")) {
      uids.add(claimedByUid);
    }
  }
  // Paying or voiding a bill deletes the activeSessions doc, and the PIN is
  // finalized after that. Updating a missing doc fails the whole batch ("No
  // document to update"), which left participants active and Auth users leaked,
  // and made the offline replay queue retry forever. Only reset the counter
  // when the session still exists.
  const sessionSnap = await sessionRef.get();
  if (sessionSnap.exists) {
    batch.update(sessionRef, { customerParticipantActiveCount: 0 });
  }
  await batch.commit();

  const authDeleted = await deleteAuthUsers(auth, Array.from(uids));
  return { revoked: snap.size, authDeleted };
}

/**
 * Deletes each uid's Firebase Auth user independently (per-uid deleteUser,
 * not the batch deleteUsers() call, which is rate-limited to 1 QPS and would
 * throttle when several branches retire PINs in the same second). Never
 * throws: a missing user is treated as already-deleted, and any other
 * failure is logged and otherwise ignored.
 */
async function deleteAuthUsers(auth: Auth, uids: string[]): Promise<number> {
  if (uids.length === 0) return 0;

  const results = await Promise.allSettled(uids.map((uid) => auth.deleteUser(uid)));

  let deleted = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      deleted++;
      return;
    }
    const err: any = result.reason;
    if (err?.code === "auth/user-not-found") {
      deleted++;
      return;
    }
    console.warn("[customer-participants] auth user delete failed", uids[i], err?.message ?? String(err));
  });
  return deleted;
}
