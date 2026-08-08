import { NextResponse } from "next/server";
import { runForecastWithTracking } from "@/lib/server/generate-forecast";

export const runtime = "nodejs";
// Allow up to 5 minutes — Gemini call + Firestore writes for all active stores.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Scheduled by Google Cloud Scheduler with header Authorization: Bearer ${CRON_SECRET}.
  // See docs/CRON.md for the job definitions.
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/generate-forecast] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { skipped, reason, result } = await runForecastWithTracking();

    if (skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason });
    }

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
    console.error("[cron/generate-forecast] failed:", err);
    return NextResponse.json(
      { error: err.message || "Forecast cron failed." },
      { status: 500 }
    );
  }
}
