

"use client";

import {
  type Firestore,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

/**
 * Fetches all documents from a given collection path.
 */
async function fetchCollection(db: Firestore, collectionPath: string) {
  const snapshot = await getDocs(collection(db, collectionPath));
  if (snapshot.empty) return [];
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Fetches global (platform-wide) discounts/charges applicable to a given store.
 */
async function fetchApplicableGlobals(db: Firestore, globalCollection: string, storeId: string) {
  const q = query(
    collection(db, globalCollection),
    where("applicableStoreIds", "array-contains", storeId),
    where("isArchived", "==", false)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Rebuilds the single `storeConfig/current` document by fetching the latest data
 * from all source-of-truth collections. Merges applicable universal (global) discounts
 * and charges, and drops any store-scoped entries the admin has suspended.
 *
 * @param db Firestore instance from the client.
 * @param storeId The ID of the store to rebuild.
 */
export async function rebuildStoreConfig(db: Firestore, storeId: string) {
  if (!storeId) {
    throw new Error("A valid store ID must be provided.");
  }

  // --- 1. Read all source collections concurrently ---
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

  // --- 2. Merge store-scoped + global collections ---
  // Drop store-scoped entries suspended by admin so POS reads a clean cache.
  const effectiveStoreDiscounts = storeDiscounts
    .filter((d: any) => !d.adminSuspended)
    .map((d: any) => ({ ...d, source: "store" }));
  const effectiveStoreCharges = storeCharges
    .filter((c: any) => !c.adminSuspended)
    .map((c: any) => ({ ...c, source: "store" }));

  const taggedGlobalDiscounts = globalDiscounts.map((d: any) => {
    // Strip applicableStoreIds from the cached copy to keep downstream shape identical to Discount.
    const { applicableStoreIds, ...rest } = d;
    return { ...rest, source: "global" };
  });
  const taggedGlobalCharges = globalCharges.map((c: any) => {
    const { applicableStoreIds, ...rest } = c;
    return { ...rest, source: "global" };
  });

  const mergedDiscounts = [...effectiveStoreDiscounts, ...taggedGlobalDiscounts];
  const mergedCharges = [...effectiveStoreCharges, ...taggedGlobalCharges];

  // --- 3. Prepare the new config document data ---
  const configDocRef = doc(db, `stores/${storeId}/storeConfig/current`);

  const newConfigData = {
    meta: {
      source: 'manual_rebuild_v4_with_globals',
      updatedAt: serverTimestamp(),
    },
    packages: storePackages,
    flavors: flavors,
    schedules: schedules,
    discounts: mergedDiscounts,
    charges: mergedCharges,
    modesOfPayment: modesOfPayment,
  };

  // --- 4. Perform atomic writes using a batch ---
  const batch = writeBatch(db);

  // Update main config doc
  batch.set(configDocRef, newConfigData, { merge: false });

  // Rebuild the tables subcollection cache
  tables.forEach((table: any) => {
    const tableCacheRef = doc(db, `stores/${storeId}/storeConfig/current/tables/${table.id}`);
    const cachePayload = {
        displayName: table.displayName || `Table ${table.tableNumber}`,
        tableNumber: table.tableNumber || null,
        customerName: null,
        status: table.status || 'available',
        currentSessionId: table.currentSessionId || null,
        packageLabel: null,
        sessionType: null,
        guestCount: null,
        itemCount: null,
        startedAtMs: null,
        updatedAt: serverTimestamp(),
    };
    batch.set(tableCacheRef, cachePayload);
  });

  await batch.commit();
}

/**
 * Rebuild storeConfig/current for a set of stores in parallel. Errors are logged per-store
 * rather than thrown so a single bad store doesn't block the others. Returns an array of
 * { storeId, ok, error? } so the caller can surface partial failures to the user.
 */
export async function rebuildStoreConfigsSafely(
  db: Firestore,
  storeIds: string[]
): Promise<Array<{ storeId: string; ok: boolean; error?: string }>> {
  const unique = Array.from(new Set(storeIds.filter(Boolean)));
  if (unique.length === 0) return [];
  return Promise.all(
    unique.map(async (storeId) => {
      try {
        await rebuildStoreConfig(db, storeId);
        return { storeId, ok: true };
      } catch (e: any) {
        console.error(`[rebuildStoreConfigsSafely] Failed for store ${storeId}:`, e);
        return { storeId, ok: false, error: e?.message || String(e) };
      }
    })
  );
}
