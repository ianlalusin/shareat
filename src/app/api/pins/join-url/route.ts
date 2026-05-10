import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { buildJoinUrl } from "@/lib/server/customer-join-token";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId") || "";
    const sessionId = url.searchParams.get("sessionId") || "";

    if (!storeId || !sessionId) {
      return NextResponse.json({ error: "storeId and sessionId are required." }, { status: 400 });
    }

    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    const db = getAdminDb();
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
    const snap = await db.doc(`stores/${storeId}/activeSessions/${sessionId}`).get();
    if (!snap.exists) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const s = snap.data() as any;
    if (!String(s.customerPin || "")) return NextResponse.json({ error: "No active PIN" }, { status: 404 });

    const joinUrl = buildJoinUrl({
      storeId,
      sessionId,
      joinVersion: Number(s.customerJoinVersion || 1),
      exp: Number(s.customerAccessExpiresAtMs || Date.now() + 2 * 60 * 60 * 1000),
    });

    return NextResponse.json({ ok: true, joinUrl });
  } catch (e: any) {
    const message = e?.message || "Failed to build join URL.";
    const status =
      /verifyIdToken|Invalid token|Unauthorized/i.test(message) ? 401 :
      /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
      /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
