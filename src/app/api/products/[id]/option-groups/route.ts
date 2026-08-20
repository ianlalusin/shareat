import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { loadOptionOverrides, filterGroupsForStore } from "@/lib/server/option-overrides";
import { resolveOptionGroupIds } from "@/lib/server/catalog-shared";

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
    const url = new URL(req.url);
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin", "manager", "cashier", "kitchen", "server"]);

    // Read once, up front: both the attachment union below and the per-store
    // availability filter further down need it.
    const storeId = String(url.searchParams.get("storeId") || "").trim();

    const productSnap = await db.doc(`products/${id}`).get();
    if (!productSnap.exists) return NextResponse.json({ ok: true, optionGroups: [] });
    const product = productSnap.data() as any;

    // parent ∪ this product ∪ this store's own attachment — the same rule the
    // storefront and customer-app catalogs use. See catalog-shared.ts.
    let parent: any = null;
    if (product?.kind === "variant" && product?.groupId) {
      const parentSnap = await db.doc(`products/${product.groupId}`).get();
      if (parentSnap.exists) parent = parentSnap.data();
    }
    let inventoryRow: any = null;
    if (storeId) {
      const invSnap = await db.doc(`stores/${storeId}/inventory/${id}`).get();
      if (invSnap.exists) inventoryRow = invSnap.data();
    }
    const ids = resolveOptionGroupIds(product, parent, inventoryRow);

    if (ids.length === 0) return NextResponse.json({ ok: true, optionGroups: [] });

    // Batched getAll keeps this to one round-trip.
    const refs = ids.map((gid) => db.doc(`optionGroups/${gid}`));
    const snaps = await db.getAll(...refs);
    let groups = snaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, ...(s.data() as any) }))
      .filter((g) => g.isActive !== false && g.isArchived !== true)
      // Preserve attachment order.
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    // Per-store availability: a store can turn off whole groups or individual
    // values it doesn't carry (e.g. Malvar has no Cheese dip). No storeId means
    // "show everything", so non-cashier callers are unaffected.
    if (storeId) {
      const overrides = await loadOptionOverrides(db, storeId);
      groups = filterGroupsForStore(groups, overrides);
    }

    return NextResponse.json({ ok: true, optionGroups: groups });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
