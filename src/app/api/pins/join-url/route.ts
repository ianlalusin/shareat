import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { buildJoinUrl } from "@/lib/server/customer-join-token";

export const runtime = "nodejs";

export async function GET(req: Request) {
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
  const staffSnap = await getAdminDb().doc(`staff/${decoded.uid}`).get();
  const role = String(staffSnap.exists ? (staffSnap.data() as any)?.role : "");
  if (!["admin", "manager", "cashier"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getAdminDb();
  const snap = await db.doc(`stores/${storeId}/activeSessions/${sessionId}`).get();
  if (!snap.exists) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const s = snap.data() as any;
  const pin = String(s.customerPin || "");
  if (!pin) return NextResponse.json({ error: "No active PIN" }, { status: 404 });

  const joinUrl = buildJoinUrl({
    storeId,
    sessionId,
    pin,
    joinVersion: Number(s.customerJoinVersion || 1),
    exp: Number(s.customerAccessExpiresAtMs || Date.now() + 2 * 60 * 60 * 1000),
  });

  return NextResponse.json({ ok: true, joinUrl });
}
