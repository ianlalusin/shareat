import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { unclaimLegacyCustomer } from "@/lib/server/legacy-loyalty";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Undo a claim. Admin only — a manager can hand out a claim but only an admin
 * can take one back, because by the time anyone notices, the owner may already
 * have transferred the points in the Hub and the reversal has to be reconciled
 * off-system.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }
  if (!decoded.uid) return bad("Invalid token.", 401);

  const db = getAdminDb();

  let staff;
  try {
    staff = await requireActiveStaff(db, decoded, ["admin"]);
  } catch (err: any) {
    return bad(err?.message || "Not active staff.", 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const id = String(body?.id ?? "").trim();
  if (!id) return bad("id is required.");

  try {
    const row = await unclaimLegacyCustomer(db, { id, actorUid: staff.uid });
    return NextResponse.json({ ok: true, row });
  } catch (err: any) {
    return bad(err?.message || "Could not undo that claim.", Number(err?.httpStatus) || 500);
  }
}
