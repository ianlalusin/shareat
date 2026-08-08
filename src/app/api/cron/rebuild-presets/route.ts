import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { rebuildDashboardPresetsForAllStores } from "@/lib/server/analytics/backfillServer";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily rebuild of the dashboard preset tiles (today / yesterday / last7 /
 * last30 / thisMonth / lastMonth / thisWeek / ytd) for every active store.
 *
 * Why this exists: the live analytics delta path only ADDS to the preset docs
 * for whichever windows include an event when it happens — it never rolls a day
 * back off once it leaves the window. Left alone, the rolling-window tiles
 * inflate over time (observed: "This Month" reading 3×–11× the true receipt
 * total). Re-summing from the per-day analytics docs (always correct, keyed by
 * dayId) resets them. Run once daily after midnight; the deltas keep the tiles
 * live during the day.
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/rebuild-presets] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await rebuildDashboardPresetsForAllStores(getAdminDb());
    console.log(`[cron/rebuild-presets] rebuilt ${summary.presets} preset(s) across ${summary.totalStores} store(s)`);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/rebuild-presets] failed:", err);
    return NextResponse.json({ error: err?.message || "Rebuild-presets cron failed." }, { status: 500 });
  }
}
