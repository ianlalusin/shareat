import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { format, subDays } from "date-fns";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body.storeId || "");
  if (!storeId) return bad("Missing storeId.");
  const lookbackDays = Math.min(Math.max(1, Number(body.days) || 14), 60);

  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return bad("Not a staff member.", 403);
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return bad("Staff not active.", 403);

  const isAdmin = staffData.role === "admin" || decoded.platformAdmin === true;
  const isManagerWithAccess =
    staffData.role === "manager" &&
    Array.isArray(staffData.assignedStoreIds) &&
    staffData.assignedStoreIds.includes(storeId);
  if (!isAdmin && !isManagerWithAccess) {
    return bad("Admin or manager role required.", 403);
  }

  const now = new Date();
  const summary = {
    storeId,
    lookbackDays,
    scanned: 0,
    filled: 0,
    skippedAlreadySet: 0,
    skippedNoForecast: 0,
    skippedNoAnalytics: 0,
    skippedZeroSales: 0,
    details: [] as Array<{ date: string; action: string; accuracy?: number; actualSales?: number }>,
  };

  try {
    for (let i = 1; i <= lookbackDays; i++) {
      const day = subDays(now, i);
      const dateStr = format(day, "yyyy-MM-dd");
      const dayId = dateStr.replace(/-/g, "");
      summary.scanned++;

      const forecastRef = db.doc(`stores/${storeId}/salesForecasts/${dateStr}`);
      const forecastSnap = await forecastRef.get();
      if (!forecastSnap.exists) {
        summary.skippedNoForecast++;
        summary.details.push({ date: dateStr, action: "no_forecast" });
        continue;
      }
      const forecastData = forecastSnap.data() as any;
      if (forecastData?.accuracy != null) {
        summary.skippedAlreadySet++;
        continue;
      }

      const analyticsRef = db.doc(`stores/${storeId}/analytics/${dayId}`);
      const analyticsSnap = await analyticsRef.get();
      if (!analyticsSnap.exists) {
        summary.skippedNoAnalytics++;
        summary.details.push({ date: dateStr, action: "no_analytics" });
        continue;
      }
      const actualSales = analyticsSnap.data()?.payments?.totalGross ?? 0;
      if (actualSales <= 0) {
        summary.skippedZeroSales++;
        summary.details.push({ date: dateStr, action: "zero_sales" });
        continue;
      }

      const projected = forecastData?.projectedSales ?? 0;
      const denom = Math.max(actualSales, projected);
      const accuracy = denom > 0 ? 1 - Math.abs(actualSales - projected) / denom : 0;
      const clampedAccuracy = Math.max(0, Math.min(1, accuracy));

      await forecastRef.update({
        actualSales,
        accuracy: clampedAccuracy,
      });
      summary.filled++;
      summary.details.push({
        date: dateStr,
        action: "filled",
        accuracy: Math.round(clampedAccuracy * 1000) / 1000,
        actualSales,
      });
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[backfill-forecast-accuracy] failed:", err);
    return bad(err.message || "Backfill failed.", 500);
  }
}
