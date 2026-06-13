import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { reconcileAnalyticsForAllStores } from "@/lib/server/analytics/reconcileAnalytics";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Durable backstop for receipt analytics. Sweeps each active store for receipts
 * left pending by a transient endpoint failure (analyticsApplied:false ->
 * apply; analyticsReversed:false -> reverse) and applies them with the idempotent
 * server writer. Cheap single-field queries (≈0 docs on a healthy system).
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/reconcile-analytics] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await reconcileAnalyticsForAllStores(getAdminDb());
    if (summary.applied || summary.reversed) {
      console.log(`[cron/reconcile-analytics] reconciled applied=${summary.applied} reversed=${summary.reversed} across ${summary.totalStores} store(s)`);
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/reconcile-analytics] failed:", err);
    return NextResponse.json({ error: err?.message || "Reconcile cron failed." }, { status: 500 });
  }
}
