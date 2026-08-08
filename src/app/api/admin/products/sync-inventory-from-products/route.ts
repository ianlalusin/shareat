import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Backfill endpoint: walks all per-store InventoryItem records and writes the
 * family metadata (kind / groupId / groupName / name / variantLabel) from the
 * referenced Product. Required for the products that were merged before the
 * propagation logic was added to /api/admin/products/merge.
 *
 * Idempotent: safe to re-run. Only writes when at least one mirrored field
 * differs from the current InventoryItem value.
 */
export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin"]);

    const body = await req.json().catch(() => ({}));
    const onlyStoreId = body?.storeId ? String(body.storeId) : null;

    // 1) Collect target inventory snapshots (either one store or all stores).
    const inventoryRefs: FirebaseFirestore.DocumentReference[] = [];
    const inventoryData: Array<{
      ref: FirebaseFirestore.DocumentReference;
      data: any;
    }> = [];

    if (onlyStoreId) {
      const snap = await db.collection(`stores/${onlyStoreId}/inventory`).get();
      for (const d of snap.docs) {
        inventoryRefs.push(d.ref);
        inventoryData.push({ ref: d.ref, data: d.data() });
      }
    } else {
      const snap = await db.collectionGroup("inventory").get();
      for (const d of snap.docs) {
        // Defensive: skip docs that aren't actually under stores/*/inventory.
        if (!d.ref.path.startsWith("stores/")) continue;
        inventoryRefs.push(d.ref);
        inventoryData.push({ ref: d.ref, data: d.data() });
      }
    }

    // 2) Gather unique productIds and load them via getAll() in chunks.
    const productIds = Array.from(
      new Set(
        inventoryData
          .map((row) => String(row.data?.productId || ""))
          .filter((id) => id.length > 0)
      )
    );

    const productById = new Map<string, any>();
    for (let i = 0; i < productIds.length; i += 100) {
      const refs = productIds.slice(i, i + 100).map((id) => db.doc(`products/${id}`));
      const docs = await db.getAll(...refs);
      for (const d of docs) {
        if (d.exists) productById.set(d.id, d.data());
      }
    }

    const storeIds = new Set<string>();

    // 3) For each inventory record, compute its desired patch.
    let batch = db.batch();
    let pendingWrites = 0;
    let inventoryUpdated = 0;
    const flush = async () => {
      if (pendingWrites === 0) return;
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    };

    for (const { ref, data } of inventoryData) {
      // Track which stores were touched.
      const m = ref.path.match(/^stores\/([^/]+)\//);
      if (m) storeIds.add(m[1]);

      const productId = String(data?.productId || "");
      if (!productId) continue;
      const product = productById.get(productId);
      if (!product) continue;

      const productKind = product?.kind || "single";
      let desired: Record<string, any>;
      if (productKind === "variant") {
        desired = {
          kind: "variant",
          groupId: product?.groupId ?? null,
          groupName: product?.groupName ?? null,
          name: String(product?.name ?? data?.name ?? ""),
          variantLabel: product?.variantLabel ?? null,
        };
      } else if (productKind === "group") {
        // Group parents aren't sellable; clear family pointers and hide from picker.
        desired = {
          kind: "group",
          groupId: null,
          groupName: null,
          variantLabel: null,
          isAddon: false,
        };
      } else {
        // single
        desired = {
          kind: "single",
          groupId: null,
          groupName: null,
          variantLabel: data?.variantLabel ?? null, // preserve any legacy variant label
        };
      }

      // Only write if anything differs.
      const needsWrite = Object.entries(desired).some(([key, value]) => {
        return (data?.[key] ?? null) !== (value ?? null);
      });
      if (!needsWrite) continue;

      batch.update(ref, { ...desired, updatedAt: FieldValue.serverTimestamp() });
      pendingWrites += 1;
      inventoryUpdated += 1;
      if (pendingWrites >= 400) await flush();
    }
    await flush();

    return NextResponse.json({
      ok: true,
      storesScanned: storeIds.size,
      inventoryUpdated,
      inventoryReviewed: inventoryData.length,
    });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
