"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import type { SavedQrCode } from "@/lib/types";

export type SavedQrCodesState = {
  qrCodes: SavedQrCode[];
  loading: boolean;
  error: string | null;
};

/**
 * Live list of the store's saved QR codes.
 *
 * Ordered by sortOrder then name so the tile grid is stable between renders —
 * a wallet whose tiles move around is one a cashier cannot build muscle memory
 * for.
 *
 * Reads every doc including inactive ones and filters client-side: the wallet
 * is a handful of documents, and a `where('isActive','==',true)` would need a
 * composite index for the same result. Managers see inactive entries in the
 * edit view; the tile grid hides them.
 */
export function useSavedQrCodes(storeId: string | null): SavedQrCodesState {
  const [qrCodes, setQrCodes] = useState<SavedQrCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) {
      setQrCodes([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, "stores", storeId, "savedQrCodes"),
      orderBy("sortOrder", "asc"),
      orderBy("name", "asc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setQrCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SavedQrCode));
        setLoading(false);
      },
      (err) => {
        console.warn("[useSavedQrCodes] snapshot failed:", err);
        setError(err.message);
        setQrCodes([]);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [storeId]);

  return useMemo(() => ({ qrCodes, loading, error }), [qrCodes, loading, error]);
}
