
'use client';

import {
  type Firestore,
  type WriteBatch,
  type Transaction,
  increment,
  serverTimestamp,
  doc,
} from 'firebase/firestore';

type Writer =
  | { kind: "tx"; tx: Transaction }
  | { kind: "batch"; batch: WriteBatch };

function writerUpdate(w: Writer, ref: any, data: any) {
  if (w.kind === "tx") return w.tx.update(ref, data);
  return w.batch.update(ref, data);
}

/**
 * Applies a delta to the `discountsTotal` field across daily, monthly, and yearly analytics documents.
 * This is used to correct analytics when a discount is edited or removed after a receipt has been finalized.
 * MUST be called within a Firestore Transaction or WriteBatch.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store.
 * @param dayId The YYYYMMDD day ID.
 * @param monthId The YYYYMM month ID.
 * @param yearId The YYYY year ID.
 * @param deltaAmount The amount to add (can be negative) to the discountsTotal.
 * @param opts Object containing the Firestore Transaction or WriteBatch.
 */
export async function applyDiscountDelta(
  db: Firestore,
  storeId: string,
  dayId: string,
  monthId: string,
  yearId: string,
  deltaAmount: number,
  opts: { tx?: Transaction; batch?: WriteBatch }
) {
  if (deltaAmount === 0) return; // No change needed

  const w: Writer | null =
    opts.tx ? { kind: "tx", tx: opts.tx } :
    opts.batch ? { kind: "batch", batch: opts.batch } :
    null;
  if (!w) throw new Error("applyDiscountDelta requires tx or batch.");

  const dayRef = doc(db, "stores", storeId, "analytics", dayId);
  const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
  const yearRef = doc(db, "stores", storeId, "analyticsYears", String(yearId));

  const payload = {
    'payments.discountsTotal': increment(deltaAmount),
    'meta.updatedAt': serverTimestamp(),
  };

  writerUpdate(w, dayRef, payload);
  writerUpdate(w, monthRef, payload);
  writerUpdate(w, yearRef, payload);
}
