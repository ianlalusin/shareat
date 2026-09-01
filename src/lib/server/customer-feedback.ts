import "server-only";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_DOC = 400; // mirrors the CUSTOMER app's write-side chunk size
const CHUNK_PROBE_LIMIT = 20;

export type FeedbackRow = {
  id: string;
  rating: number;
  comment: string;
  dateMs: number;
  customerName?: string;
};

export interface FeedbackDb {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): any }>;
    };
  };
}

function mmddyyyyUTC(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${mm}${dd}${yyyy}`;
}

/**
 * UTC day-doc keys that could hold entries for [startMs, endMs). Buffered a
 * day on each side: the CUSTOMER app's write path keys the doc off the
 * server's own clock (UTC in prod, PHT for local dev — no `TZ` pin either
 * way), so a Manila week boundary can land in an adjacent UTC-dated doc.
 * Entries are still filtered precisely by `createdAtClientMs` below, so the
 * buffer only widens which docs get read, never what gets counted.
 */
function candidateDayKeys(startMs: number, endMs: number): string[] {
  const bufferedStart = startMs - DAY_MS;
  const bufferedEnd = endMs + DAY_MS;
  const firstUtcDay = Math.floor(bufferedStart / DAY_MS) * DAY_MS;

  const keys: string[] = [];
  for (let cursor = firstUtcDay; cursor < bufferedEnd; cursor += DAY_MS) {
    keys.push(mmddyyyyUTC(cursor));
  }
  return keys;
}

async function fetchDayDocs(db: FeedbackDb, storeId: string, dayKey: string): Promise<any[]> {
  const col = db.collection(`stores/${storeId}/customerFeedbackDays`);
  const docs: any[] = [];

  for (let i = 0; i <= CHUNK_PROBE_LIMIT; i++) {
    const docId = i === 0 ? dayKey : `${dayKey}-${String(i).padStart(2, "0")}`;
    const snap = await col.doc(docId).get();
    if (!snap.exists) break;

    const data = snap.data();
    docs.push(data);

    const count = Number(data?.count ?? (Array.isArray(data?.feedbacks) ? data.feedbacks.length : 0));
    if (count < MAX_PER_DOC) break; // last chunk for the day
  }

  return docs;
}

/** Feedback rows for a store within the half-open window [startMs, endMs), newest first. */
export async function fetchFeedbackRows(
  db: FeedbackDb,
  storeId: string,
  startMs: number,
  endMs: number
): Promise<FeedbackRow[]> {
  const rows: FeedbackRow[] = [];

  for (const dayKey of candidateDayKeys(startMs, endMs)) {
    const docs = await fetchDayDocs(db, storeId, dayKey);
    for (const data of docs) {
      const feedbacks = Array.isArray(data?.feedbacks) ? data.feedbacks : [];
      for (const f of feedbacks) {
        const dateMs = Number(f?.createdAtClientMs || 0);
        if (!dateMs || dateMs < startMs || dateMs >= endMs) continue;

        rows.push({
          id: String(f?.id || `${dayKey}:${rows.length}`),
          rating: Number(f?.rating || 0),
          comment: String(f?.suggestion || ""),
          dateMs,
          customerName: f?.customerName ? String(f.customerName) : undefined,
        });
      }
    }
  }

  rows.sort((a, b) => b.dateMs - a.dateMs);
  return rows;
}

export function summarizeFeedback(rows: FeedbackRow[]): { avgRating: number; count: number } {
  if (rows.length === 0) return { avgRating: 0, count: 0 };
  const sum = rows.reduce((s, r) => s + r.rating, 0);
  return { avgRating: sum / rows.length, count: rows.length };
}
