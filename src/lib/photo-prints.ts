/**
 * Capture & Share print requests, as POS reads them. The CUSTOMER app writes
 * the doc (its capture-share-store.ts is the other half of this contract).
 */
export type PhotoPrintRow = {
  id: string;
  status: 'queued' | 'printed' | 'declined';
  sessionId: string;
  tableDisplayName: string;
  customerName: string;
  imageUrl: string;
  createdAtMs: number;
  printedAtMs?: number | null;
  printCount?: number;
  reprintCount?: number;
};

export type PrintSummary = {
  /** Copies handed out, reprints of bad prints not included. */
  copies: number;
  free: number;
  extra: number;
  reprints: number;
  waiting: number;
  /** Per request: whether it is (or, still queued, will be) the table's free print. */
  kindById: Record<string, 'free' | 'extra'>;
};

/**
 * One free print per table session; every other copy is an extra (₱20,
 * collected by hand — never added to the bill). The free one is the session's
 * first print; a queued request is "free" only if its table has none printed yet
 * and it is the oldest waiting one from that table.
 */
export function summarizePrints(rows: PhotoPrintRow[]): PrintSummary {
  const kindById: Record<string, 'free' | 'extra'> = {};
  let copies = 0;
  let free = 0;
  let reprints = 0;
  let waiting = 0;
  const bySession = new Map<string, PhotoPrintRow[]>();
  for (const r of rows) {
    if (r.status === 'declined') continue;
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r);
    bySession.set(r.sessionId, list);
  }
  for (const list of bySession.values()) {
    const printed = list.filter((r) => r.status === 'printed').sort((a, b) => (a.printedAtMs ?? 0) - (b.printedAtMs ?? 0));
    const queued = list.filter((r) => r.status === 'queued').sort((a, b) => a.createdAtMs - b.createdAtMs);
    let freeUsed = false;
    for (const r of printed) {
      const n = Math.max(1, r.printCount ?? 1);
      copies += n;
      reprints += r.reprintCount ?? 0;
      kindById[r.id] = freeUsed ? 'extra' : 'free';
      if (!freeUsed) {
        free += 1;
        freeUsed = true;
      }
    }
    for (const r of queued) {
      waiting += 1;
      kindById[r.id] = freeUsed ? 'extra' : 'free';
      freeUsed = true;
    }
  }
  return { copies, free, extra: copies - free, reprints, waiting, kindById };
}
