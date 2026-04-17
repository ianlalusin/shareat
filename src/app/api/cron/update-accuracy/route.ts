import { NextResponse } from "next/server";
import { updateAccuracyForAllActiveStores } from "@/lib/server/generate-forecast";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/update-accuracy] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await updateAccuracyForAllActiveStores();
    return NextResponse.json({
      ok: true,
      totalStores: result.totalStores,
      successCount: result.results.filter((r) => r.ok).length,
      failureCount: result.results.filter((r) => !r.ok).length,
      results: result.results,
    });
  } catch (err: any) {
    console.error("[cron/update-accuracy] failed:", err);
    return NextResponse.json(
      { error: err.message || "Accuracy cron failed." },
      { status: 500 }
    );
  }
}
