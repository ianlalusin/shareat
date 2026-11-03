'use client';

import { auth } from '@/lib/firebase/client';
import { OPERATOR_HEADER, getOperatorSessionToken } from '@/lib/pos-commands/client';

// Client callers for the server-side payment-conversion endpoint. Unlike the
// receipt delta paths there is NO client fallback: a conversion commits nothing
// before the call, so a server failure should surface to the user (retryable)
// rather than silently writing analytics client-side.

async function postConversion(body: Record<string, unknown>): Promise<any> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to record a conversion.');
  // The server names the actor from the signed local-profile session (audit
  // P1); actorName in the body is no longer trusted.
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const op = typeof body.storeId === 'string' ? getOperatorSessionToken(body.storeId) : null;
  if (op) headers[OPERATOR_HEADER] = op;
  const res = await fetch('/api/analytics/payment-conversion', {
    method: 'POST',
    headers,
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
