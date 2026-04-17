import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateExternalApiKey } from "@/lib/server/external-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = validateExternalApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });

  try {
    const db = getAdminDb();
    // Get the last 14 days of analytics to collect all payment method names
    const snap = await db.collection(`stores/${storeId}/analytics`)
      .orderBy("meta.dayStartMs", "desc")
      .limit(14)
      .get();

    const methods = new Set<string>();
    snap.docs.forEach((d) => {
      const byMethod = d.data()?.payments?.byMethod ?? {};
      Object.keys(byMethod).forEach((m) => methods.add(m));
    });

    return NextResponse.json({
      storeId,
      methods: Array.from(methods).sort(),
    });
  } catch (err: any) {
    console.error("[external/payment-methods] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch payment methods." }, { status: 500 });
  }
}
