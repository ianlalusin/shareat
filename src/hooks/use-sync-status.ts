'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

export function useSyncStatus() {
  const firestore = useFirestore();
  const [hasPendingWrites, setHasPendingWrites] = useState(false);

  useEffect(() => {
    if (!firestore) return;

    // Light subscription: 1 doc from orders, just to track metadata
    const q = query(collection(firestore, 'orders'), limit(1));

    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        // If any write in this client is pending, Firestore will flag it
        setHasPendingWrites(snapshot.metadata.hasPendingWrites);
      },
      () => {
        // On error, we just assume "no pending writes"
        setHasPendingWrites(false);
      }
    );

    return () => unsub();
  }, [firestore]);

  return { hasPendingWrites };
}
