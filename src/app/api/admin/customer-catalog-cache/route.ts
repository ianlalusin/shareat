import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { rebuildCustomerCatalog } from "@/lib/server/customer-catalog";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op = "rebuild";

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1], true);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin", "manager"]);

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "") as Op;
    const storeId = body?.storeId ? String(body.storeId) : null;

    if (!storeId) return bad("storeId required.", 400);
    if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
      return bad("No access to this store.", 403);
    }

    switch (op) {
      case "rebuild": {
        const result = await rebuildCustomerCatalog(db, storeId);
        return NextResponse.json({ ok: true, ...result });
      }

      default:
        return bad(`Unknown op: ${op}`, 400);
    }
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required/i.test(message) ? 400
      : /not allowed|no access|not a staff/i.test(message) ? 403
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
