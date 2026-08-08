import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import {
  rebuildDailyAnalyticsFromReceiptsServer,
  rebuildDailySessionsFromReceiptsServer,
  backfillSessionDurationRollupsServer,
  rebuildDashboardPresetsServer,
} from "@/lib/server/analytics/backfillServer";

export const runtime = "nodejs";
// Admin analytics maintenance can read/write a lot — give it headroom.
export const maxDuration = 300;

/**
 * Server-side analytics backfill (admin maintenance). Actions:
 *  - "daily":    rebuild daily docs for [startMs, endMs] from receipts/tickets/sessions
 *  - "sessions": rebuild the Daily Session Timeline day docs for [startMs, endMs]
 *  - "rollups":  recompute month/year session-duration rollups for the range
 *  - "presets":  rebuild the dashboard preset docs
 * Admin/manager only. Ranges are client-driven (the admin pages page by
 * day/month/year) to keep each request bounded.
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
    /not found/i.test(message) ? 400 :
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
  const action = String(body.action || "");
  if (!storeId || !action) return bad("Missing storeId or action.");
  if (!["daily", "sessions", "rollups", "presets"].includes(action)) return bad(`Unsupported action '${action}'.`);

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);

    if (action === "presets") {
      const result = await rebuildDashboardPresetsServer(db, storeId, new Date());
      return NextResponse.json({ ok: true, ...result });
    }

    const startMs = Number(body.startMs);
    const endMs = Number(body.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return bad("Missing or invalid startMs/endMs.");
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);

    if (action === "daily") {
      const result = await rebuildDailyAnalyticsFromReceiptsServer(db, storeId, startDate, endDate);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "sessions") {
      const result = await rebuildDailySessionsFromReceiptsServer(db, storeId, startDate, endDate);
      return NextResponse.json({ ok: true, ...result });
    }
    // action === "rollups"
    const result = await backfillSessionDurationRollupsServer(db, storeId, startDate, endDate);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mapError(e);
  }
}
