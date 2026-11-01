import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }

  const uid = decoded.uid;
  if (!uid) return bad("Invalid token.", 401);

  const db = getAdminDb();

  let staff;
  try {
    staff = await requireActiveStaff(db, decoded, [
      "admin",
      "manager",
      "cashier",
      "kitchen",
      "server",
    ]);
  } catch (err: any) {
    return bad(err?.message || "Not active staff.", 403);
  }

  const url = new URL(req.url);
  const phone = normalizePhone(url.searchParams.get("phone") || "");
  if (!phone) return bad("Invalid phone number.");

  const customerSnap = await db.doc(`customers/${phone}`).get();
  if (!customerSnap.exists) return NextResponse.json({ ok: true, found: false });

  // Staff still have to belong to the store they are asking from. Beyond that a
  // complete phone number (typed, or read off the card QR) is exact-match only:
  // the caller already holds the number, and there is no list to browse. This
  // is the same rule as the cashier "link card" finder (find-customer.ts).
  if (!staff.isPlatformAdmin) {
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    if (!storeId) return bad("storeId is required.");
    if (!staff.assignedStoreIds.includes(storeId)) {
      return bad("You are not assigned to this store.", 403);
    }
  }

  const c = customerSnap.data() as any;

  const ledgerSnap = await db
    .collection(`customers/${phone}/pointsLedger`)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const ledger = ledgerSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: data.type,
      points: data.points,
      amount: data.amount,
      storeId: data.storeId,
      storeName: data.storeName ?? null,
      sessionId: data.sessionId,
      createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
    };
  });

  return NextResponse.json({
    ok: true,
    found: true,
    customer: {
      phone: c.phone,
      name: c.name,
      address: c.address,
      email: c.email ?? null,
      bday: c.bday,
      pointsBalance: c.pointsBalance ?? 0,
      visitCount: c.visitCount ?? 0,
      storeVisits: c.storeVisits ?? {},
      createdAtMs: c.createdAt?.toMillis ? c.createdAt.toMillis() : null,
      passwordResetAtMs: c.passwordResetAt?.toMillis ? c.passwordResetAt.toMillis() : null,
    },
    ledger,
  });
}
