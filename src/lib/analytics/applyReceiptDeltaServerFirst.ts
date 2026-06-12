'use client';

import { auth } from '@/lib/firebase/client';

export type ReceiptDeltaOp = 'payment' | 'refund' | 'void' | 'edit';

/**
 * Apply a receipt analytics delta server-first.
 *
 * Prefers the authoritative server endpoint (server clock, recomputes from the
 * receipt doc, idempotent). If the endpoint is unreachable or returns non-OK,
 * runs the supplied `clientFallback` so analytics is never silently dropped.
 * Both paths are non-fatal — the receipt write itself is already committed by
 * the caller before this runs.
 *
 * Idempotency markers on the receipt doc (`analyticsApplied` for payment/refund,
 * `analyticsReversed` for void) guard against double-apply when the server
 * committed but the HTTP response was lost and the fallback also runs.
 */
export async function applyReceiptDeltaServerFirst(
  storeId: string,
  receiptId: string,
  op: ReceiptDeltaOp,
  clientFallback: () => Promise<void>,
  extra?: Record<string, unknown>,
): Promise<{ appliedViaServer: boolean }> {
  let appliedViaServer = false;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      const res = await fetch('/api/analytics/apply-delta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeId, receiptId, op, ...(extra || {}) }),
      });
      if (res.ok) {
        appliedViaServer = true;
        const j = await res.json().catch(() => null);
        console.log(`[Analytics] Delta applied server-side (${op}) for receipt`, receiptId, j?.skipped ? '(already applied)' : '');
      } else {
        console.warn(`[Analytics] Server apply-delta (${op}) non-OK ${res.status}; falling back to client delta.`);
      }
    }
  } catch (serverErr) {
    console.warn(`[Analytics] Server apply-delta (${op}) failed; falling back to client delta:`, serverErr);
  }

  if (!appliedViaServer) {
    await clientFallback();
  }
  return { appliedViaServer };
}
