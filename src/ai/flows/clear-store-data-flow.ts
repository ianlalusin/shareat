
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ClearStoreDataInputSchema = z.object({
  storeId: z.string(),
  resetCounter: z.boolean(),
});

const ClearStoreDataOutputSchema = z.object({
  message: z.string(),
});

// Helper to initialize Firebase Admin SDK idempotently
function getAdminFirestore() {
  if (getApps().length > 0) {
    return getFirestore();
  }
  const saJson = process.env.FIREBASE_ADMIN_SA;
  if (!saJson) throw new Error("FIREBASE_ADMIN_SA environment variable is not set.");
  const serviceAccount = JSON.parse(saJson);
  initializeApp({
    credential: cert(serviceAccount),
  });
  return getFirestore();
}

async function deleteCollection(db: FirebaseFirestore.Firestore, collectionPath: string, batchSize: number) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db: FirebaseFirestore.Firestore, query: FirebaseFirestore.Query, resolve: (value: unknown) => void) {
    const snapshot = await query.get();

    if (snapshot.size === 0) {
        return resolve(0);
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}


export const clearStoreDataFlow = ai.defineFlow(
  {
    name: 'clearStoreDataFlow',
    inputSchema: ClearStoreDataInputSchema,
    outputSchema: ClearStoreDataOutputSchema,
  },
  async ({ storeId, resetCounter }) => {
    const db = getAdminFirestore();

    const sessionSubcollections = [
        "kitchentickets", 
        "billableLines", 
        "sessionBillLines", 
        "payments", 
        "activityLogs", 
        "packageUnits"
    ];

    const sessionsRef = db.collection(`stores/${storeId}/sessions`);
    const sessionsSnap = await sessionsRef.get();

    for (const sessionDoc of sessionsSnap.docs) {
        for (const sub of sessionSubcollections) {
            await deleteCollection(db, `stores/${storeId}/sessions/${sessionDoc.id}/${sub}`, 200);
        }
        await sessionDoc.ref.delete();
    }
    
    await deleteCollection(db, `stores/${storeId}/receipts`, 200);
    
    if (resetCounter) {
        const counterRef = db.doc(`stores/${storeId}/counters/receipts`);
        await counterRef.set({ seq: 0 });
    }

    return { message: `Successfully cleared data for store ${storeId}.` };
  }
);
