
"use client";

import {
  type Firestore,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
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
 * Rebuilds the single `storeConfig/current` document by fetching the latest data
 * from all source-of-truth collections. It also seeds the operational pages (opPages)
 * required for KDS and session management.
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
    discounts,
    charges,
    modesOfPayment,
    kitchenLocations,
  ] = await Promise.all([
    fetchCollection(db, `stores/${storeId}/tables`),
    fetchCollection(db, `stores/${storeId}/storePackages`),
    fetchCollection(db, `stores/${storeId}/storeFlavors`),
    fetchCollection(db, `stores/${storeId}/menuSchedules`),
    fetchCollection(db, `stores/${storeId}/storeDiscounts`),
    fetchCollection(db, `stores/${storeId}/storeCharges`),
    fetchCollection(db, `stores/${storeId}/storeModesOfPayment`),
    fetchCollection(db, `stores/${storeId}/kitchenLocations`),
  ]);

  // --- 2. Prepare the new config document data ---
  const configDocRef = doc(db, `stores/${storeId}/storeConfig/current`);
  
  const newConfigData = {
    meta: {
      source: 'manual_rebuild_v3_with_oppages',
      updatedAt: serverTimestamp(),
    },
    packages: storePackages,
    flavors: flavors,
    schedules: schedules,
    discounts: discounts,
    charges: charges,
    modesOfPayment: modesOfPayment,
  };

  // --- 3. Perform atomic writes using a batch ---
  const batch = writeBatch(db);
  
  // Update main config doc
  batch.set(configDocRef, newConfigData, { merge: false });

  // Rebuild the tables subcollection cache
  tables.forEach((table: any) => {
    const tableCacheRef = doc(db, `stores/${storeId}/storeConfig/current/tables/${table.id}`);
    const cachePayload = {
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

  // Seed opPages for each Kitchen Station
  kitchenLocations.forEach((loc: any) => {
    const opPageRef = doc(db, `stores/${storeId}/opPages`, loc.id);
    batch.set(opPageRef, {
        name: loc.name,
        activeCount: 0,
        todayServeCount: 0,
        todayServeMsSum: 0,
        updatedAt: serverTimestamp(),
    }, { merge: true });

    // Initialize history preview document
    const historyRef = doc(db, `stores/${storeId}/opPages`, loc.id, 'historyPreview', 'current');
    batch.set(historyRef, {
        items: [],
        updatedAt: serverTimestamp(),
    }, { merge: true });
  });

  // Initialize session management operational page metadata
  const sessionOpPageRef = doc(db, `stores/${storeId}/opPages`, 'sessionPage');
  batch.set(sessionOpPageRef, {
      updatedAt: serverTimestamp(),
      source: 'rebuild-seed'
  }, { merge: true });
  
  await batch.commit();
}
