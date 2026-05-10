import { forecastWeeklySales } from "@/ai/flows/forecast-weekly-sales";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
    }

    const input = await request.json();
    const storeId = String(input?.storeId || "");
    if (!storeId) {
      return NextResponse.json({ error: "storeId is required." }, { status: 400 });
    }

    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    await requireStaffStoreAccess(getAdminDb(), decoded, storeId, ["admin", "manager"]);

    const result = await forecastWeeklySales(input);
    return NextResponse.json(result);
  } catch (e: any) {
    if (
      e?.code === "auth/id-token-expired" ||
      e?.code === "auth/argument-error" ||
      /verifyIdToken|Invalid token/i.test(e?.message || "")
    ) {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
    }
    if (/not allowed|No access|Not a staff member|Staff not active/i.test(e?.message || "")) {
      return NextResponse.json({ error: e.message || "Forbidden." }, { status: 403 });
    }
    console.error("[api/forecast-weekly-sales] failed:", e);
    return NextResponse.json(
      { error: e.message || "An unexpected error occurred while generating the forecast." },
      { status: 500 }
    );
  }
}
