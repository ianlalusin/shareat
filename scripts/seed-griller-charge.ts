// Seeds/updates the "Additional Griller" universal (global) charge and applies
// it to every active store that allows dine-in (offersUnlimited !== false).
// Idempotent: safe to re-run. Usage:
//   npx tsx scripts/seed-griller-charge.ts --dry   # preview only, no writes
//   npx tsx scripts/seed-griller-charge.ts         # writes for real
//
// This script writes the exact same document shape the admin "Universal
// Charges" screen does (see src/components/admin/collections/
// UniversalChargesSettings.tsx::handleSave), so once seeded, the charge is a
// completely normal, admin-editable/deactivatable/archivable Universal
// Charge — nothing about it is special-cased.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";

const GRILLER_CHARGE_ID = "griller-addon-charge";
const GRILLER_CHARGE_NAME = "Additional Griller";
const GRILLER_CHARGE_VALUE = 50;

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

async function fetchCollection(db: Firestore, path: string) {
  const snap = await db.collection(path).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
}

async function fetchApplicableGlobals(db: Firestore, globalCollection: string, storeId: string) {
  const snap = await db
    .collection(globalCollection)
    .where("applicableStoreIds", "array-contains", storeId)
    .where("isArchived", "==", false)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
}

// Admin-SDK port of src/lib/manager/dataManagement.ts::rebuildStoreConfig.
// That function is built on the browser `firebase/firestore` client SDK and
// can't be imported into a Node script as-is — keep this in sync by hand if
// the source function's merge/tag logic ever changes.
async function rebuildStoreConfigAdmin(db: Firestore, storeId: string) {
  const [
    tables,
    storePackages,
    flavors,
    schedules,
    storeDiscounts,
    storeCharges,
    modesOfPayment,
    globalDiscounts,
    globalCharges,
  ] = await Promise.all([
    fetchCollection(db, `stores/${storeId}/tables`),
    fetchCollection(db, `stores/${storeId}/storePackages`),
    fetchCollection(db, `stores/${storeId}/storeFlavors`),
    fetchCollection(db, `stores/${storeId}/menuSchedules`),
    fetchCollection(db, `stores/${storeId}/storeDiscounts`),
    fetchCollection(db, `stores/${storeId}/storeCharges`),
    fetchCollection(db, `stores/${storeId}/storeModesOfPayment`),
    fetchApplicableGlobals(db, "globalDiscounts", storeId),
    fetchApplicableGlobals(db, "globalCharges", storeId),
  ]);

  const effectiveStoreDiscounts = storeDiscounts.filter((d) => !d.adminSuspended).map((d) => ({ ...d, source: "store" }));
  const effectiveStoreCharges = storeCharges.filter((c) => !c.adminSuspended).map((c) => ({ ...c, source: "store" }));
  const taggedGlobalDiscounts = globalDiscounts.map(({ applicableStoreIds, ...rest }) => ({ ...rest, source: "global" }));
  const taggedGlobalCharges = globalCharges.map(({ applicableStoreIds, ...rest }) => ({ ...rest, source: "global" }));

  const mergedDiscounts = [...effectiveStoreDiscounts, ...taggedGlobalDiscounts];
  const mergedCharges = [...effectiveStoreCharges, ...taggedGlobalCharges];

  const configDocRef = db.doc(`stores/${storeId}/storeConfig/current`);
  const newConfigData = {
    meta: { source: "manual_rebuild_v4_with_globals", updatedAt: FieldValue.serverTimestamp() },
    packages: storePackages,
    flavors,
    schedules,
    discounts: mergedDiscounts,
    charges: mergedCharges,
    modesOfPayment,
  };

  const batch = db.batch();
  batch.set(configDocRef, newConfigData);
  for (const table of tables) {
    const tableCacheRef = db.doc(`stores/${storeId}/storeConfig/current/tables/${table.id}`);
    batch.set(tableCacheRef, {
      displayName: table.displayName || `Table ${table.tableNumber}`,
      tableNumber: table.tableNumber || null,
      customerName: null,
      status: table.status || "available",
      currentSessionId: table.currentSessionId || null,
      packageLabel: null,
      sessionType: null,
      guestCount: null,
      itemCount: null,
      startedAtMs: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const isDry = process.argv.includes("--dry");

  console.log(`Mode: ${isDry ? "DRY RUN (read-only)" : "LIVE WRITE"}`);

  const storesSnap = await db.collection("stores").get();
  const applicableStoreIds: string[] = [];
  for (const doc of storesSnap.docs) {
    const data = doc.data() as any;
    // Dine-in-capable, operational stores only — matches the gating already
    // used for the cashier's session-start tabs (offersUnlimited !== false).
    if (data.isActive === true && data.offersUnlimited !== false) {
      applicableStoreIds.push(doc.id);
    }
  }

  console.log(`\nFound ${storesSnap.size} total store(s); ${applicableStoreIds.length} active + dine-in-enabled:`);
  console.log(applicableStoreIds);

  const chargeRef = db.doc(`globalCharges/${GRILLER_CHARGE_ID}`);
  const existingSnap = await chargeRef.get();
  const isCreating = !existingSnap.exists;

  const payload: Record<string, unknown> = {
    id: GRILLER_CHARGE_ID,
    name: GRILLER_CHARGE_NAME,
    type: "fixed",
    value: GRILLER_CHARGE_VALUE,
    appliesTo: "subtotal",
    scope: ["bill"],
    isEnabled: true,
    isArchived: false,
    sortOrder: 1000,
    applicableStoreIds,
    updatedBy: "system:seed-griller-charge",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (isCreating) {
    payload.createdBy = "system:seed-griller-charge";
    payload.createdAt = FieldValue.serverTimestamp();
  }

  console.log(`\n${isCreating ? "Creating" : "Updating"} ${chargeRef.path}:`);
  console.log(payload);

  if (isDry) {
    console.log("\n--- DRY RUN --- no writes performed.");
    console.log(`Would rebuild storeConfig/current for ${applicableStoreIds.length} store(s).`);
    return;
  }

  await chargeRef.set(payload, { merge: true });
  console.log(`✅ Wrote ${chargeRef.path}`);

  console.log(`\nRebuilding storeConfig/current for ${applicableStoreIds.length} affected store(s)...`);
  let ok = 0;
  let failed = 0;
  for (const storeId of applicableStoreIds) {
    try {
      await rebuildStoreConfigAdmin(db, storeId);
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ❌ Failed to rebuild storeConfig for ${storeId}:`, e);
    }
  }
  console.log(`✅ Rebuilt ${ok} store(s), ${failed} failure(s).`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("\n❌ Unexpected error:", e);
  process.exit(1);
});
