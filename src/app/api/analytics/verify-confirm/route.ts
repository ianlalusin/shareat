import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

export const runtime = "nodejs";

/**
 * Server-side verify-confirm analytics increment.
 * Writes confirmMsSum / confirmCount to analytics / analyticsMonths / analyticsYears.
 * These collections are server-only writes (M-1 lockdown) so the client batch
 * cannot touch them — this endpoint applies the increment via Admin SDK.
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
  const verifyDurationMs = Number(body.verifyDurationMs);
  // Trim and null-out blanks so an empty/whitespace profile id or name never
  // creates an unlabeled per-user bucket (which renders as an empty row in the
  // sales report's "Avg confirm (server)" section).
  const profileId: string | null = (body.profileId ? String(body.profileId).trim() : "") || null;
  const profileName: string | null = (body.profileName ? String(body.profileName).trim() : "") || null;

  if (!storeId || !Number.isFinite(verifyDurationMs) || verifyDurationMs < 0) {
    return bad("Missing or invalid storeId / verifyDurationMs.");
  }

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    // Any signed-in staff with access to this store may record a verify-confirm
    // (matches the kds-delta endpoint). The verify UI is currently Server Station
    // only (admin/manager/server), but allowing cashier/kitchen here keeps the
    // analytics write from silently 403-ing if the verify surface is widened.
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier", "kitchen", "server"]);

    const nowMs = Date.now();
    const dayId = getDayIdFromTimestamp(nowMs);
    const monthId = dayId.slice(0, 6);
    const yearId = dayId.slice(0, 4);

    const serverAgg: Record<string, any> = {
      confirmMsSum: FieldValue.increment(verifyDurationMs),
      confirmCount: FieldValue.increment(1),
    };
    if (profileId) {
      // Use NESTED maps, not dotted keys. With set({ merge: true }) the Admin SDK
      // treats a key containing "." as a LITERAL field name, so
      // "confirmCountByUser.<id>" would create a malformed field the report never
      // reads (it reads nested server.confirmCountByUser). Nesting lets the
      // increment merge into server.confirmCountByUser.<id> as intended.
      serverAgg.confirmMsSumByUser = { [profileId]: FieldValue.increment(verifyDurationMs) };
      serverAgg.confirmCountByUser = { [profileId]: FieldValue.increment(1) };
    }

    const buildPayload = (idKey: string, idVal: string) => ({
      meta: { [idKey]: idVal, storeId, updatedAt: FieldValue.serverTimestamp() },
      server: serverAgg,
      ...(profileId && profileName ? { staffNames: { [profileId]: profileName } } : {}),
    });

    const batch = db.batch();
    batch.set(db.doc(`stores/${storeId}/analytics/${dayId}`), buildPayload("dayId", dayId), { merge: true });
    batch.set(db.doc(`stores/${storeId}/analyticsMonths/${monthId}`), buildPayload("monthId", monthId), { merge: true });
    batch.set(db.doc(`stores/${storeId}/analyticsYears/${yearId}`), buildPayload("yearId", yearId), { merge: true });
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
