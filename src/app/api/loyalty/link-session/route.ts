import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { linkCardToSession } from "@/lib/server/session-link";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Cashier attaches a Sharelebrator card to an open, unlinked session (for
 * diners who did not link on their own phone). Add-only — see
 * docs/superpowers/specs/2026-10-05-session-loyalty-link-design.md.
 */
export async function POST(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body?.storeId || "").trim();
  const sessionId = String(body?.sessionId || "").trim();
  if (!storeId || !sessionId) return bad("storeId and sessionId are required.");

  const phone = normalizePhone(String(body?.phone || ""));
  if (!phone) return bad("Enter a valid PH mobile number.");

  const db = getAdminDb();
  let staff;
  try {
    staff = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
  } catch (err: any) {
    return bad(err?.message || "Not allowed.", 403);
  }

  const result = await linkCardToSession(db, { storeId, sessionId, phone, staffUid: staff.uid });
  if (!result.ok) return bad(result.error, result.status);

  return NextResponse.json({
    ok: true,
    phone: result.phone,
    name: result.name,
    pointsBalance: result.pointsBalance,
    alreadyLinked: result.alreadyLinked,
  });
}
