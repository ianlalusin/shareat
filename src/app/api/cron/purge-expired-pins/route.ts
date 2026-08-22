import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { purgeExpiredPins } from "@/lib/server/retention/purge-pins";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly expired-PIN sweep. A PIN's 2-hour TTL makes it dead the moment its
 * session closes; it feeds no aggregate, so there is no horizon or rebuild
 * guard here — see src/lib/server/retention/purge-pins.ts.
 *
 * Reports only unless `?write=1`, so the job can be scheduled and observed for
 * a cycle before it is armed.
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/purge-expired-pins] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const write = new URL(request.url).searchParams.get("write") === "1";

  try {
    const result = await purgeExpiredPins(getAdminDb(), { nowMs: Date.now(), write });
    console.log(
      `[cron/purge-expired-pins] write=${write} total=${result.total} candidates=${result.candidates} deleted=${result.deleted}`,
    );
    return NextResponse.json({ ok: true, write, ...result });
  } catch (err: any) {
    console.error("[cron/purge-expired-pins] failed:", err);
    return NextResponse.json({ error: err?.message || "Pin purge cron failed." }, { status: 500 });
  }
}
