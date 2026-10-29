import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function authStore(req: Request, storeId: string) {
  const authz = req.headers.get("authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("Missing Authorization Bearer token.");
  const decoded = await getAdminAuth().verifyIdToken(m[1], true);
  const db = getAdminDb();
  await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);
  return db;
}

/**
 * Per-store option availability overlay (see lib/server/option-overrides.ts).
 * GET ?storeId=... returns the disabled sets; PUT replaces them.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    if (!storeId) return bad("storeId is required.");
    const db = await authStore(req, storeId);

    const snap = await db.doc(`stores/${storeId}/optionOverrides/main`).get();
    const d = (snap.exists ? snap.data() : {}) as any;
    return NextResponse.json({
      ok: true,
      disabledGroupIds: Array.isArray(d?.disabledGroupIds) ? d.disabledGroupIds.map(String) : [],
      disabledValueKeys: Array.isArray(d?.disabledValueKeys) ? d.disabledValueKeys.map(String) : [],
    });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|no access|not a staff|not active|token/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return bad("storeId is required.");
    const db = await authStore(req, storeId);

    const disabledGroupIds = Array.from(
      new Set((Array.isArray(body?.disabledGroupIds) ? body.disabledGroupIds : []).map((x: any) => String(x)))
    );
    const disabledValueKeys = Array.from(
      new Set((Array.isArray(body?.disabledValueKeys) ? body.disabledValueKeys : []).map((x: any) => String(x)))
    );

    await db.doc(`stores/${storeId}/optionOverrides/main`).set({
      storeId,
      disabledGroupIds,
      disabledValueKeys,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, disabledGroupIds, disabledValueKeys });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|no access|not a staff|not active|token/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
