import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { WEEK_MS, getManilaWeekStartMs } from "@/lib/analytics/customer-feedback-window";
import { fetchFeedbackRows, summarizeFeedback } from "@/lib/server/customer-feedback";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

// Modal pagination: an explicit week, no fallback — paging into an empty
// week is expected to show "no feedback that week", not jump elsewhere.
export async function GET(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded);

    const url = new URL(req.url);
    const storeId = String(url.searchParams.get("storeId") || "");
    const requestedWeekStartMs = Number(url.searchParams.get("weekStartMs"));

    if (!storeId) return bad("Missing storeId.");
    if (!Number.isFinite(requestedWeekStartMs)) return bad("Invalid weekStartMs.");
    if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
      return bad("No access to this store.", 403);
    }

    const weekStartMs = getManilaWeekStartMs(requestedWeekStartMs);
    const weekEndMs = weekStartMs + WEEK_MS;

    const rows = await fetchFeedbackRows(db, storeId, weekStartMs, weekEndMs);
    const { avgRating, count } = summarizeFeedback(rows);

    return NextResponse.json({ ok: true, rows, avgRating, count, weekStartMs, weekEndMs });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /missing|invalid/i.test(message)
      ? 400
      : /no access|not allowed|not a staff|not active/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
