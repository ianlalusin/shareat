import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";
import { getDisplayName, getEffectiveVariantLabel } from "@/lib/products/variants";

export const runtime = "nodejs";

// External read: this store's sellable catalogue (stores/{storeId}/inventory).
//
// Companion to /api/external/sold-items, which only ever reports what actually
// sold on a given date. The ERP's mapping screen needs the full catalogue —
// you map a POS item to an ERP stock item BEFORE the first pull, including
// items that have never sold — so the two are deliberately separate endpoints
// rather than one with an optional `date`.
//
// Archived items are excluded (they can't be sold again); inactive ones are
// returned WITH their flag so an existing mapping to a temporarily-disabled
// item still resolves and displays correctly.
//   GET /api/external/inventory-items?storeId=<id>
export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });

  try {
    const db = getAdminDb();
    const snap = await db.collection(`stores/${storeId}/inventory`).get();

    const items = snap.docs
      .map((d) => {
        const x = d.data() as any;
        return {
          posItemId: d.id,
          posProductId: String(x.productId ?? "") || null,
          // Variant-qualified — several items share a base name and differ only
          // by variant, so the bare name is ambiguous in a mapping picker.
          name: getDisplayName(x).trim() || d.id,
          baseName: String(x.name ?? "").trim() || d.id,
          variantLabel: getEffectiveVariantLabel(x) || null,
          category: String(x.category ?? "").trim() || null,
          subCategory: String(x.subCategory ?? "").trim() || null,
          barcode: String(x.barcode ?? "").trim() || null,
          uom: String(x.uom ?? "").trim() || null,
          sellingPrice: Number(x.sellingPrice) || 0,
          isActive: x.isActive !== false,
          isAddon: x.isAddon === true,
          isArchived: x.isArchived === true,
        };
      })
      .filter((i) => !i.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ storeId, count: items.length, items });
  } catch (err: any) {
    console.error("[external/inventory-items] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch inventory items." }, { status: 500 });
  }
}
