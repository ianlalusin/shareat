import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Returns the active option groups attached to a product. For variant-kind
 * products, modifiers are inherited from the parent group product. The cashier
 * modifier picker calls this when the user clicks Add to Order so it knows
 * whether to open the picker and what to show.
 *
 * Auth: any active staff member (cashier needs this; it's read-only).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin", "manager", "cashier", "kitchen", "server"]);

    const productSnap = await db.doc(`products/${id}`).get();
    if (!productSnap.exists) return NextResponse.json({ ok: true, optionGroups: [] });
    const product = productSnap.data() as any;

    // Pull from the parent if this product is a variant.
    let ids: string[] = Array.isArray(product?.optionGroupIds) ? product.optionGroupIds : [];
    if ((product?.kind === "variant") && product?.groupId) {
      const parentSnap = await db.doc(`products/${product.groupId}`).get();
      if (parentSnap.exists) {
        const parent = parentSnap.data() as any;
        const parentIds: string[] = Array.isArray(parent?.optionGroupIds) ? parent.optionGroupIds : [];
        ids = Array.from(new Set([...parentIds, ...ids]));
      }
    }

    if (ids.length === 0) return NextResponse.json({ ok: true, optionGroups: [] });

    // Batched getAll keeps this to one round-trip.
    const refs = ids.map((gid) => db.doc(`optionGroups/${gid}`));
    const snaps = await db.getAll(...refs);
    const groups = snaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, ...(s.data() as any) }))
      .filter((g) => g.isActive !== false && g.isArchived !== true)
      // Preserve attachment order.
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    return NextResponse.json({ ok: true, optionGroups: groups });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
