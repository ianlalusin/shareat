import { NextResponse } from "next/server";
import { runHolidayCalendarForDueStore } from "@/lib/server/holiday-calendar";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const res = await runHolidayCalendarForDueStore();
    return NextResponse.json({ ok: true, ...res });
  } catch (err: any) {
    console.error("[cron/holiday-calendar] failed:", err);
    return NextResponse.json({ error: err.message || "Holiday calendar cron failed." }, { status: 500 });
  }
}
