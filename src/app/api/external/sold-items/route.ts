import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";
import { aggregateSoldItems, type ReceiptLite } from "@/lib/analytics/sold-items-core";
import { getDisplayName, getEffectiveVariantLabel } from "@/lib/products/variants";

export const runtime = "nodejs";

// External read: per-item sold quantities for ONE store + day, keyed by the
// store's own inventory doc id. Consumed by the ERP's inventory-usage pull,
// which maps posItemId → its own stock item and posts the consumption as a
// usage record (so selling 3 Cokes deducts 3 Cokes from ERP stock).
//
// Derived from a bounded receipts scan rather than the pre-aggregated
// analytics day doc — see the header of sold-items-core.ts for why (stable ids,
// correct refund netting, and comped units kept separate).
//
// Returns THREE quantity flavours per item and lets the ERP decide which to
// deduct: `physicalQty` (what left stock), `billableQty` (what was charged for),
// and `freeQty` (comped). Keeping that choice on the ERP side means changing it
// never needs a POS redeploy.
//   GET /api/external/sold-items?storeId=<id>&date=YYYY-MM-DD
export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  const date = searchParams.get("date");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Missing or invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }

  // Manila (UTC+8, no DST) calendar-day ms window — same convention as the
  // analytics day split and the staff-metrics scan.
  const startMs = Date.parse(`${date}T00:00:00+08:00`);
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

  try {
    const db = getAdminDb();
    const [receiptsSnap, inventorySnap] = await Promise.all([
      db.collection(`stores/${storeId}/receipts`)
        .where("createdAtClientMs", ">=", startMs)
        .where("createdAtClientMs", "<=", endMs)
        .get(),
      db.collection(`stores/${storeId}/inventory`).get(),
    ]);

    const agg = aggregateSoldItems(receiptsSnap.docs.map((d) => d.data() as ReceiptLite));

    // Enrich from the inventory master. The master is preferred over the line
    // snapshot: the line is frozen at order time, the master is what a manager
    // sees today when mapping it in the ERP.
    //
    // `name` MUST be the variant-qualified display name, not the bare master
    // name — several real items share a base name and differ only by variant
    // ("Add On (Enoki Mushroom)" vs "Add On (Enoki Roll Pork)", "Sharebowl
    // (Chicken)" vs "(Pork)"). Returning the bare name would render two
    // indistinguishable rows in the ERP mapping UI and give its name matcher
    // nothing to work with. Reuses POS's own getDisplayName so the format stays
    // identical to what the cashier and the day doc show.
    const inventoryById = new Map(inventorySnap.docs.map((d) => [d.id, d.data() as any]));

    const items = agg.items.map((a) => {
      const inv = inventoryById.get(a.posItemId);
      return {
        posItemId: a.posItemId,
        posProductId: inv ? (String(inv.productId ?? "") || null) : null,
        name: (inv ? getDisplayName(inv).trim() : "") || a.itemName || a.posItemId,
        /** Bare master name, variant stripped — for grouping/secondary matching. */
        baseName: (inv ? String(inv.name ?? "").trim() : "") || a.itemName || a.posItemId,
        variantLabel: inv ? (getEffectiveVariantLabel(inv) || null) : null,
        category: (inv ? String(inv.category ?? "").trim() || null : null) ?? a.category,
        subCategory: inv ? (String(inv.subCategory ?? "").trim() || null) : null,
        barcode: (inv ? String(inv.barcode ?? "").trim() || null : null) ?? a.barcode,
        uom: inv ? (String(inv.uom ?? "").trim() || null) : null,
        isActive: inv ? inv.isActive !== false : false,
        isArchived: inv ? inv.isArchived === true : false,
        /** No inventory doc backs this id — it sold, but the catalogue entry is gone. */
        inventoryMissing: !inv,
        billableQty: a.billableQty,
        physicalQty: a.physicalQty,
        freeQty: a.freeQty,
        voidedQty: a.voidedQty,
        grossAmount: Math.round(a.grossAmount * 100) / 100,
      };
    });

    return NextResponse.json({
      storeId,
      date,
      // A day with zero receipts is a legitimate empty result, not an error —
      // the ERP renders "0 receipts on this date" rather than failing the pull.
      found: agg.receiptCount > 0,
      receiptCount: agg.receiptCount,
      refundReceiptCount: agg.refundReceiptCount,
      voidedReceiptCount: agg.voidedReceiptCount,
      skippedSyntheticLines: agg.skippedSyntheticLines,
      items,
    });
  } catch (err: any) {
    console.error("[external/sold-items] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch sold items." }, { status: 500 });
  }
}
