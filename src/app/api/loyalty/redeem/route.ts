import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { writeLoyaltyRedeem, reverseLoyaltyRedeem } from "@/lib/server/loyalty";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { CASHIER_LINK_NO_REDEEM_ERROR, isSessionCashierLinked } from "@/lib/server/session-link";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    throw new Error("Invalid token.");
  }
}

// Map thrown auth/access errors to HTTP statuses (same convention as the PIN routes).
function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
    500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Apply a reward: debit points + create an applied redemption linked to the session.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const sessionId = String(body.sessionId || "");
  const phone = String(body.phone || "");
  const rewardId = String(body.rewardId || "");
  if (!storeId || !sessionId || !phone || !rewardId) return bad("Missing required fields.");

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    const { uid } = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);

    // A cashier-linked card earns points only; spending needs the customer's own link.
    if (await isSessionCashierLinked(db, storeId, sessionId)) return bad(CASHIER_LINK_NO_REDEEM_ERROR, 403);

    const result = await writeLoyaltyRedeem({ storeId, sessionId, phone, rewardId, staffUid: uid });
    if (!result.ok) return bad(result.error || "Failed to redeem.", result.error === "Insufficient points" ? 400 : 500);
    return NextResponse.json({ ok: true, redemptionId: result.redemptionId, code: result.code, reward: result.reward });
  } catch (e) {
    return mapError(e);
  }
}

// Reverse a redemption (cashier removes the reward before payment, or session void).
export async function DELETE(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const redemptionId = String(body.redemptionId || "");
  if (!redemptionId) return bad("Missing redemptionId.");

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();

    const result = await reverseLoyaltyRedeem(redemptionId, decoded.uid, String(body.reason || "removed"), {
      // Authorize against the redemption's OWN store, not a caller-supplied id.
      authorize: async (appliedStoreId) => {
        if (appliedStoreId) {
          await requireStaffStoreAccess(db, decoded, appliedStoreId, ["admin", "manager", "cashier"]);
          return;
        }
        // Unapplied / null-store redemption (e.g. a pending Hub voucher): only a
        // platform admin may reverse it. POS never reverses these in normal flow.
        if (decoded.platformAdmin === true) return;
        const staffSnap = await db.doc(`staff/${decoded.uid}`).get();
        const role = staffSnap.exists ? String((staffSnap.data() as any)?.role || "") : "";
        if (role !== "admin") throw new Error("No access to this store.");
      },
    });
    if (!result.ok) return bad(result.error || "Failed to reverse.", 500);
    return NextResponse.json({ ok: true, refunded: result.refunded });
  } catch (e) {
    return mapError(e);
  }
}
