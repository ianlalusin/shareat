import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope } from "@/lib/server/external-auth";
import { getActiveStores } from "@/lib/server/active-stores-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  try {
    const db = getAdminDb();
    const activeStores = await getActiveStores(db);

    let stores = activeStores.map((s) => ({
      id: s.id,
      name: s.name ?? "",
      address: s.address ?? "",
    }));

    // A scoped key only sees its own stores; the global key sees all.
    if (scope.allowedStoreIds !== null) {
      const allow = new Set(scope.allowedStoreIds);
      stores = stores.filter((s) => allow.has(s.id));
    }

    // Matches the cap the direct query used to carry before it moved to the
    // shared active-stores cache (src/lib/server/active-stores-cache.ts).
    stores = stores.slice(0, 500);

    return NextResponse.json({ stores });
  } catch (err: any) {
    console.error("[external/stores] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch stores." }, { status: 500 });
  }
}
