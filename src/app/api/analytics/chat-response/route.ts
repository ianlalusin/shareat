import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyChatResponseServer } from "@/lib/server/analytics/applyChatResponseServer";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    throw new Error("Invalid token.");
  }
}

function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
    500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const threadId = String(body.threadId || "");
  const respondedByProfileId = String(body.respondedByProfileId || "");
  const respondedByName = String(body.respondedByName || "Staff");
  // The scoring instant is NOT read from the body: applyChatResponseServer
  // stamps its own Date.now(), so a forged or clock-skewed client timestamp
  // can't move a score. Mirrors /api/analytics/kds-delta.
  const pendingMessageIds: string[] = Array.isArray(body.pendingMessageIds)
    ? body.pendingMessageIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];
  if (!storeId || !threadId || !respondedByProfileId || pendingMessageIds.length === 0) {
    return bad("Missing storeId, threadId, respondedByProfileId, or pendingMessageIds.");
  }

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);

    const result = await applyChatResponseServer(
      db, storeId, threadId, respondedByProfileId, respondedByName, pendingMessageIds,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mapError(e);
  }
}
