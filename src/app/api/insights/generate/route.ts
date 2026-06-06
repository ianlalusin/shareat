import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { generateDailyInsightForStore, getInsightDayId } from "@/lib/server/generate-daily-insight";

export const runtime = "nodejs";
export const maxDuration = 120;

// Cooldown so a manager can't burn Gemini calls by spamming Regenerate.
const COOLDOWN_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });

    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const body = await request.json().catch(() => ({}));
    const storeId = String(body?.storeId || "");
    const force = body?.force === true;
    if (!storeId) return NextResponse.json({ error: "storeId is required." }, { status: 400 });

    const adminDb = getAdminDb();
    await requireStaffStoreAccess(adminDb, decoded, storeId, ["admin", "manager"]);

    const dayId = getInsightDayId();
    const insightRef = adminDb.doc(`stores/${storeId}/aiInsights/${dayId}`);
    const existing = await insightRef.get();

    // Serve cached unless forced past cooldown.
    if (existing.exists) {
      const data = existing.data() as any;
      const ageMs = Date.now() - Number(data?.generatedAtMs ?? 0);
      if (!force || ageMs < COOLDOWN_MS) {
        return NextResponse.json({
          ok: true,
          cached: true,
          dayId,
          status: data?.status ?? "ok",
          cooldownMsLeft: force ? Math.max(0, COOLDOWN_MS - ageMs) : 0,
        });
      }
    }

    const storeSnap = await adminDb.doc(`stores/${storeId}`).get();
    const storeName = (storeSnap.data() as any)?.name || storeId;

    const result = await generateDailyInsightForStore({ id: storeId, name: storeName }, "manual");
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Insight generation failed." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, cached: false, dayId, status: result.status });
  } catch (e: any) {
    const message = e?.message || "Failed to generate insight.";
    const status =
      /Missing bearer token|verifyIdToken|Invalid token/i.test(message) ? 401 :
      /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
      /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
