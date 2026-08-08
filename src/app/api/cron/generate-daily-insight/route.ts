import { NextResponse } from "next/server";
import { runDailyMetricsWithTracking } from "@/lib/server/daily-metrics-digest";

export const runtime = "nodejs";
// Firestore reads/writes for all active stores. No AI call — the AI-narrated
// brief this used to produce was retired in favor of ERP's own AI brief; this
// now only computes the deterministic metrics digest ERP will pull from
// stores/{storeId}/dailyMetrics/{dayId}. Route path kept as-is so the
// existing Cloud Scheduler job doesn't need reconfiguring.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Scheduled by Google Cloud Scheduler with header Authorization: Bearer ${CRON_SECRET}.
  // Run ~6 AM PHT, after yesterday's analytics have settled. (Scheduler job TBD.)
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/generate-daily-insight] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { skipped, reason, result } = await runDailyMetricsWithTracking();
    if (skipped) return NextResponse.json({ ok: true, skipped: true, reason });
    return NextResponse.json({
      ok: true,
      skipped: false,
      reason,
      totalStores: result!.totalStores,
      successCount: result!.results.filter((r) => r.ok).length,
      failureCount: result!.results.filter((r) => !r.ok).length,
      results: result!.results,
    });
  } catch (err: any) {
    console.error("[cron/generate-daily-insight] failed:", err);
    return NextResponse.json({ error: err?.message || "Metrics digest cron failed." }, { status: 500 });
  }
}
