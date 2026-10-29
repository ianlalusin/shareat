import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { feedbackFallbackWindows } from "@/lib/analytics/customer-feedback-window";
import { fetchFeedbackRows, summarizeFeedback, type FeedbackRow } from "@/lib/server/customer-feedback";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

// Card summary: resolves the dashboard's selected date range to a Manila week
// (snapping sub-week ranges, cascading back through empty weeks — see
// feedbackFallbackWindows) so the card always shows something when the store
// has any feedback history at all.
export async function GET(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1], true);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded);

    const url = new URL(req.url);
    const storeId = String(url.searchParams.get("storeId") || "");
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));

    if (!storeId) return bad("Missing storeId.");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return bad("Invalid start/end.");
    if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
      return bad("No access to this store.", 403);
    }

    const windows = feedbackFallbackWindows({ start, end });
    let rows: FeedbackRow[] = [];
    let resolved = windows[0];

    for (const w of windows) {
      rows = await fetchFeedbackRows(db, storeId, w.startMs, w.endMs);
      resolved = w;
      if (rows.length > 0) break;
    }

    // Nothing found in any window tried: anchor the empty state to the
    // originally-requested period rather than the oldest week we scanned back to.
    if (rows.length === 0) resolved = windows[0];

    const { avgRating, count } = summarizeFeedback(rows);

    return NextResponse.json({
      ok: true,
      avgRating,
      count,
      recentComments: rows.slice(0, 3),
      windowStartMs: resolved.startMs,
      windowEndMs: resolved.endMs,
    });
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
