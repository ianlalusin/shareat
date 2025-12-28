
'use client';

import { collection, doc, getDocs, query, writeBatch } from "firebase/firestore";
import { db } from "./client";

/**
 * Deletes all documents in the 'sessions' collection for a given store
 * and resets the status of all tables to 'available'.
 * This is a highly destructive operation intended for clearing test data.
 *
 * @param storeId The ID of the store to clear.
 */
export async function clearStoreTestData(storeId: string) {
  if (!storeId) {
    throw new Error("Store ID is required to clear test data.");
  }

  const batch = writeBatch(db);

  // 1. Get all session documents for the store
  const sessionsRef = collection(db, "stores", storeId, "sessions");
  const sessionsSnap = await getDocs(sessionsRef);
  
  // 2. Add delete operations for each session to the batch
  sessionsSnap.forEach((sessionDoc) => {
    batch.delete(sessionDoc.ref);
  });

  // 3. Get all table documents for the store
  const tablesRef = collection(db, "stores", storeId, "tables");
  const tablesSnap = await getDocs(tablesRef);

  // 4. Add update operations for each table to the batch
  tablesSnap.forEach((tableDoc) => {
    batch.update(tableDoc.ref, {
      status: 'available',
      currentSessionId: null
    });
  });

  // 5. Commit the batch
  await batch.commit();
}
