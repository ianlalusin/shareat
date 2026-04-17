import { NextResponse } from "next/server";
import { runForecastWithTracking } from "@/lib/server/generate-forecast";

export const runtime = "nodejs";
// Allow up to 5 minutes (Vercel Pro default max is 300s; free is 60s but upgrade if needed)
export const maxDuration = 300;

export async function GET(request: Request) {
  // Verify Vercel Cron secret (Vercel automatically sets Authorization: Bearer ${CRON_SECRET})
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
