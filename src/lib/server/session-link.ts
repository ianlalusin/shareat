import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { isCashierLinked } from "@/lib/loyalty/session-link";
import { normalizePhone } from "@/lib/phone";

export const CASHIER_LINK_NO_REDEEM_ERROR =
  "Redemption isn't available when the card was linked by a cashier. The customer must link on their own phone.";

/**
 * Whether the open session's activeSessions doc was linked by a cashier. Spend
 * routes (redeem, redeem-voucher) refuse these: a cashier link is earn-only.
 */
export async function isSessionCashierLinked(
  db: Firestore,
  storeId: string,
  sessionId: string,
): Promise<boolean> {
  const snap = await db.doc(`stores/${storeId}/activeSessions/${sessionId}`).get();
  return snap.exists && isCashierLinked(snap.data() as any);
}

export type SessionLinkInfo = { exists: boolean; linkedCustomerPhone?: string | null; linkedBy?: unknown };

/** One read of the open session's activeSessions doc, for spend-route gating. */
export async function readSessionLink(
  db: Firestore,
  storeId: string,
  sessionId: string,
): Promise<SessionLinkInfo> {
  const snap = await db.doc(`stores/${storeId}/activeSessions/${sessionId}`).get();
  if (!snap.exists) return { exists: false };
  const data = (snap.data() ?? {}) as any;
  return { exists: true, linkedCustomerPhone: data.linkedCustomerPhone ?? null, linkedBy: data.linkedBy };
}

export const REDEEM_PHONE_MISMATCH_ERROR = "That card isn't linked to this session.";

/**
 * Gate for POST /api/loyalty/redeem: points may only be spent from the card
 * the customer linked to THIS session. The body's phone is untrusted, so it
 * must equal the session's linked phone (compared normalized; a null
 * normalization on either side is a mismatch, never a match).
 */
export function redeemGate(
  link: SessionLinkInfo,
  phone: string,
): { ok: true } | { ok: false; status: 403 | 404; error: string } {
  if (!link.exists) return { ok: false, status: 404, error: "Session not found or already closed." };
  if (isCashierLinked(link as any)) return { ok: false, status: 403, error: CASHIER_LINK_NO_REDEEM_ERROR };
  const linked = link.linkedCustomerPhone ? normalizePhone(String(link.linkedCustomerPhone)) : null;
  const given = phone ? normalizePhone(String(phone)) : null;
  if (!linked || !given || linked !== given) {
    return { ok: false, status: 403, error: REDEEM_PHONE_MISMATCH_ERROR };
  }
  return { ok: true };
}

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
