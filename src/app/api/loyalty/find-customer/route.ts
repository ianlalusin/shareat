import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { findCustomers } from "@/lib/server/find-customer";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/** Customer finder for the cashier "link card" dialog. Phone = exact; name = this store's visitors only. */
export async function GET(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }

  const url = new URL(req.url);
  const storeId = String(url.searchParams.get("storeId") || "").trim();
  const q = String(url.searchParams.get("q") || "");
  if (!storeId) return bad("storeId is required.");

  const db = getAdminDb();
  try {
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
  } catch (err: any) {
    return bad(err?.message || "Not allowed.", 403);
  }

  const { kind, results } = await findCustomers(db, { storeId, q });
  return NextResponse.json({ ok: true, kind, results });
}
