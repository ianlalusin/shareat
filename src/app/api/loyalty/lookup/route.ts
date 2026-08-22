import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { PRESENCE_WINDOW_MS, resolvePhonePresence } from "@/lib/server/loyaltyPresence";
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
    decoded = await getAdminAuth().verifyIdToken(match[1]);
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

  // Store-scoped staff may only pull up customers their store is currently
  // serving. Admins stay global, which is what makes them the escalation path
  // for a customer who has been away longer than the presence window.
  if (!staff.isPlatformAdmin) {
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    if (!storeId) return bad("storeId is required.");
    if (!staff.assignedStoreIds.includes(storeId)) {
      return bad("You are not assigned to this store.", 403);
    }

    const presence = await resolvePhonePresence(storeId, phone);
    if (!presence) {
      // Deliberately distinguishable from "no such customer". A bare not-found
      // reads as a typo, so the cashier retypes the number while the customer
      // waits and nobody realises an admin is needed.
      //
      // The blocker is *time*, not ownership: `customers` is not partitioned by
      // store, so telling staff the record "belongs to another branch" sends
      // them chasing a problem that does not exist. Return the window and this
      // store's own last-visit stamp instead, so the UI can name what actually
      // failed and when the customer was last here.
      let storeName = storeId;
      try {
        storeName = (await db.doc(`stores/${storeId}`).get()).data()?.name || storeId;
      } catch {}
      const visitHere = (customerSnap.data() as any)?.storeVisits?.[storeId];
      return NextResponse.json({
        ok: true,
        found: false,
        outOfScope: true,
        storeName,
        windowMinutes: PRESENCE_WINDOW_MS / 60000,
        // Written on points_earned only, so absence means "no recorded visit
        // here", never "never been here" — the copy is hedged accordingly.
        lastVisitHereMs: Number(visitHere?.lastVisitAtMs) || null,
      });
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
