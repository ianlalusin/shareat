import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { finalizePinLogic } from "@/lib/server/finalize-pin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(match[1], true);
    const body = await request.json();
    const storeId = String(body?.storeId || "");
    const sessionId = String(body?.sessionId || "");
    const pin = body?.pin ? String(body.pin) : "";

    if (!storeId || !sessionId) {
      return NextResponse.json({ error: "storeId and sessionId are required." }, { status: 400 });
    }

    // Manual disable shares the exact finalize path — no internal HTTP hop.
    const result = await finalizePinLogic({ decoded, storeId, sessionId, pin, reason: "manual_disable" });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[api/pins/disable] failed:", e);
    const message = e?.message || "Failed to disable PIN.";
    const status =
      /Missing bearer token|verifyIdToken|Invalid token/i.test(message) ? 401 :
      /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
      /required|invalid/i.test(message) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
