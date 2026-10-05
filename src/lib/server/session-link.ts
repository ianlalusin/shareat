import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type LinkResult =
  | { ok: true; phone: string; name: string; pointsBalance: number; alreadyLinked: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Cashier-initiated Sharelebrator link. Add-only: refuses sessions that are
 * paid/locked or already linked to a different card. Runs in a transaction so
 * two cashiers linking different cards at once cannot both win.
 *
 * `phone` must already be normalized (+63XXXXXXXXXX). Existence of the
 * activeSessions projection is the "session is open" signal — billout and
 * void delete it.
 */
export async function linkCardToSession(
  db: Firestore,
  args: { storeId: string; sessionId: string; phone: string; staffUid: string },
): Promise<LinkResult> {
  const { storeId, sessionId, phone, staffUid } = args;
  const activeRef = db.doc(`stores/${storeId}/activeSessions/${sessionId}`);
  const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);
  const customerRef = db.doc(`customers/${phone}`);

  return db.runTransaction(async (tx): Promise<LinkResult> => {
    const [activeSnap, sessionSnap, customerSnap] = await Promise.all([
      tx.get(activeRef),
      tx.get(sessionRef),
      tx.get(customerRef),
    ]);

    if (!activeSnap.exists) {
      return { ok: false, status: 404, error: "Session not found or already closed." };
    }
    const active = activeSnap.data() as any;
    if (active?.isPaid === true || active?.linkedCustomerLockedAt) {
      return { ok: false, status: 409, error: "Session is closed to linking." };
    }
    if (!customerSnap.exists) {
      return { ok: false, status: 404, error: "No Sharelebrator account for that number." };
    }
    const customer = customerSnap.data() as any;
    const name = String(customer?.name ?? "");
    const pointsBalance = Number(customer?.pointsBalance) || 0;

    const existing = String(active?.linkedCustomerPhone ?? "");
    if (existing === phone) {
      return { ok: true, phone, name, pointsBalance, alreadyLinked: true };
    }
    if (existing) {
      const who = String(active?.linkedCustomerName ?? "") || existing;
      return { ok: false, status: 409, error: `Session already linked to ${who}.` };
    }

    const fields = {
      linkedCustomerPhone: phone,
      linkedCustomerName: name,
      linkedByParticipantId: null,
      linkedBy: "cashier",
      linkedByUid: staffUid,
      linkedAt: FieldValue.serverTimestamp(),
    };
    tx.update(activeRef, fields);
    if (sessionSnap.exists) tx.update(sessionRef, fields);

    return { ok: true, phone, name, pointsBalance, alreadyLinked: false };
  });
}
