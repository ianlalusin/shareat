import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope } from "@/lib/server/external-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  try {
    const db = getAdminDb();
    const snap = await db.collection("stores").where("isActive", "==", true).limit(500).get();

    let stores = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name ?? "",
        address: data.address ?? "",
      };
    });

    // A scoped key only sees its own stores; the global key sees all.
    if (scope.allowedStoreIds !== null) {
      const allow = new Set(scope.allowedStoreIds);
      stores = stores.filter((s) => allow.has(s.id));
    }

    return NextResponse.json({ stores });
  } catch (err: any) {
    console.error("[external/stores] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch stores." }, { status: 500 });
  }
}
