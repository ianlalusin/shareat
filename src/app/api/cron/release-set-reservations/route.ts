import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActiveStores } from "@/lib/server/active-stores-cache";
import { releaseSetReservationsForStore } from "@/lib/server/release-set-reservations";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Website set reservations go to the kitchen screen 2 hours before their
 * requested time (confirmed orders only). Scheduled by Google Cloud Scheduler
 * every 10 minutes with header Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/release-set-reservations] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if ((request.headers.get("authorization") || "") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const db = getAdminDb();
    const stores = await getActiveStores(db);
    const nowMs = Date.now();
    let released = 0;
    let skipped = 0;
    for (const s of stores) {
      const r = await releaseSetReservationsForStore(db, s.id, nowMs);
      released += r.released;
      skipped += r.skipped;
    }
    if (released) console.log(`[cron/release-set-reservations] released=${released} skipped=${skipped}`);
    return NextResponse.json({ ok: true, totalStores: stores.length, released, skipped });
  } catch (err: any) {
    console.error("[cron/release-set-reservations] failed:", err);
    return NextResponse.json({ error: err?.message || "Release failed." }, { status: 500 });
  }
}
