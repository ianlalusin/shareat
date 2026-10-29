import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";
import { getDayIdFromTimestamp, getManilaHour } from "@/lib/analytics/daily";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sum of sales.salesAmountByHour for hours 0..throughHour (Manila, by session start). */
function salesThroughHour(byHour: Record<string, unknown> | undefined, throughHour: number): number {
  let sum = 0;
  for (const [hour, amount] of Object.entries(byHour ?? {})) {
    if (Number(hour) <= throughHour) sum += Number(amount) || 0;
  }
  return sum;
}

/**
 * Live one-store summary for a wall display (the TV sales card): today's sales,
 * closed and active sessions, guests, and today vs the same weekday last week up
 * to this hour. Same auth contract as /api/external/sales. "Today" is the Manila
 * day; active sessions use the dashboard's query (status active or
 * pending_verification) and its guest-count fallback chain.
 */
export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const storeId = new URL(request.url).searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });

  const now = new Date();
  const dayId = getDayIdFromTimestamp(now);
  const lastWeekDayId = getDayIdFromTimestamp(new Date(now.getTime() - 7 * DAY_MS));
  const hour = getManilaHour(now);

  try {
    const db = getAdminDb();
    const [todaySnap, lastWeekSnap, activeSnap] = await Promise.all([
      db.doc(`stores/${storeId}/analytics/${dayId}`).get(),
      db.doc(`stores/${storeId}/analytics/${lastWeekDayId}`).get(),
      db.collection(`stores/${storeId}/sessions`).where("status", "in", ["active", "pending_verification"]).get(),
    ]);

    const today = (todaySnap.exists ? todaySnap.data() : {}) as any;
    const lastWeek = (lastWeekSnap.exists ? lastWeekSnap.data() : {}) as any;

    let activeGuests = 0;
    for (const s of activeSnap.docs) {
      const d = s.data() as any;
      activeGuests += Number(d.guestCountFinal ?? d.guestCountServerVerified ?? d.guestCountCashierInitial ?? 0);
    }

    return NextResponse.json({
      storeId,
      dayId,
      asOf: now.toISOString(),
      todaySales: Number(today.payments?.totalGross ?? 0),
      closedSessions: Number(today.payments?.txCount ?? 0),
      guestsServed: Number(today.guests?.guestCountFinalTotal ?? 0),
      activeSessions: activeSnap.size,
      activeGuests,
      // Both sides count sales by session start hour, so they compare like for like.
      todaySalesByThisHour: salesThroughHour(today.sales?.salesAmountByHour, hour),
      lastWeekSalesByThisHour: salesThroughHour(lastWeek.sales?.salesAmountByHour, hour),
    });
  } catch (err: any) {
    console.error("[external/live-summary] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch live summary." }, { status: 500 });
  }
}
