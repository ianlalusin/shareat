import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { lookupStaffNames, STAFF_NAMES_MAX } from "@/lib/server/staff-names";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Staff uid -> display name for the caller's store (audit B06). Replaces client
 * reads of whole `staff` docs. Body: { storeId, uids: string[] } (max 100).
 * Response: { ok: true, names: { [uid]: name } } — only staff of that store
 * (and admins); other uids are left out.
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
  if (!decoded?.uid) return bad("Invalid token.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body?.storeId || "");
  const uids: string[] = Array.isArray(body?.uids) ? body.uids.filter((u: unknown): u is string => typeof u === "string" && !!u) : [];
  if (!storeId) return bad("Missing storeId.");
  if (uids.length > STAFF_NAMES_MAX) return bad(`At most ${STAFF_NAMES_MAX} uids per request.`);

  const db = getAdminDb();
  try {
    // Any active staffer of the store may see co-workers' names.
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier", "kitchen", "server"]);
  } catch (e: any) {
    const message = e?.message || "Forbidden.";
    return bad(message, /Invalid token/i.test(message) ? 401 : 403);
  }

  const names = await lookupStaffNames(db, storeId, uids);
  return NextResponse.json({ ok: true, names });
}
