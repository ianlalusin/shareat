import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyKdsTicketDeltaServer } from "@/lib/server/analytics/applyKdsTicketDeltaServer";

export const runtime = "nodejs";

/**
 * Server-side KDS analytics delta. Recomputes each ticket's applied-state target
 * from its doc and applies only the incremental difference vs the stored markers
 * (idempotent, partial-serve safe). One transaction per ticket.
 */
function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1]);
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
  const sessionId = String(body.sessionId || "");
  const ticketIds: string[] = Array.isArray(body.ticketIds)
    ? body.ticketIds.map((t: unknown) => String(t)).filter(Boolean)
    : body.ticketId
      ? [String(body.ticketId)]
      : [];
  if (!storeId || !sessionId || ticketIds.length === 0) {
    return bad("Missing storeId, sessionId, or ticketIds.");
  }
  const actor =
    body.actor && typeof body.actor === "object"
      ? { profileId: body.actor.profileId ?? null, name: body.actor.name ?? null }
      : undefined;

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier", "kitchen", "server"]);

    const results: any[] = [];
    for (const ticketId of ticketIds) {
      const ref = db.doc(`stores/${storeId}/sessions/${sessionId}/kitchentickets/${ticketId}`);
      const r = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ticketId, skipped: true as const, reason: "not found" };
        const ticket = snap.data() as any;
        const { changed, markers } = applyKdsTicketDeltaServer(db, storeId, ticket, tx, new Date(), actor);
        if (changed) {
          tx.update(ref, { ...markers, analyticsKdsAppliedAt: FieldValue.serverTimestamp() });
        }
        return { ticketId, changed };
      });
      results.push(r);
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return mapError(e);
  }
}
