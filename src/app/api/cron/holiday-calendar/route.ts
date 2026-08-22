import { NextResponse } from "next/server";
import { runHolidayCalendarForAllDueStores } from "@/lib/server/holiday-calendar";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Monthly holiday-calendar refresh. One Gemini call per AI-enabled store builds
 * that store's national + local (town/city fiesta) calendar for the prior and
 * current year, plus next year each December, keyed off the store's own address.
 *
 * Runs every due store in one fire — see runHolidayCalendarForAllDueStores for
 * why the old one-store-per-fire design cannot be scheduled monthly. 600s
 * because that is several sequential Gemini calls.
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/holiday-calendar] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const res = await runHolidayCalendarForAllDueStores();
    console.log(
      `[cron/holiday-calendar] ${res.periodKey} aiStores=${res.totalAiStores} generated=${res.processed} skipped=${res.skipped} failed=${res.failed}`,
    );
    // A partial failure is still a 200 — the per-store detail is in the body and
    // unfinished stores are retried on the next fire this month.
    return NextResponse.json({ ok: true, ...res });
  } catch (err: any) {
    console.error("[cron/holiday-calendar] failed:", err);
    return NextResponse.json({ error: err.message || "Holiday calendar cron failed." }, { status: 500 });
  }
}
