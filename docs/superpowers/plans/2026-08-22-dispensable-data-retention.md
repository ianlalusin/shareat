# Dispensable Data Retention & Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purge kitchen tickets, session bill lines, expired PINs, and old customer requests that are dispensable once a session is paid — without letting an analytics rebuild silently zero the kitchen metrics those tickets used to feed.

**Architecture:** A per-store retention high-water mark (`stores/{id}/meta/retention.purgedBeforeMs`) is written *before* any deletion. The analytics rebuild reads that mark and preserves the existing `kitchen` block for any day older than it, instead of recomputing it from tickets that no longer exist. A dry-run-by-default script performs the deletions; a cron route runs it nightly.

**Tech Stack:** Next.js App Router (Node runtime), firebase-admin Firestore, TypeScript, Vitest, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-08-22-dispensable-data-retention-design.md`

## Global Constraints

- **Retention horizon: 90 days.** Not 30 — month-end reconcile of the previous month lands near a 30-day edge.
- **No new Firestore indexes.** `firestore.indexes.json` declares ~13 of ~57 live indexes; a bulk `firebase deploy --only firestore:indexes` would offer to delete ~44 live indexes including the `COLLECTION_GROUP kitchentickets` ones the rebuild depends on. Every query in this plan is a single-field range query with in-memory filtering. If an index turns out to be unavoidable, create it via the console error-link — never a file deploy.
- **Dry run is the default** on every entry point. Deletion requires an explicit `--write`.
- **The horizon is written before the first delete commits**, never after the run completes. Over-covering is harmless; under-covering is data loss.
- **Session documents are timestamped `startedAtClientMs`, NOT `createdAtClientMs`** (`src/components/cashier/firestore.ts:183,248`). Kitchen tickets and customer requests *do* use `createdAtClientMs` — the two are not interchangeable. A Firestore range filter silently excludes documents missing the field, so querying the wrong one returns zero rows and reports success. The first census hit exactly this and falsely reported "0 sessions older than 30 days" for every store. Every session query in this plan must use `startedAtClientMs`, and Task 4 carries a sanity check that aborts rather than reporting an empty purge.
- **Never purge:** `receipts`, `analytics` / `analyticsMonths` / `analyticsYears`, session documents themselves, `sessions/{id}/payments`, `customerFeedbackDays`, `pointsLedger` / `loyaltyLogs` / `loyaltyRedemptions`.
- **Branch `sev5_advanced`. Do not push** — Ian pushes POS.
- Test command is `npm test` (Vitest). Typecheck with `npm run typecheck`.

---

## Census outcome & revised recommendation (2026-08-22)

Task 0 is complete. Measured, with the corrected field:

| | Purgeable at 90d |
|---|---|
| Sessions past horizon | 5,841 (Lipa 4,356 · Malvar 1,398 · TEST 87) |
| `kitchentickets` | ≈27,672 of 42,640 |
| `sessionBillLines` | ≈8,381 of 17,008 |
| `pinRegistry` expired >7d | 4,878 of 5,296 |
| **Total** | **≈40,900 documents** |

Data quality is clean: **0** sessions missing `startedAtClientMs`, **0**
non-terminal sessions in the sampled old population. The purge predicate is
sound.

**But the payoff is close to nothing, and the count threshold in Task 0 step 2
was the wrong test.** It measured documents when it should have measured cost:

- Deletes: ~40,900 ops ≈ **$0.01, one-time**.
- Storage reclaimed: ~40,900 small documents ≈ tens of MB ≈ **under a cent a month**.
- **No query gets faster.** Every bulk reader is already date-bounded —
  `SyncKdsTicketsTool` to 3 days, `rebuildDailyAnalyticsFromReceiptsServer` to
  the rebuild range ±1 day, and the customer app's `refillTicketState` to a
  single session. Nothing scans the collection group unbounded.
- PIN space is 32⁶ ≈ 1.07 billion, so 5,296 live pins is 0.0005% occupancy —
  no collision pressure, and issuance retries were never at risk.

Against that, purging tickets **trades away reconstructibility**: today the
`kitchen.*` block can be rebuilt from source; afterwards it exists in exactly
one place — the day doc — protected by a guard we would have to keep correct
forever.

**Recommendation, split by target:**

1. **Pins — do it.** 4,878 documents that are pure ephemera: a closed session's
   PIN has no analytic value, feeds no aggregate, and needs no horizon or guard.
   CUSTOMER's `cleanup-archived-pins` route was built for this and has evidently
   never run. This is Task 5's pin half, and it is **independently shippable** —
   Tasks 1-4 are not prerequisites. Approved by Ian 2026-08-22.
2. **Kitchen tickets and bill lines — I would skip.** Pennies saved in exchange
   for making kitchen metrics single-copy. Tasks 1-4, 6, 7 stay written and
   ready; run them only if there is a reason the numbers don't capture (export
   size, console usability, or a decision to archive tickets to Postgres first).

The rest of this plan is unchanged and remains valid if the ticket purge is
wanted.

---

### Task 0: Measure the volume (pre-flight, read-only) — COMPLETE

**Files:**
- Read-only; no repo changes.

**Partially complete — 2026-08-22.** A first pass ran and produced global totals, but its per-store age query was wrong (see Global Constraints: it used `createdAtClientMs` on session docs). Totals below are trustworthy; the age split is not, and `census2.cjs` re-measures it.

Global totals, verified:

| Collection group | Docs |
|---|---|
| `kitchentickets` | 42,640 |
| `sessionBillLines` | 17,008 |
| `payments` (never purged) | 10,506 |
| `refillItems` | 99 |
| `pinRegistry` | 5,295 (5,277 archived) |

Sessions total ~10,269 across 6 active stores, so roughly 4.2 tickets and 1.7 bill lines per session.

- [ ] **Step 1: Re-run the corrected census**

```bash
cd "C:/Users/ianla/AppData/Local/Temp/claude/C--Users-ianla/192a251b-54ab-4628-bd9d-9ed4b286501f/scratchpad"
NODE_PATH="C:/Users/ianla/webapps/POS/node_modules" node census2.cjs
```

It reports, per store, sessions older than 30 and 90 days by `startedAtClientMs`, how many session docs are missing that field, and a 25-session sample of the oldest sessions past the horizon giving average tickets and bill lines each — from which it estimates total purgeable documents.

- [ ] **Step 2: Decide on the strength of the numbers**

If estimated purgeable tickets are under ~10,000, say so and recommend landing Tasks 1-3 (the guard) plus the pin sweep only, deferring the ticket purge. The guard is worth having regardless — it removes a live footgun whether or not anything is ever deleted.

Also check the `missing startedAtClientMs` column. Any non-zero count means some sessions would never be reached by the purge; that is not a blocker (they are simply skipped) but it should be reported, not ignored.

No commit.

---

### Task 1: Retention horizon module

Pure logic, no Firestore. Everything later depends on these names.

**Files:**
- Create: `src/lib/server/retention/horizon.ts`
- Test: `src/lib/server/retention/__tests__/horizon.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RETENTION_DAYS: number`, `RetentionDoc` type, `retentionDocPath(storeId: string): string`, `nextHorizonMs(currentMs: number | undefined, cutoffMs: number): number`, `isSessionTerminal(session: Record<string, unknown>): boolean`, `cutoffMsFor(nowMs: number, days?: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/retention/__tests__/horizon.test.ts
import { describe, it, expect } from "vitest";
import {
  RETENTION_DAYS,
  retentionDocPath,
  nextHorizonMs,
  isSessionTerminal,
  cutoffMsFor,
} from "../horizon";

describe("retention horizon", () => {
  it("retains for 90 days", () => {
    expect(RETENTION_DAYS).toBe(90);
  });

  it("builds the per-store retention doc path", () => {
    expect(retentionDocPath("abc")).toBe("stores/abc/meta/retention");
  });

  it("computes the cutoff from now", () => {
    const now = 1_000_000_000_000;
    expect(cutoffMsFor(now)).toBe(now - 90 * 86_400_000);
    expect(cutoffMsFor(now, 7)).toBe(now - 7 * 86_400_000);
  });

  it("advances the horizon forward only", () => {
    expect(nextHorizonMs(100, 200)).toBe(200);
    expect(nextHorizonMs(300, 200)).toBe(300);
    expect(nextHorizonMs(undefined, 200)).toBe(200);
    expect(nextHorizonMs(NaN, 200)).toBe(200);
  });

  it("treats closed, voided, cancelled and isPaid sessions as terminal", () => {
    expect(isSessionTerminal({ status: "closed" })).toBe(true);
    expect(isSessionTerminal({ status: "voided" })).toBe(true);
    expect(isSessionTerminal({ status: "cancelled" })).toBe(true);
    expect(isSessionTerminal({ isPaid: true })).toBe(true);
    expect(isSessionTerminal({ status: "closed", isPaid: false })).toBe(true);
  });

  it("does not treat an open session as terminal", () => {
    expect(isSessionTerminal({ status: "occupied" })).toBe(false);
    expect(isSessionTerminal({})).toBe(false);
    expect(isSessionTerminal({ isPaid: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/retention/__tests__/horizon.test.ts`
Expected: FAIL — cannot resolve `../horizon`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/server/retention/horizon.ts
/**
 * Per-store retention high-water mark.
 *
 * `purgedBeforeMs` is the guarantee the analytics rebuild relies on: any day
 * whose dayStartMs is below it may have had its kitchen tickets deleted, so the
 * rebuild must preserve that day's existing `kitchen` block rather than
 * recompute it from tickets that are gone. See
 * docs/superpowers/specs/2026-08-22-dispensable-data-retention-design.md.
 */

export const RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

export type RetentionDoc = {
  purgedBeforeMs: number;
  lastRunAtMs: number;
  lastRunDeleted: { kitchentickets: number; sessionBillLines: number };
};

/** `stores/{storeId}/meta/retention` — written only by the purge job. */
export function retentionDocPath(storeId: string): string {
  return `stores/${storeId}/meta/retention`;
}

/** Oldest timestamp a purge run will keep. Everything older is a candidate. */
export function cutoffMsFor(nowMs: number, days: number = RETENTION_DAYS): number {
  return nowMs - days * DAY_MS;
}

/**
 * Monotonic. A run that would move the horizon backward leaves it where it is —
 * lowering it would un-guard days whose tickets are already deleted.
 */
export function nextHorizonMs(currentMs: number | undefined, cutoffMs: number): number {
  const cur = Number(currentMs);
  if (!Number.isFinite(cur)) return cutoffMs;
  return Math.max(cur, cutoffMs);
}

/**
 * Matches the terminal-session guards already used in the cashier flow
 * (src/components/cashier/firestore.ts:496, :906, :1099).
 */
export function isSessionTerminal(session: Record<string, unknown>): boolean {
  const status = String((session as any)?.status ?? "");
  if (status === "closed" || status === "voided" || status === "cancelled") return true;
  return (session as any)?.isPaid === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/retention/__tests__/horizon.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/retention/horizon.ts src/lib/server/retention/__tests__/horizon.test.ts
git commit -m "feat(retention): add per-store retention horizon module"
```

---

### Task 2: Kitchen-block preservation (pure function)

The load-bearing piece. Kept pure so it can be tested without Firestore.

**Files:**
- Create: `src/lib/server/retention/preserve-kitchen.ts`
- Test: `src/lib/server/retention/__tests__/preserve-kitchen.test.ts`

**Interfaces:**
- Consumes: `DailyMetric` from `@/lib/types`.
- Produces: `preserveKitchenBlock(fresh: DailyMetric, existing: DailyMetric | null | undefined): DailyMetric`.

Behaviour contract:
1. Returns `fresh` unchanged when `existing` is null/undefined or has no `kitchen` block.
2. Otherwise replaces `fresh.kitchen` with `existing.kitchen`.
3. Merges `staffNames` as a union, **fresh values winning on key collision** — `staffNames` is also written by the server-confirmation block, which still recomputes from live session documents, so a wholesale splice would resurrect names the rebuild correctly dropped.
4. Sets `meta.kitchenPreservedFromPurge = true`.
5. Never mutates either argument.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/retention/__tests__/preserve-kitchen.test.ts
import { describe, it, expect } from "vitest";
import type { DailyMetric } from "@/lib/types";
import { preserveKitchenBlock } from "../preserve-kitchen";

const day = (over: Partial<DailyMetric> = {}): DailyMetric =>
  ({
    meta: { dayId: "2026-05-01", dayStartMs: 1, storeId: "s1" },
    kitchen: {
      servedCountByType: {},
      cancelledCountByType: {},
      durationMsSumByType: {},
      durationCountByType: {},
      durationMsSumByLocation: {},
      durationCountByLocation: {},
      servingMsSumByUser: {},
      servingCountByUser: {},
    },
    staffNames: {},
    ...over,
  }) as DailyMetric;

describe("preserveKitchenBlock", () => {
  it("returns fresh untouched when there is no existing doc", () => {
    const fresh = day();
    expect(preserveKitchenBlock(fresh, null)).toBe(fresh);
    expect(preserveKitchenBlock(fresh, undefined)).toBe(fresh);
  });

  it("returns fresh untouched when the existing doc has no kitchen block", () => {
    const fresh = day();
    const existing = day({ kitchen: undefined });
    expect(preserveKitchenBlock(fresh, existing)).toBe(fresh);
  });

  it("carries the existing kitchen block forward over a zeroed rebuild", () => {
    const fresh = day();
    const existing = day({
      kitchen: {
        servedCountByType: { refill: 12 },
        cancelledCountByType: { refill: 1 },
        durationMsSumByType: { refill: 5000 },
        durationCountByType: { refill: 12 },
        durationMsSumByLocation: { grill: 5000 },
        durationCountByLocation: { grill: 12 },
        servingMsSumByUser: { p1: 5000 },
        servingCountByUser: { p1: 12 },
      },
    });

    const out = preserveKitchenBlock(fresh, existing);

    expect(out.kitchen).toEqual(existing.kitchen);
    expect(out.kitchen!.servingMsSumByUser).toEqual({ p1: 5000 });
    expect((out.meta as any).kitchenPreservedFromPurge).toBe(true);
  });

  it("merges staffNames with fresh winning on collision", () => {
    const fresh = day({ staffNames: { p1: "Ana (current)", p3: "Cely" } });
    const existing = day({ staffNames: { p1: "Ana (stale)", p2: "Ben" } });

    const out = preserveKitchenBlock(fresh, existing);

    expect(out.staffNames).toEqual({
      p1: "Ana (current)",
      p2: "Ben",
      p3: "Cely",
    });
  });

  it("does not mutate either argument", () => {
    const fresh = day({ staffNames: { p1: "Ana" } });
    const existing = day({
      kitchen: {
        servedCountByType: { refill: 3 },
        cancelledCountByType: {},
        durationMsSumByType: {},
        durationCountByType: {},
        durationMsSumByLocation: {},
        durationCountByLocation: {},
        servingMsSumByUser: {},
        servingCountByUser: {},
      },
      staffNames: { p2: "Ben" },
    });
    const freshCopy = structuredClone(fresh);
    const existingCopy = structuredClone(existing);

    preserveKitchenBlock(fresh, existing);

    expect(fresh).toEqual(freshCopy);
    expect(existing).toEqual(existingCopy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/retention/__tests__/preserve-kitchen.test.ts`
Expected: FAIL — cannot resolve `../preserve-kitchen`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/server/retention/preserve-kitchen.ts
import type { DailyMetric } from "@/lib/types";

/**
 * Carry a purged day's existing `kitchen` block forward through a rebuild.
 *
 * Kitchen tickets are the only source for kitchen.* (see
 * src/lib/analytics/backfill-core.ts:244-275). Once they are purged, a rebuild
 * would recompute that block as all-zeros and write it with merge:false,
 * silently destroying per-station speed and per-staff serving stats. For any
 * day older than the store's retention horizon we keep what is already there.
 */
export function preserveKitchenBlock(
  fresh: DailyMetric,
  existing: DailyMetric | null | undefined,
): DailyMetric {
  const existingKitchen = existing?.kitchen;
  if (!existingKitchen) return fresh;

  return {
    ...fresh,
    kitchen: existingKitchen,
    // Fresh wins: the server-confirmation block still recomputes staffNames
    // from live session docs, so a wholesale splice would resurrect names the
    // rebuild correctly dropped.
    staffNames: { ...(existing?.staffNames ?? {}), ...(fresh.staffNames ?? {}) },
    meta: { ...(fresh.meta as any), kitchenPreservedFromPurge: true },
  } as DailyMetric;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/retention/__tests__/preserve-kitchen.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/retention/preserve-kitchen.ts src/lib/server/retention/__tests__/preserve-kitchen.test.ts
git commit -m "feat(retention): preserve kitchen block across a post-purge rebuild"
```

---

### Task 3: Wire the guard into the analytics rebuild

**Files:**
- Modify: `src/lib/server/analytics/backfillServer.ts` (function `rebuildDailyAnalyticsFromReceiptsServer`, lines 22-92)

**Interfaces:**
- Consumes: `retentionDocPath` (Task 1), `preserveKitchenBlock` (Task 2).
- Produces: no signature change — `rebuildDailyAnalyticsFromReceiptsServer` keeps returning `{ days, receipts, tickets }`.

A missing retention document must behave as `purgedBeforeMs = 0`, i.e. current behaviour exactly unchanged, so the guard stays inert on any store that has never been purged.

- [ ] **Step 1: Add the imports**

At the top of `src/lib/server/analytics/backfillServer.ts`, alongside the existing `getActiveStores` import:

```ts
import { retentionDocPath } from "@/lib/server/retention/horizon";
import { preserveKitchenBlock } from "@/lib/server/retention/preserve-kitchen";
```

- [ ] **Step 2: Read the horizon alongside the other reads**

In `rebuildDailyAnalyticsFromReceiptsServer`, immediately after the existing `const [receiptsSnap, ticketsSnap, sessionsSnap] = await Promise.all([...])` block, add:

```ts
  // Any day older than this may have had its kitchen tickets purged, so the
  // recomputed kitchen block would be all-zeros. Absent doc => 0 => inert.
  const retentionSnap = await db.doc(retentionDocPath(storeId)).get();
  const purgedBeforeMs = Number(retentionSnap.data()?.purgedBeforeMs ?? 0) || 0;
```

- [ ] **Step 3: Preserve the kitchen block in the write loop**

Replace the existing write loop body. The current code is:

```ts
  for (const [dayId, data] of aggregates.entries()) {
    (data.meta as any).updatedAt = FieldValue.serverTimestamp();
    (data.meta as any).backfilledAt = FieldValue.serverTimestamp();
    (data.meta as any).source = "backfill_v5_server";
    batch.set(db.doc(`stores/${storeId}/analytics/${dayId}`), data as any, { merge: false });
```

Change it to:

```ts
  for (const [dayId, data] of aggregates.entries()) {
    const dayRef = db.doc(`stores/${storeId}/analytics/${dayId}`);

    let payload = data;
    if (purgedBeforeMs > 0 && Number((data.meta as any)?.dayStartMs ?? 0) < purgedBeforeMs) {
      const existingSnap = await dayRef.get();
      payload = preserveKitchenBlock(data, existingSnap.exists ? (existingSnap.data() as any) : null);
    }

    (payload.meta as any).updatedAt = FieldValue.serverTimestamp();
    (payload.meta as any).backfilledAt = FieldValue.serverTimestamp();
    (payload.meta as any).source = "backfill_v5_server";
    batch.set(dayRef, payload as any, { merge: false });
```

Then update the two remaining references in that loop from `data` to `payload` if any exist, and leave the `opCount`/commit logic untouched.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — no existing test covers this path, so this is a regression check that nothing else broke.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/analytics/backfillServer.ts
git commit -m "fix(analytics): stop a rebuild zeroing kitchen stats for purged days"
```

---

### Task 4: Purge script — tickets and bill lines

**Files:**
- Create: `scripts/purge-dispensable.ts`
- Modify: `package.json` (add `purge:dispensable` script)

**Interfaces:**
- Consumes: `RETENTION_DAYS`, `cutoffMsFor`, `nextHorizonMs`, `isSessionTerminal`, `retentionDocPath` (Task 1).
- Produces: a CLI. No importable exports.

Follows the credential and arg-parsing pattern of `scripts/settle-payment-mix-drift.ts` exactly.

- [ ] **Step 1: Write the script**

```ts
// scripts/purge-dispensable.ts
/**
 * Delete operational documents that are dispensable once a session is paid:
 * kitchen tickets (including every refill order) and session bill lines.
 *
 * Refill counts survive on the receipt (receipt.analytics.servedRefillsByName)
 * and in the day doc; bill lines survive as receipt.items. Kitchen speed and
 * per-staff serving stats survive ONLY in the day doc, which is why this script
 * advances stores/{id}/meta/retention.purgedBeforeMs BEFORE deleting anything —
 * that mark is what stops a later analytics rebuild from zeroing them.
 *
 * Usage (from the project root):
 *   npx tsx scripts/purge-dispensable.ts                  # dry run, all stores
 *   npx tsx scripts/purge-dispensable.ts --store=<id>     # dry run, one store
 *   npx tsx scripts/purge-dispensable.ts --write          # actually delete
 *   npx tsx scripts/purge-dispensable.ts --days=120       # override retention
 *
 * Credentials: reuses FIREBASE_ADMIN_SA_PATH from .env.local. Read-only until
 * --write is passed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type Firestore, type Query } from "firebase-admin/firestore";
import {
  RETENTION_DAYS,
  cutoffMsFor,
  nextHorizonMs,
  isSessionTerminal,
  retentionDocPath,
} from "../src/lib/server/retention/horizon";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const WRITE = args.write === "true";
const STORE_ID_ARG = args.store as string | undefined;
const DAYS = Number(args.days ?? RETENTION_DAYS);

const SESSION_PAGE = 200;
const DELETE_BATCH = 500;

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
}

function initAdmin(): Firestore {
  if (!getApps().length) {
    const saPath = process.env.FIREBASE_ADMIN_SA_PATH;
    if (!saPath) throw new Error("FIREBASE_ADMIN_SA_PATH not set (expected in .env.local).");
    const sa = JSON.parse(readFileSync(saPath, "utf8"));
    initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: String(sa.private_key || "").replace(/\\n/g, "\n"),
      }),
    });
    console.log(`[admin] firebase project: ${sa.project_id}`);
  }
  return getFirestore();
}

/** Delete every doc a query matches, in batches. Returns the count. */
async function deleteQuery(db: Firestore, q: Query): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await q.limit(DELETE_BATCH).get();
    if (snap.empty) return deleted;
    if (!WRITE) return deleted + snap.size; // dry run: count one page, don't loop
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < DELETE_BATCH) return deleted;
  }
}

async function purgeStore(db: Firestore, storeId: string, storeName: string, nowMs: number) {
  const cutoff = cutoffMsFor(nowMs, DAYS);
  const totals = { sessions: 0, kitchentickets: 0, sessionBillLines: 0, skippedOpen: 0 };

  // Advance the horizon FIRST. If this run dies half way, the guard still
  // covers every day we touched. Over-covering is harmless.
  if (WRITE) {
    const ref = db.doc(retentionDocPath(storeId));
    const cur = Number((await ref.get()).data()?.purgedBeforeMs);
    await ref.set(
      { purgedBeforeMs: nextHorizonMs(cur, cutoff), lastRunAtMs: nowMs },
      { merge: true },
    );
  }

  // Sanity check: a range filter silently drops docs missing the field, so a
  // wrong field name returns zero rows and looks like "nothing to purge".
  // If this store has sessions but none carry startedAtClientMs, abort loudly.
  const sessionsTotal = (await db.collection(`stores/${storeId}/sessions`).count().get()).data().count;
  if (sessionsTotal > 0) {
    const withField = (
      await db.collection(`stores/${storeId}/sessions`).orderBy("startedAtClientMs").count().get()
    ).data().count;
    if (withField === 0) {
      throw new Error(
        `${storeId}: ${sessionsTotal} sessions but none carry startedAtClientMs — wrong field, refusing to run.`,
      );
    }
  }

  // Single-field range query — no composite index needed. Terminal status is
  // filtered in memory on purpose (see Global Constraints).
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db
      .collection(`stores/${storeId}/sessions`)
      .where("startedAtClientMs", "<", cutoff)
      .orderBy("startedAtClientMs", "asc")
      .limit(SESSION_PAGE);
    if (cursor) q = q.startAfter(cursor);

    const page = await q.get();
    if (page.empty) break;
    cursor = page.docs[page.docs.length - 1];

    for (const sessionDoc of page.docs) {
      if (!isSessionTerminal(sessionDoc.data() as any)) {
        totals.skippedOpen += 1;
        console.warn(
          `  [anomaly] session ${sessionDoc.id} is older than ${DAYS}d but not terminal — skipped`,
        );
        continue;
      }
      totals.sessions += 1;
      totals.kitchentickets += await deleteQuery(db, sessionDoc.ref.collection("kitchentickets"));
      totals.sessionBillLines += await deleteQuery(db, sessionDoc.ref.collection("sessionBillLines"));
    }

    if (page.size < SESSION_PAGE) break;
  }

  if (WRITE) {
    await db.doc(retentionDocPath(storeId)).set(
      {
        lastRunDeleted: {
          kitchentickets: totals.kitchentickets,
          sessionBillLines: totals.sessionBillLines,
        },
      },
      { merge: true },
    );
  }

  console.log(
    `- ${storeName} [${storeId}]: sessions=${totals.sessions} tickets=${totals.kitchentickets} billLines=${totals.sessionBillLines} skippedOpen=${totals.skippedOpen}`,
  );
  return totals;
}

async function main() {
  loadEnvLocal();
  const db = initAdmin();
  const nowMs = Date.now();

  console.log(
    `[purge] mode=${WRITE ? "WRITE" : "DRY RUN"} retention=${DAYS}d cutoff=${new Date(cutoffMsFor(nowMs, DAYS)).toISOString()}`,
  );
  if (!WRITE) console.log("[purge] dry run — counts are the first page per subcollection, nothing deleted");

  const storeDocs = STORE_ID_ARG
    ? [await db.doc(`stores/${STORE_ID_ARG}`).get()]
    : (await db.collection("stores").get()).docs;

  for (const st of storeDocs) {
    if (!st.exists) {
      console.error(`store not found: ${STORE_ID_ARG}`);
      continue;
    }
    await purgeStore(db, st.id, (st.data() as any)?.name ?? "(no name)", nowMs);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, alongside the other `tsx` scripts:

```json
"purge:dispensable": "tsx scripts/purge-dispensable.ts"
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Dry run against one store**

Run: `npx tsx scripts/purge-dispensable.ts --store=<smallest store id from Task 0>`
Expected: prints `mode=DRY RUN`, a per-store line, and deletes nothing. Verify by re-reading that store's retention doc — it must still not exist.

- [ ] **Step 5: Commit**

```bash
git add scripts/purge-dispensable.ts package.json
git commit -m "feat(retention): add dry-run-first purge script for tickets and bill lines"
```

---

### Task 5: Extend the purge to PINs and customer requests

**Files:**
- Modify: `scripts/purge-dispensable.ts`

**Interfaces:**
- Consumes: `deleteQuery`, `WRITE`, `DELETE_BATCH` from Task 4.
- Produces: no new exports.

`pinRegistry` is a root collection keyed by the PIN itself, so stale docs also consume PIN space.

**Census finding (2026-08-22):** 5,295 pins live, of which **5,277 are already `status == "archived"`**. `CUSTOMER/src/app/api/admin/cleanup-archived-pins/route.ts` was built to delete exactly those (archived, older than 6h) — it is evidently never invoked, since none have been cleaned. Only 18 pins are non-archived, so the expired-but-unarchived gap is negligible; the real win is the 5,277 nobody is sweeping.

Filtering on `expiresAtMs` rather than `status` covers both populations in one query and needs no composite index, so this supersedes the CUSTOMER route rather than duplicating it. Leave that route in place — it is a manual admin tool and harmless — but the scheduled sweep is this one.

- [ ] **Step 1: Add the two cleanup functions**

Insert above `main()`:

```ts
const PIN_GRACE_DAYS = 7;
const REQUEST_RETENTION_DAYS = 90;

/** Root-collection PINs whose 2h TTL lapsed more than a week ago, any status. */
async function purgeStalePins(db: Firestore, nowMs: number): Promise<number> {
  const cutoff = cutoffMsFor(nowMs, PIN_GRACE_DAYS);
  const n = await deleteQuery(
    db,
    db.collection("pinRegistry").where("expiresAtMs", "<", cutoff).orderBy("expiresAtMs", "asc"),
  );
  console.log(`- pinRegistry: ${n} stale pin(s) (expired before ${new Date(cutoff).toISOString()})`);
  return n;
}

/** Assistance / griller requests. Digest reads yesterday only; admin page caps at 1000. */
async function purgeOldRequests(db: Firestore, storeId: string, nowMs: number): Promise<number> {
  const cutoff = cutoffMsFor(nowMs, REQUEST_RETENTION_DAYS);
  return deleteQuery(
    db,
    db
      .collection(`stores/${storeId}/customerRequests`)
      .where("createdAtClientMs", "<", cutoff)
      .orderBy("createdAtClientMs", "asc"),
  );
}
```

- [ ] **Step 2: Call `purgeOldRequests` from `purgeStore`**

Immediately before the `if (WRITE) { ... lastRunDeleted ... }` block in `purgeStore`, add:

```ts
  const requestsDeleted = await purgeOldRequests(db, storeId, nowMs);
```

and extend that store's log line with ` requests=${requestsDeleted}`.

- [ ] **Step 3: Call `purgeStalePins` once from `main`**

After the store loop in `main()`, add:

```ts
  await purgeStalePins(db, nowMs);
```

It is a root collection, so it runs once per invocation, not per store.

- [ ] **Step 4: Typecheck and dry run**

Run: `npm run typecheck && npx tsx scripts/purge-dispensable.ts --store=<same small store>`
Expected: no type errors; output now includes a `requests=` figure and a `pinRegistry:` line; still `mode=DRY RUN`, nothing deleted.

- [ ] **Step 5: Commit**

```bash
git add scripts/purge-dispensable.ts
git commit -m "feat(retention): purge stale pins and old customer requests"
```

---

### Task 6: Nightly cron route

**Files:**
- Create: `src/app/api/cron/purge-dispensable/route.ts`
- Create: `src/lib/server/retention/purge.ts`
- Modify: `docs/CRON.md`

**Interfaces:**
- Consumes: everything from Tasks 1, 4, 5.
- Produces: `runPurge(db: Firestore, opts: { nowMs: number; write: boolean; days?: number }): Promise<PurgeSummary>` where `PurgeSummary = { stores: number; kitchentickets: number; sessionBillLines: number; customerRequests: number; stalePins: number; skippedOpen: number }`.

The script and the route must not diverge. Move the purge body out of `scripts/purge-dispensable.ts` into `src/lib/server/retention/purge.ts` as `runPurge`, and have both the script and the route call it. The script keeps only arg parsing, credential bootstrap, and logging.

- [ ] **Step 1: Extract `runPurge` into `src/lib/server/retention/purge.ts`**

Move `deleteQuery`, `purgeStore`, `purgeStalePins`, and `purgeOldRequests` verbatim into the new module. Replace the module-level `WRITE` constant with a `write: boolean` parameter threaded through each function — that constant is the only thing preventing these from being reusable. Export `runPurge` with the signature above; keep everything else module-private.

- [ ] **Step 2: Reduce the script to a thin wrapper**

`scripts/purge-dispensable.ts` keeps `loadEnvLocal`, `initAdmin`, arg parsing, and the console output, and calls `runPurge(db, { nowMs: Date.now(), write: WRITE, days: DAYS })`.

- [ ] **Step 3: Write the cron route**

```ts
// src/app/api/cron/purge-dispensable/route.ts
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { runPurge } from "@/lib/server/retention/purge";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Nightly retention sweep. Deletes kitchen tickets and session bill lines under
 * terminal sessions older than the retention horizon, plus stale PINs and old
 * customer requests. Advances stores/{id}/meta/retention.purgedBeforeMs before
 * deleting, which is what keeps a later analytics rebuild from zeroing the
 * kitchen block for those days.
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/purge-dispensable] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Opt-in write: ?write=1. Without it the cron reports what it would delete,
  // so the job can be scheduled and observed before it is armed.
  const write = new URL(request.url).searchParams.get("write") === "1";

  try {
    const summary = await runPurge(getAdminDb(), { nowMs: Date.now(), write });
    console.log(`[cron/purge-dispensable] write=${write} ${JSON.stringify(summary)}`);
    return NextResponse.json({ ok: true, write, ...summary });
  } catch (err: any) {
    console.error("[cron/purge-dispensable] failed:", err);
    return NextResponse.json({ error: err?.message || "Purge cron failed." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Document it**

Append an entry to `docs/CRON.md` matching the format of the existing seven entries: path `/api/cron/purge-dispensable`, suggested schedule `0 3 * * *` Asia/Manila (after the 2am archive job on the droplet, so a night's receipts are archived before anything is deleted), auth header `Authorization: Bearer ${CRON_SECRET}`, and a note that it is dry-run unless `?write=1` is appended.

- [ ] **Step 5: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass. Stop the dev server first if one is running on 9003 — `next build` overwrites the `.next` a running `next dev` is serving.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/retention/purge.ts scripts/purge-dispensable.ts src/app/api/cron/purge-dispensable/route.ts docs/CRON.md
git commit -m "feat(retention): add nightly purge cron, dry-run until armed"
```

---

### Task 7: Staged production verification

**Files:** none — this is the go-live gate.

Mirrors the staged pattern the Postgres archive backfill used successfully. Do not skip to all stores.

- [ ] **Step 1: Dry run, all stores**

Run: `npx tsx scripts/purge-dispensable.ts`
Expected: per-store counts, `mode=DRY RUN`, no retention doc created anywhere. Record the totals and compare them against Task 0's census — a large divergence means the terminal-session filter is wrong, so stop and investigate.

- [ ] **Step 2: Write against the TEST store only**

Run: `npx tsx scripts/purge-dispensable.ts --store=TEST --write`
Expected: deletions reported; `stores/TEST/meta/retention.purgedBeforeMs` now set to the cutoff.

- [ ] **Step 3: Prove the guard on real data**

Pick a purged day for the TEST store. Read `stores/TEST/analytics/{dayId}` and record its `kitchen` block. Trigger a rebuild for that single day through `/admin/reconcile`. Re-read the day doc.
Expected: the `kitchen` block is **identical**, and `meta.kitchenPreservedFromPurge === true`.

This is the one test that proves the whole design. If the kitchen block came back zeroed, stop — the horizon was not written before deletion, or the guard is not wired.

- [ ] **Step 4: Write against one real store, then the rest**

Run: `npx tsx scripts/purge-dispensable.ts --store=<one real store> --write`, verify, then run without `--store`.

- [ ] **Step 5: Arm the cron**

Create the Cloud Scheduler job per `docs/CRON.md`. Leave `?write=1` **off** for the first night, check the log, then add it.

- [ ] **Step 6: Hand off**

Report the totals to Ian. Do not push — Ian pushes POS.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4.1 retention horizon doc | 1, 4 |
| §4.1 horizon written before first delete | 4 step 1 (`purgeStore`), verified 7.3 |
| §4.2 purge script, dry-run default, in-memory status filter, anomaly report | 4 |
| §4.3 rebuild guard, staffNames merge, absent-doc inert | 2, 3 |
| §4.4 pins + customer requests | 5 |
| §4.5 cron wiring | 6 |
| §5 no new indexes | Global Constraints; every query single-field |
| §6 testing | 1, 2 (unit), 4.4, 7 (integration) |
| §7 census | 0 |

No gaps.

**Placeholder scan:** none — every code step carries real code; `<id>` placeholders in shell commands are runtime values the operator supplies, not unwritten work.

**Type consistency:** `cutoffMsFor`, `nextHorizonMs`, `isSessionTerminal`, `retentionDocPath` are defined in Task 1 and used with those exact names in Tasks 3, 4, 5. `preserveKitchenBlock(fresh, existing)` is defined in Task 2 and called with that arity in Task 3. `deleteQuery(db, q)` is defined in Task 4 and reused in Task 5, then moved wholesale in Task 6. `runPurge` is introduced in Task 6 only.

**One deliberate rework:** Task 4 writes the purge logic inside the script, and Task 6 extracts it into `src/lib/server/retention/purge.ts` so the cron can share it. Building the shared module up front would mean writing a cron-shaped abstraction before the script has proven what it needs. The extraction is mechanical and the tests from Tasks 1-2 still cover the logic that matters.
