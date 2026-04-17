import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateExternalApiKey } from "@/lib/server/external-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = validateExternalApiKey(request);
  if (authError) return authError;

  try {
    const db = getAdminDb();
    const snap = await db.collection("stores").where("isActive", "==", true).get();

    const stores = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name ?? "",
        address: data.address ?? "",
      };
    });

    return NextResponse.json({ stores });
  } catch (err: any) {
    console.error("[external/stores] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch stores." }, { status: 500 });
  }
}
