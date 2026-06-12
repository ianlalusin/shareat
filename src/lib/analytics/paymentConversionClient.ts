'use client';

import { auth } from '@/lib/firebase/client';

// Client callers for the server-side payment-conversion endpoint. Unlike the
// receipt delta paths there is NO client fallback: a conversion commits nothing
// before the call, so a server failure should surface to the user (retryable)
// rather than silently writing analytics client-side.

async function postConversion(body: Record<string, unknown>): Promise<any> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to record a conversion.');
  const res = await fetch('/api/analytics/payment-conversion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error || `Conversion failed (HTTP ${res.status}).`);
  return j;
}

export async function createPaymentConversionViaServer(
  storeId: string,
  input: { amount: number; fromMethod: string; toMethod: string; note?: string; actorName: string },
): Promise<string> {
  const j = await postConversion({
    storeId,
    action: 'create',
    amount: input.amount,
    fromMethod: input.fromMethod,
    toMethod: input.toMethod,
    note: input.note ?? null,
    actorName: input.actorName,
  });
  return j?.id ?? '';
}

export async function voidPaymentConversionViaServer(
  storeId: string,
  conversionId: string,
  actorName: string,
): Promise<void> {
  await postConversion({ storeId, action: 'void', conversionId, actorName });
}
