'use client';

import { auth } from '@/lib/firebase/client';

// Client callers for the server-side analytics backfill endpoint (admin
// maintenance). No client fallback: a failed rebuild surfaces to the admin and
// is retryable, rather than silently writing analytics from the browser.

async function postBackfill(body: Record<string, unknown>): Promise<any> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to run a backfill.');
  const res = await fetch('/api/analytics/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error || `Backfill failed (HTTP ${res.status}).`);
  return j;
}

export async function rebuildDailyViaServer(storeId: string, startDate: Date, endDate: Date) {
  return postBackfill({ storeId, action: 'daily', startMs: startDate.getTime(), endMs: endDate.getTime() }) as Promise<{ days: number; receipts: number; tickets: number }>;
}
export async function rebuildRollupsViaServer(storeId: string, startDate: Date, endDate: Date) {
  return postBackfill({ storeId, action: 'rollups', startMs: startDate.getTime(), endMs: endDate.getTime() }) as Promise<{ months: number; years: number }>;
}
export async function rebuildPresetsViaServer(storeId: string) {
  return postBackfill({ storeId, action: 'presets' }) as Promise<{ presets: number }>;
}
