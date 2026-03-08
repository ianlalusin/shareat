import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const origin = new URL(request.url).origin;
    const authHeader = request.headers.get("authorization") || "";

    const res = await fetch(`${origin}/api/pins/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        ...body,
        reason: "manual_disable",
      }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    console.error("[api/pins/disable] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to disable PIN." },
      { status: 500 }
    );
  }
}
