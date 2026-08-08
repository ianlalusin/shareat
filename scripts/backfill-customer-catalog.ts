/**
 * One-time migration: fold the standalone `catalogItems` (Customer App
 * Catalog) system into the same per-store inventory record that already
 * drives Online availability.
 *
 * Customer app availability used to live on a separate global `catalogItems`
 * doc, optionally linked to a POS product via `linkedPosProductId`, with any
 * per-store override baked directly into `stores/{storeId}/catalogCache/main`.
 * It is now per-branch and OPT-IN on the store's own inventory record,
 * stores/{storeId}/inventory/{productId}.customerEnabled, exactly like
 * `onlineEnabled`. Without this backfill the customer app would go empty the
 * moment the new inventory-sourced builder (`rebuildCustomerCatalog`) ships.
 *
 * Only `catalogItems` with a `linkedPosProductId` can migrate — the unified
 * model requires every customer-app item to be a real POS product. Anything
 * else, or anything whose resolved price is 0/negative (which would now mean
 * "withheld" instead of "free"), is reported instead of silently dropped or
 * mis-migrated.
 *
 * Price mapping: if the catalog item's effective price already equals the
 * store's `sellingPrice`, `customerPrice` is left unset (null) so it keeps
 * tracking the store price going forward. Otherwise the exact current price
 * is written as an explicit override, so nothing changes for a customer
 * mid-migration.
 *
 * Dry run by default. Nothing is written without --commit.
 *
 *   npx tsx scripts/backfill-customer-catalog.ts                  # preview, all stores
 *   npx tsx scripts/backfill-customer-catalog.ts --store=<id>     # preview, one store
 *   npx tsx scripts/backfill-customer-catalog.ts --commit         # apply
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const ONLY_STORE = (args.find((a) => a.startsWith("--store=")) || "").split("=")[1] || "";

// Same credential bootstrap as the repo's other admin scripts.
function initAdmin() {
  if (getApps().length) return;
  const serviceAccountPath = process.env.FIREBASE_ADMIN_SA_PATH;
  if (!serviceAccountPath) {
    console.error("\n❌ FIREBASE_ADMIN_SA_PATH is not set (checked .env.local).");
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
  initializeApp({
    credential: cert({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
    }),
  });
}

initAdmin();
const db = getFirestore();

async function main() {
  console.log(COMMIT ? "MODE: COMMIT (writes)" : "MODE: DRY RUN (no writes) — pass --commit to apply");

  // --- Global catalogItems: the source system being retired. ---
  const catalogSnap = await db.collection("catalogItems").get();
  const catalogItems = catalogSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const linked = catalogItems.filter((c) => !!c.linkedPosProductId && c.isArchived !== true);
  const unlinked = catalogItems.filter((c) => !c.linkedPosProductId && c.isArchived !== true);

  console.log(`catalogItems scanned: ${catalogItems.length}`);
  console.log(`  linked to a POS product: ${linked.length}`);
  console.log(`  NOT linked (cannot auto-migrate): ${unlinked.length}`);
  if (unlinked.length > 0) {
    console.log("\n⚠️  These catalogItems have no linkedPosProductId and will NOT migrate.");
    console.log("    They need a matching real product created first, or will disappear from the customer app:");
    for (const c of unlinked) console.log(`    - ${c.id}: "${c.name}" (category: ${c.category || "—"}, price: ${c.price ?? "—"})`);
  }

  if (linked.length === 0) {
    console.log("\nNothing linked to migrate.");
    return;
  }

  // --- Apply per store. ---
  const storesSnap = await db.collection("stores").get();
  const stores = storesSnap.docs.filter((d) => !ONLY_STORE || d.id === ONLY_STORE);
  if (ONLY_STORE && stores.length === 0) {
    console.error(`Store ${ONLY_STORE} not found.`);
    process.exitCode = 1;
    return;
  }

  let grandMigrated = 0;
  let grandNoInventory = 0;
  let grandNeedsReview: { storeId: string; catalogItemId: string; name: string; price: number }[] = [];

  for (const store of stores) {
    const storeName = (store.data() as any)?.name || store.id;

    const cacheSnap = await db.doc(`stores/${store.id}/catalogCache/main`).get();
    const cacheData = cacheSnap.exists ? (cacheSnap.data() as any) : null;
    const cacheById = new Map<string, any>();
    for (const it of Array.isArray(cacheData?.items) ? cacheData.items : []) {
      const id = String(it?.id || "");
      if (id) cacheById.set(id, it);
    }

    let migrated = 0;
    let noInventory = 0;
    const needsReview: typeof grandNeedsReview = [];
    const batchWrites: { ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }[] = [];

    for (const c of linked) {
      const productId = String(c.linkedPosProductId);
      const invRef = db.doc(`stores/${store.id}/inventory/${productId}`);
      const invSnap = await invRef.get();
      if (!invSnap.exists) {
        noInventory++;
        continue;
      }
      const inv = invSnap.data() as any;

      const cacheItem = cacheById.get(c.id);
      const effectiveAvailable = cacheItem ? cacheItem.isAvailable !== false : c.isAvailable !== false;
      const effectivePrice = Number(cacheItem?.price ?? c.price ?? 0);

      if (!effectiveAvailable) {
        // Was hidden at this store already — carry that forward, no price ambiguity.
        batchWrites.push({ ref: invRef, data: { customerEnabled: false } });
        migrated++;
        continue;
      }

      if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
        // A 0/negative customerPrice now means WITHHELD, the opposite of what
        // was actually shown — needs a human to pick a real price.
        needsReview.push({ storeId: store.id, catalogItemId: c.id, name: String(c.name || ""), price: effectivePrice });
        continue;
      }

      const sellingPrice = Number(inv.sellingPrice ?? 0);
      const customerPrice = effectivePrice === sellingPrice ? null : effectivePrice;

      batchWrites.push({ ref: invRef, data: { customerEnabled: true, customerPrice } });
      migrated++;
    }

    console.log(
      `  ${storeName} (${store.id}): ${migrated} to migrate, ${noInventory} not carried in inventory, ${needsReview.length} need manual price review`
    );
    for (const r of needsReview) {
      console.log(`      - "${r.name}" (catalogItems/${r.catalogItemId}): resolved price ${r.price} — pick a real customerPrice manually after cutover.`);
    }

    grandMigrated += migrated;
    grandNoInventory += noInventory;
    grandNeedsReview.push(...needsReview);

    if (!COMMIT || batchWrites.length === 0) continue;

    for (let i = 0; i < batchWrites.length; i += 400) {
      const batch = db.batch();
      for (const w of batchWrites.slice(i, i + 400)) {
        batch.update(w.ref, { ...w.data, updatedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
    console.log(`    committed ${batchWrites.length}`);
  }

  console.log(
    COMMIT
      ? `\nDone. ${grandMigrated} inventory rows updated.`
      : `\nDry run complete. ${grandMigrated} rows WOULD be updated. Re-run with --commit to apply.`
  );
  if (grandNoInventory > 0) {
    console.log(`${grandNoInventory} linked-item/store combinations were skipped — that store never carries the product in its inventory.`);
  }
  if (grandNeedsReview.length > 0) {
    console.log(`${grandNeedsReview.length} item/store combinations need a manual price decision (see "need manual price review" above).`);
  }
  if (unlinked.length > 0) {
    console.log(`${unlinked.length} catalogItems have no linked POS product and were not touched at all (see list above).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
