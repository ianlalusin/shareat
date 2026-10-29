import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { claimLegacyCustomer } from "@/lib/server/legacy-loyalty";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Mark one parked legacy row as claimed by a verified walk-in.
 *
 * This endpoint moves NO points. It records the verification (who checked the
 * government ID, against which Hub loyalty card) and hands back
 * `transferPoints` so the owner can run the existing Hub transfer by hand.
 */
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
  if (!decoded.uid) return bad("Invalid token.", 401);

  const db = getAdminDb();

  let staff;
  try {
    staff = await requireActiveStaff(db, decoded, ["admin", "manager"]);
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

  // The staff roster name is the one other staff will recognise on the 409
  // "already claimed by ..." message; the token claims are only a fallback for
  // a staff doc that predates displayName.
  const actorName =
    staff.displayName || (decoded as any).name || decoded.email || staff.uid;

  try {
    const { row, transferPoints, customerName } = await claimLegacyCustomer(db, {
      id,
      phone: String(body?.phone ?? ""),
      idVerified: body?.idVerified === true,
      note: typeof body?.note === "string" ? body.note : undefined,
      actorUid: staff.uid,
      actorName: String(actorName),
    });

    return NextResponse.json({ ok: true, row, transferPoints, customerName });
  } catch (err: any) {
    return bad(err?.message || "Could not claim that row.", Number(err?.httpStatus) || 500);
  }
}
