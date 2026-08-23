import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { sweepCustomerCatalogs } from "@/lib/server/customer-catalog-sweep";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Nightly customer-catalog rebuild for every active store.
 *
 * The only other writer is a debounced client-side call from three manager
 * screens, so a menu edit made anywhere else — or a tab closed before the
 * debounce fires — never reaches `catalogCache/main`. This is the backstop.
 *
 * Reports only unless `?write=1`, so the job can be scheduled and watched for
 * a night before it is armed. Refuses to blank any store that currently
 * publishes a menu; see decideCatalogWrite.
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/rebuild-customer-catalog] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const write = new URL(request.url).searchParams.get("write") === "1";

  try {
    const summary = await sweepCustomerCatalogs(getAdminDb(), { write });
    console.log(
      `[cron/rebuild-customer-catalog] write=${write} stores=${summary.totalStores} written=${summary.written} skipped=${summary.skipped} failed=${summary.failed}`,
    );
    return NextResponse.json({ ok: true, write, ...summary });
  } catch (err: any) {
    console.error("[cron/rebuild-customer-catalog] failed:", err);
    return NextResponse.json({ error: err?.message || "Catalog sweep failed." }, { status: 500 });
  }
}
