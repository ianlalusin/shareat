/**
 * One-time migration: opt existing storefront items into per-branch online sale.
 *
 * Online availability used to be a single global flag, products/{id}.
 * showOnStorefront. It is now per-branch and OPT-IN on the store's own
 * inventory record, stores/{storeId}/inventory/{id}.onlineEnabled, and only an
 * explicit `true` publishes. Without this backfill the storefront would go
 * empty the moment the new catalog builder ships.
 *
 * RUN THIS BEFORE DEPLOYING THE NEW BUILDER. Writing `onlineEnabled: true` is a
 * no-op under the old code (which only ever skipped on an explicit `false`), so
 * the two can safely overlap in this order — but not the other way round.
 *
 * Which inventory rows get opted in mirrors exactly what the old builder
 * published:
 *   - a flagged SINGLE product  → that product's own inventory row;
 *   - a flagged GROUP (family)  → the inventory rows of its VARIANTS, since a
 *     family root has no inventory row of its own and published through its
 *     children;
 *   - a flagged product that is inactive or archived → nothing, it was not
 *     being published anyway.
 *
 * Dry run by default. Nothing is written without --commit.
 *
 *   npx tsx scripts/backfill-online-enabled.ts                  # preview, all stores
 *   npx tsx scripts/backfill-online-enabled.ts --store=<id>     # preview, one store
 *   npx tsx scripts/backfill-online-enabled.ts --commit         # apply
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

  // --- Which productIds were publishing under the old global flag? ---
  const productsSnap = await db.collection("products").get();
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const variantsByGroup = new Map<string, any[]>();
  for (const p of products) {
    if (p.kind === "variant" && p.groupId) {
      const arr = variantsByGroup.get(String(p.groupId)) || [];
      arr.push(p);
      variantsByGroup.set(String(p.groupId), arr);
    }
  }

  const live = (p: any) => p?.isActive !== false && p?.isArchived !== true;
  const targetProductIds = new Set<string>();

  for (const p of products) {
    if (p.showOnStorefront !== true) continue;
    if (!live(p)) continue;
    if (p.kind === "variant") continue; // published via its parent family

    if (p.kind === "group") {
      for (const v of variantsByGroup.get(String(p.id)) || []) {
        if (live(v)) targetProductIds.add(String(v.id));
      }
    } else {
      targetProductIds.add(String(p.id));
    }
  }

  console.log(`Flagged products scanned: ${products.length}`);
  console.log(`Inventory productIds to opt in: ${targetProductIds.size}`);
  if (targetProductIds.size === 0) {
    console.log("Nothing to do — no product carried showOnStorefront === true.");
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

  let grandTotal = 0;
  for (const store of stores) {
    const invSnap = await db.collection(`stores/${store.id}/inventory`).get();

    const toUpdate = invSnap.docs.filter((d) => {
      const x = d.data() as any;
      if (!targetProductIds.has(String(x?.productId || ""))) return false;
      if (x?.isActive === false || x?.isArchived === true) return false;
      return x?.onlineEnabled !== true; // already opted in — leave it alone
    });

    const name = (store.data() as any)?.name || store.id;
    console.log(`  ${name} (${store.id}): ${toUpdate.length} of ${invSnap.size} rows to opt in`);
    grandTotal += toUpdate.length;

    if (!COMMIT || toUpdate.length === 0) continue;

    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < toUpdate.length; i += 400) {
      const batch = db.batch();
      for (const d of toUpdate.slice(i, i + 400)) {
        batch.update(d.ref, { onlineEnabled: true, updatedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
    console.log(`    committed ${toUpdate.length}`);
  }

  console.log(
    COMMIT
      ? `\nDone. ${grandTotal} inventory rows opted in.`
      : `\nDry run complete. ${grandTotal} rows WOULD be opted in. Re-run with --commit to apply.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
