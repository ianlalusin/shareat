'use client';

import {
  type Firestore,
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { dailyAnalyticsDocRef, getDayIdFromTimestamp, getDayStartMs } from './daily';
import { getApplicablePresets } from './applyAnalyticsDeltaV2';
import { toJsDate } from '@/lib/utils/date';

export type PaymentConversion = {
  id: string;
  storeId: string;
  dayId: string;
  dayStartMs: number;
  amount: number;
  fromMethod: string;
  toMethod: string;
  note?: string | null;
  status: 'active' | 'voided';
  createdBy: { uid: string; name: string; role?: string | null };
  createdAt: Timestamp | any;
  createdAtClientMs: number;
  voidedAt?: Timestamp | any | null;
  voidedBy?: { uid: string; name: string } | null;
};

export type PaymentConversionInput = {
  amount: number;
  fromMethod: string;
  toMethod: string;
  note?: string;
  actor: { uid: string; name: string; role?: string | null };
  when?: Date;
};

function safeKey(s: string) {
  return (s || 'Uncategorized')
    .trim()
    .replace(/\./g, '·')
    .replace(/\//g, '∕');
}

function normalizeMethod(s: string) {
  return (s || '').trim();
}

/**
 * Applies the byMethod delta to the day doc, month/year rollups, and applicable preset docs.
 * sign = +1 to apply, -1 to reverse.
 */
function writeByMethodDelta(
  tx: any,
  db: Firestore,
  storeId: string,
  dayId: string,
  dayStartMs: number,
  fromMethod: string,
  toMethod: string,
  amount: number,
  sign: 1 | -1,
) {
  const dayRef = dailyAnalyticsDocRef(db, storeId, dayId);
  const monthId = dayId.slice(0, 6);
  const yearId = dayId.slice(0, 4);
  const monthRef = doc(db, 'stores', storeId, 'analyticsMonths', monthId);
  const yearRef = doc(db, 'stores', storeId, 'analyticsYears', yearId);

  const eventDate = toJsDate(dayStartMs);
  const presets = eventDate ? getApplicablePresets(eventDate) : [];

  // Ensure docs exist (merge meta)
  const meta = { meta: { storeId, updatedAt: serverTimestamp() } };
  tx.set(dayRef, { meta: { ...meta.meta, dayId, dayStartMs } }, { merge: true });
  tx.set(monthRef, { meta: { ...meta.meta, monthId } }, { merge: true });
  tx.set(yearRef, { meta: { ...meta.meta, yearId } }, { merge: true });
  for (const presetId of presets) {
    const presetRef = doc(db, 'stores', storeId, 'dashPresets', presetId);
    tx.set(
      presetRef,
      { meta: { presetId, storeId, source: 'payment-conversion', updatedAt: serverTimestamp() } },
      { merge: true },
    );
  }

  const payload: Record<string, any> = { 'meta.updatedAt': serverTimestamp() };
  const fromKey = safeKey(fromMethod);
  const toKey = safeKey(toMethod);

  if (fromKey === toKey) return; // no-op, guarded upstream too

  payload[`payments.byMethod.${fromKey}`] = increment(sign * -amount);
  payload[`payments.byMethod.${toKey}`] = increment(sign * amount);

  tx.update(dayRef, payload);
  tx.update(monthRef, payload);
  tx.update(yearRef, payload);
  for (const presetId of presets) {
    const presetRef = doc(db, 'stores', storeId, 'dashPresets', presetId);
    tx.update(presetRef, payload);
  }
}

/**
 * Creates a payment conversion record and applies the byMethod delta in a single transaction.
 * Does not touch totalGross or txCount — it is a non-sales, net-zero reshuffle of payment balances.
 */
export async function createPaymentConversion(
  db: Firestore,
  storeId: string,
  input: PaymentConversionInput,
): Promise<string> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number.');

  const from = normalizeMethod(input.fromMethod);
  const to = normalizeMethod(input.toMethod);
  if (!from || !to) throw new Error('From and To methods are required.');
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('From and To methods must differ.');

  const when = input.when ?? new Date();
  const dayId = getDayIdFromTimestamp(when);
  const dayStartMs = getDayStartMs(when);

  const conversionsRef = collection(db, 'stores', storeId, 'paymentConversions');
  const newDocRef = doc(conversionsRef);

  await runTransaction(db, async (tx) => {
    tx.set(newDocRef, {
      storeId,
      dayId,
      dayStartMs,
      amount,
      fromMethod: from,
      toMethod: to,
      note: input.note?.trim() || null,
      status: 'active',
      createdBy: {
        uid: input.actor.uid,
        name: input.actor.name,
        role: input.actor.role ?? null,
      },
      createdAt: serverTimestamp(),
      createdAtClientMs: Date.now(),
      voidedAt: null,
      voidedBy: null,
    });

    writeByMethodDelta(tx, db, storeId, dayId, dayStartMs, from, to, amount, 1);
  });

  return newDocRef.id;
}

/**
 * Voids a payment conversion and reverses its byMethod delta in a single transaction.
 * Idempotent: voiding an already-voided conversion is a no-op.
 */
export async function voidPaymentConversion(
  db: Firestore,
  storeId: string,
  conversionId: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const ref = doc(db, 'stores', storeId, 'paymentConversions', conversionId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Conversion not found.');
    const data = snap.data() as PaymentConversion;
    if (data.status === 'voided') return;

    tx.update(ref, {
      status: 'voided',
      voidedAt: serverTimestamp(),
      voidedBy: { uid: actor.uid, name: actor.name },
    });

    writeByMethodDelta(
      tx,
      db,
      storeId,
      data.dayId,
      Number(data.dayStartMs),
      data.fromMethod,
      data.toMethod,
      Number(data.amount),
      -1,
    );
  });
}
