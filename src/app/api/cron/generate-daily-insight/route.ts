import { NextResponse } from "next/server";
import { runInsightWithTracking } from "@/lib/server/generate-daily-insight";

export const runtime = "nodejs";
// Gemini call + Firestore reads/writes for all active stores.
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
    const { skipped, reason, result } = await runInsightWithTracking();
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
    return NextResponse.json({ error: err?.message || "Insight cron failed." }, { status: 500 });
  }
}
