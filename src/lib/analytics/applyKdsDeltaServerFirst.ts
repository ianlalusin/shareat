'use client';

import { auth } from '@/lib/firebase/client';

export type KdsActor = { profileId?: string | null; name?: string | null };

/**
 * Apply a KDS analytics delta server-first for one or more tickets. The server
 * recomputes from each ticket doc (marker-based, idempotent). On failure runs
 * the supplied clientFallback (the legacy client delta) — which MUST also write
 * the ticket markers so a later server call stays consistent. Non-fatal: the
 * ticket status change is already committed before this runs.
 */
export async function applyKdsDeltaServerFirst(
  storeId: string,
  sessionId: string,
  ticketIds: string[],
  actor: KdsActor | undefined,
  clientFallback: () => Promise<void>,
): Promise<{ appliedViaServer: boolean }> {
  let appliedViaServer = false;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      const res = await fetch('/api/analytics/kds-delta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeId, sessionId, ticketIds, actor: actor ?? null }),
      });
      if (res.ok) {
        appliedViaServer = true;
      } else {
        console.warn(`[KDS analytics] server kds-delta non-OK ${res.status}; falling back to client delta.`);
      }
    }
  } catch (serverErr) {
    console.warn('[KDS analytics] server kds-delta failed; falling back to client delta:', serverErr);
  }

  if (!appliedViaServer) {
    await clientFallback();
  }
  return { appliedViaServer };
}
