import { describe, it, expect } from "vitest";
import { fetchFeedbackRows, summarizeFeedback, type FeedbackDb } from "./customer-feedback";

const DAY_MS = 24 * 60 * 60 * 1000;

// Aug 26, 2026 00:00 UTC — an arbitrary UTC-day boundary used as the base for
// building day-doc ids ("08262026") the way the CUSTOMER app's write path does.
const UTC_DAY0 = Date.UTC(2026, 7, 26);

function mmddyyyy(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${mm}${dd}${yyyy}`;
}

/** Minimal fake covering only what customer-feedback.ts calls. */
function makeFakeDb(dayDocs: Record<string, any>) {
  const requestedIds: string[] = [];
  const db: FeedbackDb = {
    collection(path: string) {
      expect(path).toBe("stores/store1/customerFeedbackDays");
      return {
        doc(id: string) {
          requestedIds.push(id);
          const data = dayDocs[id];
          return {
            async get() {
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
      };
    },
  };
  return { db, requestedIds };
}

describe("fetchFeedbackRows", () => {
  it("returns only entries whose createdAtClientMs falls within [startMs, endMs)", () => {
    const dayKey = mmddyyyy(UTC_DAY0);
    const inRange = UTC_DAY0 + 3_000;
    const beforeRange = UTC_DAY0 - 1;
    const atEnd = UTC_DAY0 + DAY_MS; // exclusive boundary, must NOT be included

    const { db } = makeFakeDb({
      [dayKey]: {
        count: 3,
        feedbacks: [
          { id: "a", rating: 5, suggestion: "Great", createdAtClientMs: inRange, customerName: "Jo" },
          { id: "b", rating: 4, suggestion: "Before window", createdAtClientMs: beforeRange },
          { id: "c", rating: 3, suggestion: "At exclusive end", createdAtClientMs: atEnd },
        ],
      },
    });

    return fetchFeedbackRows(db, "store1", UTC_DAY0, UTC_DAY0 + DAY_MS).then((rows) => {
      expect(rows).toEqual([
        { id: "a", rating: 5, comment: "Great", dateMs: inRange, customerName: "Jo" },
      ]);
    });
  });

  it("picks up entries from the buffered day before and after the window", () => {
    const windowStart = UTC_DAY0;
    const windowEnd = UTC_DAY0 + DAY_MS;
    const dayBeforeKey = mmddyyyy(UTC_DAY0 - DAY_MS);
    const dayAfterKey = mmddyyyy(UTC_DAY0 + DAY_MS);

    // Entries stored under the adjacent UTC day-doc (write-side clock skew)
    // but whose real timestamp falls inside the requested window.
    const { db } = makeFakeDb({
      [dayBeforeKey]: {
        count: 1,
        feedbacks: [{ id: "early", rating: 5, suggestion: "", createdAtClientMs: windowStart + 100 }],
      },
      [dayAfterKey]: {
        count: 1,
        feedbacks: [{ id: "late", rating: 2, suggestion: "", createdAtClientMs: windowEnd - 100 }],
      },
    });

    return fetchFeedbackRows(db, "store1", windowStart, windowEnd).then((rows) => {
      expect(rows.map((r) => r.id).sort()).toEqual(["early", "late"]);
    });
  });

  it("sorts rows newest first", () => {
    const dayKey = mmddyyyy(UTC_DAY0);
    const { db } = makeFakeDb({
      [dayKey]: {
        count: 2,
        feedbacks: [
          { id: "older", rating: 5, suggestion: "", createdAtClientMs: UTC_DAY0 + 1_000 },
          { id: "newer", rating: 3, suggestion: "", createdAtClientMs: UTC_DAY0 + 5_000 },
        ],
      },
    });

    return fetchFeedbackRows(db, "store1", UTC_DAY0, UTC_DAY0 + DAY_MS).then((rows) => {
      expect(rows.map((r) => r.id)).toEqual(["newer", "older"]);
    });
  });

  it("does not probe a chunk doc when the base day doc isn't full", () => {
    const dayKey = mmddyyyy(UTC_DAY0);
    const { db, requestedIds } = makeFakeDb({
      [dayKey]: { count: 1, feedbacks: [{ id: "a", rating: 5, suggestion: "", createdAtClientMs: UTC_DAY0 + 1 }] },
    });

    return fetchFeedbackRows(db, "store1", UTC_DAY0, UTC_DAY0 + DAY_MS).then(() => {
      expect(requestedIds).not.toContain(`${dayKey}-01`);
    });
  });

  it("continues into the next chunk when the base day doc is full", () => {
    const dayKey = mmddyyyy(UTC_DAY0);
    const { db } = makeFakeDb({
      [dayKey]: {
        count: 400,
        feedbacks: [{ id: "a", rating: 5, suggestion: "", createdAtClientMs: UTC_DAY0 + 1 }],
      },
      [`${dayKey}-01`]: {
        count: 1,
        feedbacks: [{ id: "b", rating: 4, suggestion: "", createdAtClientMs: UTC_DAY0 + 2 }],
      },
    });

    return fetchFeedbackRows(db, "store1", UTC_DAY0, UTC_DAY0 + DAY_MS).then((rows) => {
      expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
    });
  });
});

describe("summarizeFeedback", () => {
  it("averages the ratings and counts the rows", () => {
    const rows = [
      { id: "a", rating: 5, comment: "", dateMs: 1 },
      { id: "b", rating: 3, comment: "", dateMs: 2 },
      { id: "c", rating: 4, comment: "", dateMs: 3 },
    ];
    expect(summarizeFeedback(rows)).toEqual({ avgRating: 4, count: 3 });
  });

  it("returns zeroes for an empty list", () => {
    expect(summarizeFeedback([])).toEqual({ avgRating: 0, count: 0 });
  });
});
