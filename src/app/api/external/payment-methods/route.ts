import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });

  try {
    const db = getAdminDb();
    const methods = new Set<string>();

    // 1) The store's CONFIGURED modes of payment (source of truth — set up in
    // manager → collections). This is what makes a freshly-configured store
    // return its methods even before it has any sales.
    const modesSnap = await db
      .collection(`stores/${storeId}/storeModesOfPayment`)
      .where("isArchived", "==", false)
      .get();
    modesSnap.docs.forEach((d) => {
      const name = d.data()?.name;
      if (typeof name === "string" && name.trim()) methods.add(name.trim());
    });

    // 2) Plus any method names that actually appear in the last 14 days of
    // sales analytics — covers legacy/renamed modes no longer in the config.
    const snap = await db.collection(`stores/${storeId}/analytics`)
      .orderBy("meta.dayStartMs", "desc")
      .limit(14)
      .get();
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
