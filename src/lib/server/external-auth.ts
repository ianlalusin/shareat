import "server-only";

import { NextResponse } from "next/server";

export function validateExternalApiKey(request: Request): NextResponse | null {
  const apiKey = request.headers.get("x-api-key")?.trim();
  const expected = process.env.POS_EXTERNAL_API_KEY?.trim();

  if (!expected) {
    console.error("[external-auth] POS_EXTERNAL_API_KEY env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  if (!apiKey || apiKey !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null; // auth passed
}
