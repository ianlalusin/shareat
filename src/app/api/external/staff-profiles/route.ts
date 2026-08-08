import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";

export const runtime = "nodejs";

// External read: the store's device-local staff profiles (cashier/server/kitchen
// sign-ins). Powers the ERP's POS↔staff mapping picker. Auth + per-store scope
// mirror the other /api/external/* endpoints.
//   GET /api/external/staff-profiles?storeId=<id>
export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });

  try {
    const db = getAdminDb();
    const snap = await db.collection(`stores/${storeId}/serverProfiles`).get();
    const profiles = snap.docs
      .map((d) => ({ profileId: d.id, name: String((d.data() as any)?.name ?? "").trim() }))
      .filter((p) => p.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ storeId, profiles });
  } catch (err: any) {
    console.error("[external/staff-profiles] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch staff profiles." }, { status: 500 });
  }
}
