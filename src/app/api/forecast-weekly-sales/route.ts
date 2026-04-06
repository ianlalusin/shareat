import { forecastWeeklySales } from "@/ai/flows/forecast-weekly-sales";
import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
    }

    await getAdminAuth().verifyIdToken(match[1]);

    const input = await request.json();
    const result = await forecastWeeklySales(input);
    return NextResponse.json(result);
  } catch (e: any) {
    if (e?.code === "auth/id-token-expired" || e?.code === "auth/argument-error") {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
    }
    console.error("[api/forecast-weekly-sales] failed:", e);
    return NextResponse.json(
      { error: e.message || "An unexpected error occurred while generating the forecast." },
      { status: 500 }
    );
  }
}
