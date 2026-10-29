import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import {
  createPaymentConversionServer,
  voidPaymentConversionServer,
} from "@/lib/server/analytics/applyPaymentConversionServer";

export const runtime = "nodejs";

/**
 * Server-side payment conversion (create / void). A conversion is a net-zero
 * reshuffle of the day's payment mix; the write touches the locked analytics
 * collections, so it runs admin-side. The conversion doc + byMethod delta are
 * written atomically in one transaction. `uid`/`role` are taken from the token;
 * `actorName` is display metadata only.
 */
function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    throw new Error("Invalid token.");
  }
}

function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
    /must be|are required|must differ|not found/i.test(message) ? 400 :
    500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const action = String(body.action || "");
  if (!storeId || !action) return bad("Missing storeId or action.");
  if (action !== "create" && action !== "void") return bad(`Unsupported action '${action}'.`);

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    const access = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);

    if (action === "create") {
      const actorName = String(body.actorName || "").trim() || "Unknown";
      const id = await createPaymentConversionServer(
        db,
        storeId,
        {
          amount: Number(body.amount),
          fromMethod: String(body.fromMethod || ""),
          toMethod: String(body.toMethod || ""),
          note: body.note ?? null,
        },
        { uid: decoded.uid, name: actorName, role: access.role },
        new Date(),
      );
      return NextResponse.json({ ok: true, id });
    }

    // action === "void"
    const conversionId = String(body.conversionId || "");
    if (!conversionId) return bad("Missing conversionId.");
    const actorName = String(body.actorName || "").trim() || "Unknown";
    const result = await voidPaymentConversionServer(
      db,
      storeId,
      conversionId,
      { uid: decoded.uid, name: actorName },
      new Date(),
    );
    return NextResponse.json({ ok: true, skipped: result.skipped });
  } catch (e) {
    return mapError(e);
  }
}
