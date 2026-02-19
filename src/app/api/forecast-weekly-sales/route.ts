import { forecastWeeklySales } from "@/ai/flows/forecast-weekly-sales";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const result = await forecastWeeklySales(input);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[api/forecast-weekly-sales] failed:", e);
    // Send a more structured error response
    return NextResponse.json(
      { error: e.message || "An unexpected error occurred while generating the forecast." },
      { status: 500 }
    );
  }
}
