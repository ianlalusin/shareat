import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActiveStores } from "@/lib/server/active-stores-cache";
import { sweepStore } from "@/lib/server/pos-commands/reconcile";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Durable backstop for offline POS commands and the posEffects outbox (audit
 * B16/B17): applies offline commands a till recorded but never submitted, and
 * retries pending deferred effects. Scheduled by Google Cloud Scheduler with
 * header Authorization: Bearer ${CRON_SECRET} (every 5 minutes). See docs/CRON.md.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/reconcile-pos-commands] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if ((request.headers.get("authorization") || "") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const db = getAdminDb();
    const stores = await getActiveStores(db);
    const results: Array<{ storeId: string } & Awaited<ReturnType<typeof sweepStore>>> = [];
    for (const s of stores) results.push({ storeId: s.id, ...(await sweepStore(db, s.id, runPosEffect)) });
    return NextResponse.json({ ok: true, totalStores: stores.length, results });
  } catch (err: any) {
    console.error("[cron/reconcile-pos-commands] failed:", err);
    return NextResponse.json({ error: err?.message || "Sweep failed." }, { status: 500 });
  }
}
