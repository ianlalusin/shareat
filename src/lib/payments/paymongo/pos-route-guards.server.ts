import "server-only";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

/**
 * Guards shared by the POS PayMongo routes (create-qr, status). Only those
 * routes use this module.
 */

/** Roles that run the cashier payment modal (main-nav: /cashier). */
export const POS_PAYMENT_ROLES = ["admin", "manager", "cashier"] as const;

/**
 * True when `id` is usable as ONE Firestore path segment: non-empty, bounded,
 * no "/", not "." / "..", and not a reserved "__x__" id. Rejecting these keeps
 * a caller from steering `stores/${storeId}/...` into another collection.
 */
export function isSafeDocId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > 128) return false;
  if (id.includes("/")) return false;
  if (id === "." || id === "..") return false;
  if (/^__.*__$/.test(id)) return false;
  return true;
}

/**
 * Active staff with a cashier-capable role assigned to `storeId`.
 * On failure, `error` is the message to send back with a 403.
 */
export async function checkPosPaymentAccess(
  db: Firestore,
  decoded: DecodedIdToken,
  storeId: string,
): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
  try {
    const access = await requireStaffStoreAccess(db, decoded, storeId, [...POS_PAYMENT_ROLES]);
    return { ok: true, uid: access.uid };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Forbidden" };
  }
}

/**
 * The store's mode of payment `methodId`, only if it is an active, unarchived
 * PayMongo QR Ph gateway method (stores/{storeId}/storeConfig/current).
 */
export async function findEnabledPaymongoMethod(
  db: Firestore,
  storeId: string,
  methodId: string,
): Promise<{ id: string; name: string } | null> {
  const snap = await db.doc(`stores/${storeId}/storeConfig/current`).get();
  if (!snap.exists) return null;
  const mops = (snap.data() as any)?.modesOfPayment;
  if (!Array.isArray(mops)) return null;
  const mop = mops.find((m: any) => m && String(m.id) === methodId);
  if (!mop) return null;
  if (mop.gateway !== "paymongo_qrph") return null;
  if (mop.isActive !== true || mop.isArchived === true) return null;
  return { id: String(mop.id), name: String(mop.name ?? "") };
}
