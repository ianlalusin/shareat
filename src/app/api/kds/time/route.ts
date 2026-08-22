import { NextResponse } from "next/server";

/**
 * The server's clock, for the KDS to measure its own drift against.
 *
 * Deliberately unauthenticated and free of any read: it discloses nothing but
 * the current time, which every HTTP `Date` header already carries. Going
 * through a route rather than that header buys millisecond precision — the
 * header is whole seconds, which is half the resolution of the timer it
 * corrects.
 *
 * Must never be cached; a cached clock is worse than no clock.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { serverMs: Date.now() },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
