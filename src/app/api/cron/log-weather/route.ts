import { NextResponse } from "next/server";
import { logWeatherForAllActiveStores } from "@/lib/server/weather-logger";

export const runtime = "nodejs";
// Allow a couple of minutes — one OWM call + a monthly-doc write per store.
export const maxDuration = 120;

// Scheduled hourly by Google Cloud Scheduler with header
// Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/log-weather] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { totalStores, results } = await logWeatherForAllActiveStores();
    return NextResponse.json({
      ok: true,
      totalStores,
      logged: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err: any) {
    console.error("[cron/log-weather] failed:", err);
    return NextResponse.json({ error: err?.message || "Weather log cron failed." }, { status: 500 });
  }
}
