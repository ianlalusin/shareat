/**
 * One-time cleanup: null out per-store inventory photos that are just COPIES of
 * the global product photo.
 *
 * `stores/{storeId}/inventory/{itemId}.imageUrl` is a PURE OVERRIDE: null or
 * absent means "this store has no photo of its own, show the global
 * products/{id}.imageUrl", and non-null means "this store deliberately has its
 * own photo." Every display surface now resolves
 * `inventoryItem.imageUrl ?? product.imageUrl`, so nothing needs to be copied.
 *
 * Two old code paths in /manager/inventory violated that and are now removed:
 *   - handleAddItems seeded `imageUrl: product.imageUrl || null` when a product
 *     was added to a store's inventory;
 *   - handleBackfill ("Backfill Data") copied the global photo into every
 *     inventory row that was missing one.
 *
 * Rows written by either path look identical to a deliberate local choice, so
 * they survive an admin promoting a different photo or rejecting the current
 * one — the store stays frozen on a stale picture nobody can see they "chose".
 * This script removes them.
 *
 * HEURISTIC — read this before running: a copy is identified as
 * `inventory.imageUrl === products/{productId}.imageUrl` (exact string match
 * against the CURRENT global value). That is the best available signal, because
 * it is exactly what the copy paths wrote. Consequences, both accepted:
 *   - a store that deliberately uploaded a photo which was later promoted to
 *     global is reset to "inherits the global photo" — the picture it displays
 *     does not change, only the reason it displays it, and it goes back to
 *     tracking the global photo (which is what promotion means);
 *   - a copy made BEFORE the global photo was later changed no longer matches
 *     and is left alone. Those rows are indistinguishable from a real local
 *     choice and are not guessed at.
 *
 * Rows whose imageUrl is empty/absent, or whose product is missing, are skipped.
 * `productPhotoRequests` docs are never touched — a row with a real pending or
 * approved submission has an imageUrl under productPhotos/, which never equals
 * the global value unless that same submission was promoted (the first case
 * above, which is correct to reset).
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 *
 *   npx tsx scripts/cleanup-copied-inventory-images.ts                # preview, all stores
 *   npx tsx scripts/cleanup-copied-inventory-images.ts --store=<id>   # preview, one store
 *   npx tsx scripts/cleanup-copied-inventory-images.ts --apply        # write
 *
 * AFTER APPLYING: republish the affected stores' catalogs so the public
 * storefront and customer-app snapshots pick the images up through the
 * fallback instead of the (now removed) copies — /manager/inventory's
 * "Rebuild Storefront" button, or POST /api/admin/storefront-catalog and
 * /api/admin/customer-catalog-cache with {op:"rebuild", storeId}.
 *
 * Credentials: FIREBASE_ADMIN_SA_PATH from .env.local, same as the repo's other
 * admin scripts. NOTE that this points at PRODUCTION — read-only until --apply.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
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
  console.log(`[admin] firebase project: ${parsed.project_id}`);
}

initAdmin();
const db = getFirestore();

async function main() {
  console.log(APPLY ? "MODE: APPLY (writes)" : "MODE: DRY RUN (no writes) — pass --apply to write");

  // --- The global photo for every product, keyed by productId. ---
  const productsSnap = await db.collection("products").get();
  const globalImageById = new Map<string, string>();
  for (const d of productsSnap.docs) {
    const url = (d.data() as any)?.imageUrl;
    if (typeof url === "string" && url) globalImageById.set(d.id, url);
  }
  console.log(`Products scanned: ${productsSnap.size} (${globalImageById.size} with a global photo)`);

  const storesSnap = await db.collection("stores").get();
  const stores = storesSnap.docs.filter((d) => !ONLY_STORE || d.id === ONLY_STORE);
  if (ONLY_STORE && stores.length === 0) {
    console.error(`Store ${ONLY_STORE} not found.`);
    process.exitCode = 1;
    return;
  }

  let grandTotal = 0;
  let grandKept = 0;

  for (const store of stores) {
    const invSnap = await db.collection(`stores/${store.id}/inventory`).get();

    const toClear: { ref: FirebaseFirestore.DocumentReference; name: string }[] = [];
    let keptLocal = 0;

    for (const d of invSnap.docs) {
      const x = d.data() as any;
      const local = x?.imageUrl;
      if (typeof local !== "string" || !local) continue; // already "no photo of its own"

      const productId = String(x?.productId || "");
      const global = productId ? globalImageById.get(productId) : undefined;

      if (global && local === global) {
        toClear.push({ ref: d.ref, name: String(x?.name || d.id) });
      } else {
        // A genuine local photo (or a stale copy we cannot prove is a copy).
        keptLocal++;
      }
    }

    const name = (store.data() as any)?.name || store.id;
    console.log(
      `  ${name} (${store.id}): ${toClear.length} copied of ${invSnap.size} rows` +
        ` — ${keptLocal} row(s) keep a distinct local photo`
    );
    for (const t of toClear.slice(0, 10)) console.log(`      · ${t.name}`);
    if (toClear.length > 10) console.log(`      · ...and ${toClear.length - 10} more`);

    grandTotal += toClear.length;
    grandKept += keptLocal;

    if (!APPLY || toClear.length === 0) continue;

    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < toClear.length; i += 400) {
      const batch = db.batch();
      for (const t of toClear.slice(i, i + 400)) {
        batch.update(t.ref, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
    console.log(`    committed ${toClear.length}`);
  }

  console.log(
    APPLY
      ? `\nDone. ${grandTotal} copied photo(s) cleared; ${grandKept} distinct local photo(s) left alone.` +
          `\nRemember to republish the affected stores' storefront / customer catalogs.`
      : `\nDry run complete. ${grandTotal} copied photo(s) WOULD be cleared; ${grandKept} distinct local photo(s) would be left alone.` +
          `\nRe-run with --apply to write.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
