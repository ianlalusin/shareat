import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { writeLoyaltyEarn } from "@/lib/server/loyalty";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body.storeId || "");
  const receiptId = String(body.receiptId || "");
  // sessionId / phone are optional cross-checks; the receipt and its session
  // decide the amount and the card. body.amount is ignored.
  const sessionId = body.sessionId ? String(body.sessionId) : undefined;
  const phone = body.phone ? String(body.phone) : undefined;

  if (!storeId || !receiptId) {
    return bad("Missing required fields.");
  }

  // Only roles that check out a bill may award points.
  const db = getAdminDb();
  try {
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
  } catch (e: any) {
    const message = e?.message || "Forbidden.";
    return bad(message, /Invalid token/i.test(message) ? 401 : 403);
  }

  const result = await writeLoyaltyEarn({
    storeId,
    receiptId,
    sessionId,
    phone,
    staffUid: uid,
  });

  if (!result.ok) return bad(result.error || "Failed to earn points.", result.status ?? 500);
  return NextResponse.json({ ok: true, points: result.points, ...(result.duplicate ? { duplicate: true } : {}) });
}
