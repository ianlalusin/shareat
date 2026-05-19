import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Counts how many `stores/{storeId}/inventory` records reference each given productId.
 * Used by the product-merge dialog as a read-only pre-flight check so the operator
 * can see how many stores actively stock each candidate before confirming the merge.
 */
export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin"]);

    const body = (await req.json().catch(() => ({}))) as { productIds?: string[] };
    const productIds = Array.isArray(body.productIds) ? body.productIds.map((v) => String(v)).filter(Boolean) : [];
    if (productIds.length === 0) return NextResponse.json({ ok: true, counts: {} });

    // Use a collection-group query per id. Firestore "in" supports up to 30 values,
    // so for typical merge sizes (2-10 products) one query covers everything. We
    // batch in chunks of 30 to be safe.
    const counts: Record<string, number> = {};
    for (const id of productIds) counts[id] = 0;

    const chunks: string[][] = [];
    for (let i = 0; i < productIds.length; i += 30) chunks.push(productIds.slice(i, i + 30));

    for (const chunk of chunks) {
      const q = await db
        .collectionGroup("inventory")
        .where("productId", "in", chunk)
        .where("isActive", "==", true)
        .get();
      for (const d of q.docs) {
        const pid = String((d.data() as any)?.productId || "");
        if (pid && counts[pid] != null) counts[pid] += 1;
      }
    }

    return NextResponse.json({ ok: true, counts });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
