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
 * Three old code paths violated that and are now removed/fixed:
 *   - /manager/inventory handleAddItems seeded `imageUrl: product.imageUrl ||
 *     null` when a product was added to a store's inventory;
 *   - /manager/inventory handleBackfill ("Backfill Data") copied the global
 *     photo into every inventory row that was missing one;
 *   - /api/product-requests approve seeded the auto-imported inventory row with
 *     the request's own `productRequestImages/...` upload — the same value it
 *     writes onto the new products/{id} doc.
 *
 * Rows written by any of those look identical to a deliberate local choice, so
 * they survive an admin promoting a different photo or rejecting the current
 * one — the store stays frozen on a stale picture nobody can see they "chose".
 * This script removes them.
 *
 * HEURISTIC — read this before running. A row is cleared when EITHER holds:
 *
 *   (1) `inventory.imageUrl` is not a `productPhotos/...` Storage URL.
 *       `productPhotos/{productId}/{storeId}/{uuid}.webp` (see
 *       uploadItemPhotoLocal in src/lib/firebase/client.ts) is the ONLY path a
 *       manager's deliberate local photo can come from — before that feature
 *       existed there was no manager photo-upload path at all. Every other
 *       value in this field was therefore written by one of the three copy
 *       paths above (`Items/...` from the admin's global upload, or
 *       `productRequestImages/...` from an approval), and is a copy regardless
 *       of whether it still matches the current global value.
 *
 *   (2) `inventory.imageUrl === products/{productId}.imageUrl` (exact match
 *       against the CURRENT global value) — the original heuristic, kept as
 *       belt-and-suspenders. It is what catches a genuine `productPhotos/`
 *       upload that was later PROMOTED to global: the store goes back to
 *       inheriting, which is exactly what promotion means. The displayed
 *       picture does not change, only the reason it displays it.
 *
 * (1) is the broadening, and it exists because leaving a stale copy behind is
 * no longer harmless. Two things changed under it:
 *   - the display fallback is now `inventoryItem.imageUrl ?? product.imageUrl`,
 *     so a local value WINS. A stale copy therefore overrides the global photo
 *     on the public storefront and in the customer app instead of falling back
 *     to it — the store shows an old picture nobody chose and no admin action
 *     can dislodge;
 *   - the admin's global upload path (uploadProductImage) writes a
 *     DETERMINISTIC `Items/{productId}.webp` and overwrites it in place on
 *     re-upload. A copy taken from an earlier global photo points at that same
 *     object, so once the admin changes the photo the copy either silently
 *     becomes the new picture or, if the object is ever removed, 404s into a
 *     broken image. Exact-match cannot catch these: by definition a stale copy
 *     no longer equals the current global value.
 *
 * Kept (NOT cleared): a `productPhotos/...` URL that differs from the current
 * global value — a manager's own photo, pending review or simply never
 * promoted. That is the one case this field is actually for.
 *
 * Rows whose imageUrl is empty/absent are skipped (already "no photo of its
 * own"). Rows whose product doc is missing are still cleared under (1) if their
 * URL is not a productPhotos/ one — a copy with no surviving product to inherit
 * from is still a copy, and null is the honest value.
 * `productPhotoRequests` docs are never touched.
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

/**
 * True when the URL points into the `productPhotos/` Storage path — i.e. it was
 * uploaded by a manager through the local item-photo feature
 * (uploadItemPhotoLocal → `productPhotos/{productId}/{storeId}/{uuid}.webp`).
 *
 * Both URL shapes the app accepts are matched: firebasestorage.googleapis.com
 * download URLs percent-encode the path separators (`productPhotos%2F...`),
 * while storage.googleapis.com URLs keep them literal. `productPhotos` itself
 * is matched case-sensitively because Storage object names are.
 */
function isManagerUploadedPhoto(url: string): boolean {
  return /productPhotos(\/|%2[Ff])/.test(url);
}

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
  let grandNotProductPhotos = 0;
  let grandMatchesGlobal = 0;

  for (const store of stores) {
    const invSnap = await db.collection(`stores/${store.id}/inventory`).get();

    const toClear: { ref: FirebaseFirestore.DocumentReference; name: string; why: string }[] = [];
    let keptLocal = 0;
    let notProductPhotos = 0;
    let matchesGlobal = 0;

    for (const d of invSnap.docs) {
      const x = d.data() as any;
      const local = x?.imageUrl;
      if (typeof local !== "string" || !local) continue; // already "no photo of its own"

      const productId = String(x?.productId || "");
      const global = productId ? globalImageById.get(productId) : undefined;
      const name = String(x?.name || d.id);

      // (1) Not a productPhotos/ URL → provably a copy from one of the removed
      //     copy paths, whether or not it still matches the global value.
      if (!isManagerUploadedPhoto(local)) {
        notProductPhotos++;
        toClear.push({ ref: d.ref, name, why: "not a productPhotos/ URL" });
        continue;
      }

      // (2) A real local upload that has since been promoted to global — put
      //     the store back on the global photo it is now tracking.
      if (global && local === global) {
        matchesGlobal++;
        toClear.push({ ref: d.ref, name, why: "promoted (equals the global photo)" });
        continue;
      }

      // A genuine, distinct local photo. This is what the field is for.
      keptLocal++;
    }

    const storeName = (store.data() as any)?.name || store.id;
    console.log(
      `  ${storeName} (${store.id}): ${toClear.length} copied of ${invSnap.size} rows` +
        ` (${notProductPhotos} not-productPhotos, ${matchesGlobal} promoted)` +
        ` — ${keptLocal} row(s) keep a distinct local photo`
    );
    for (const t of toClear.slice(0, 10)) console.log(`      · ${t.name} — ${t.why}`);
    if (toClear.length > 10) console.log(`      · ...and ${toClear.length - 10} more`);

    grandTotal += toClear.length;
    grandKept += keptLocal;
    grandNotProductPhotos += notProductPhotos;
    grandMatchesGlobal += matchesGlobal;

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

  const breakdown =
    `\n  ${grandNotProductPhotos} not a productPhotos/ URL (copied by an old copy-on-add / backfill / approval path)` +
    `\n  ${grandMatchesGlobal} equal to the current global photo (a local upload that was promoted)`;

  console.log(
    APPLY
      ? `\nDone. ${grandTotal} copied photo(s) cleared; ${grandKept} distinct local photo(s) left alone.${breakdown}` +
          `\nRemember to republish the affected stores' storefront / customer catalogs.`
      : `\nDry run complete. ${grandTotal} copied photo(s) WOULD be cleared; ${grandKept} distinct local photo(s) would be left alone.${breakdown}` +
          `\nRe-run with --apply to write.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
