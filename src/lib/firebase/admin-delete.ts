
'use client';

import { collection, doc, getDocs, query, writeBatch, deleteDoc, runTransaction } from "firebase/firestore";
import { db } from "./client";

/**
 * Deletes all documents in a collection in batches.
 * @param collectionRef Reference to the collection to delete.
 * @param batchSize The number of documents to delete in each batch.
 */
async function deleteCollectionInBatches(collectionRef: any, batchSize: number, onProgress: (deletedCount: number) => void) {
    const q = query(collectionRef, limit(batchSize));
    let snapshot = await getDocs(q);
    let deletedCount = 0;

    while (snapshot.size > 0) {
        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        deletedCount += snapshot.size;
        onProgress(deletedCount);
        
        snapshot = await getDocs(q);
    }
}


/**
 * Deletes all documents and their specified subcollections for a given store.
 * @param storeId The ID of the store to clear.
 * @param resetCounter Whether to reset the receipt counter.
 * @param onProgress Callback for progress updates.
 */
export async function clearStoreData(
    storeId: string, 
    resetCounter: boolean,
    onProgress: (message: string) => void
) {
    if (!storeId) {
        throw new Error("Store ID is required.");
    }
    
    onProgress("Starting data cleanup...");

    const sessionSubcollections = [
        "kitchentickets", 
        "billableLines", 
        "sessionBillLines", 
        "payments", 
        "activityLogs", 
        "packageUnits"
    ];

    // --- Delete Sessions and their subcollections ---
    const sessionsRef = collection(db, "stores", storeId, "sessions");
    const sessionsSnap = await getDocs(sessionsRef);
    let sessionDeleteCount = 0;
    
    for (const sessionDoc of sessionsSnap.docs) {
        onProgress(`Deleting subcollections for session ${sessionDoc.id.substring(0,6)}...`);
        for (const sub of sessionSubcollections) {
            const subRef = collection(sessionDoc.ref, sub);
            await deleteCollectionInBatches(subRef, 200, () => {});
        }
        await deleteDoc(sessionDoc.ref);
        sessionDeleteCount++;
        onProgress(`Deleted session ${sessionDeleteCount} of ${sessionsSnap.size}`);
    }
    onProgress("All sessions deleted.");

    // --- Delete Receipts ---
    const receiptsRef = collection(db, "stores", storeId, "receipts");
    const receiptsSnap = await getDocs(receiptsRef);
    let receiptDeleteCount = 0;
    await deleteCollectionInBatches(receiptsRef, 200, (count) => {
        receiptDeleteCount = count;
        onProgress(`Deleted receipt ${receiptDeleteCount} of ${receiptsSnap.size}`);
    });
     onProgress("All receipts deleted.");

    // --- Reset Counter ---
    if (resetCounter) {
        onProgress("Resetting receipt counter...");
        const counterRef = doc(db, "stores", storeId, "counters", "receipts");
        await runTransaction(db, async (transaction) => {
            transaction.set(counterRef, { seq: 0 });
        });
        onProgress("Receipt counter reset to 0.");
    }
    
    onProgress("Cleanup complete.");
}

