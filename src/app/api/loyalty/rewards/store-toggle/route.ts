import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { isRewardAllowedAtStore } from "@/lib/loyaltyRewardScope";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
    500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Offer / stop offering one global loyalty reward at one store.
 *
 * `loyaltyRewards` is admin-only for writes in firestore.rules — deliberately,
 * since the catalogue is platform-wide. A manager may still decide whether
 * their own branch offers a reward, so that one narrow edit comes through here
 * and touches `disabledStoreIds` only: nothing else on the document is
 * writable from this route, and the store id comes from the caller's own
 * assignment check rather than the body being trusted.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body.storeId || "").trim();
  const rewardId = String(body.rewardId || "").trim();
  if (!storeId || !rewardId) return bad("storeId and rewardId are required.");
  if (typeof body.offered !== "boolean") return bad("offered must be a boolean.");
  const offered: boolean = body.offered;

  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const db = getAdminDb();
    const { uid } = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);

    const rewardRef = db.doc(`loyaltyRewards/${rewardId}`);
    const snap = await rewardRef.get();
    if (!snap.exists) return bad("Reward not found.", 404);

    // An admin allow-list that excludes this store outranks the manager: they
    // cannot opt their branch into a reward it was never scoped to.
    if (offered && !isRewardAllowedAtStore(snap.data() as any, storeId)) {
      return bad("This reward is scoped to other branches. Ask an admin to include this store.", 403);
    }

    await rewardRef.update({
      disabledStoreIds: offered ? FieldValue.arrayRemove(storeId) : FieldValue.arrayUnion(storeId),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    });

    return NextResponse.json({ ok: true, offered });
  } catch (e) {
    return mapError(e);
  }
}
