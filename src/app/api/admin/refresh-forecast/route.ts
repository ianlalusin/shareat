import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { generateForecastForStore } from "@/lib/server/generate-forecast";

export const runtime = "nodejs";
export const maxDuration = 300;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded: any;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }

  const uid = decoded.uid;
  if (!uid) return bad("Invalid token.", 401);

  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return bad("Not a staff member.", 403);
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return bad("Staff not active.", 403);

  const isAdmin = staffData.role === "admin" || decoded.platformAdmin === true;
  if (!isAdmin) return bad("Admin role required.", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body.storeId || "");
  if (!storeId) return bad("Missing storeId.");

  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) return bad("Store not found.", 404);
  const storeData = storeSnap.data() as any;

  try {
    const result = await generateForecastForStore({
      id: storeId,
      address: storeData.address,
      isActive: storeData.isActive,
      forecastConfig: storeData.forecastConfig,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[admin/refresh-forecast] failed:", err);
    return bad(err.message || "Forecast refresh failed.", 500);
  }
}
