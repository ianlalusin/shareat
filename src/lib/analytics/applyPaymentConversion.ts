import { Timestamp } from 'firebase/firestore';

// Payment-conversion domain types. The write logic lives server-side in
// src/lib/server/analytics/applyPaymentConversionServer.ts (invoked via the
// /api/analytics/payment-conversion route). The former client-side
// create/void implementation was removed once the analytics rollup
// collections became server-only writes.

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
