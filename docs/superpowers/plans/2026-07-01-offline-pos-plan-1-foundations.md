# Offline POS — Plan 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, unit-tested foundation modules the offline money-path depends on: a persistent device id, offline receipt numbering (`<storeCode>-OL-<HHMM>-<NNN>`), and a "commit local-first" helper that lets Firestore writes complete with no connection.

**Architecture:** Three small, dependency-injected modules under `src/lib/offline/`. Each takes its storage/clock/batch as a parameter so it is testable in Node (matching the repo's existing pure-unit-test style) while production supplies `localStorage`, the real `Date`, and a Firestore `WriteBatch`. No Firestore, IndexedDB, or React is imported by the tested logic. These modules are consumed by Plan 2 (offline session start) and Plan 3 (offline payment).

**Tech Stack:** TypeScript, Firebase JS SDK v10 (Firestore), Vitest (node environment), Next.js/Capacitor client build.

## Global Constraints

- Node engine: `>=20 <21` (from `package.json`).
- Tests: Vitest, `environment: "node"`, glob `src/**/*.test.ts` (from `vitest.config.ts`). Path alias `@` → `./src`.
- Follow the existing pure-unit-test pattern (see `src/lib/tax.test.ts`): test pure functions with in-memory fakes; do **not** spin up a Firestore emulator, jsdom, or real IndexedDB.
- Do **not** add new runtime dependencies. Prefer dependency injection over test-only libraries (e.g. no `fake-indexeddb`).
- Browser-facing modules start with `"use client";` (repo convention).
- Offline receipt number format is exactly `<storeCode>-OL-<HHMM>-<NNN>`, e.g. `SHT-OL-0320-001` (store `code` from `Store.code` in `src/lib/types.ts:712`; `HHMM` from the device clock at finalize; `NNN` = zero-padded per-device daily sequence starting at 1).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. One logical change per commit.

---

### Task 1: Device identity

**Files:**
- Create: `src/lib/offline/device.ts`
- Test: `src/lib/offline/device.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `export interface KVStore { getItem(key: string): string | null; setItem(key: string, value: string): void; }`
  - `export function getDeviceId(store: KVStore, genId?: () => string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/device.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getDeviceId, type KVStore } from "@/lib/offline/device";

function memStore(): KVStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("getDeviceId", () => {
  it("generates and persists an id on first call", () => {
    const store = memStore();
    let n = 0;
    expect(getDeviceId(store, () => `uuid-${++n}`)).toBe("uuid-1");
  });

  it("returns the same id on subsequent calls (persisted)", () => {
    const store = memStore();
    let n = 0;
    const first = getDeviceId(store, () => `uuid-${++n}`);
    const second = getDeviceId(store, () => `uuid-${++n}`);
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline/device.test.ts`
Expected: FAIL — cannot resolve `@/lib/offline/device` / `getDeviceId is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/offline/device.ts`:

```ts
"use client";

/** Minimal synchronous key/value store (localStorage-compatible) so the
 *  device-id logic is unit-testable with an in-memory fake. */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEVICE_ID_KEY = "pos_device_id";

/**
 * Returns a stable, persistent device id for this install, creating one on the
 * first call. `genId` is injectable so tests are deterministic; production
 * defaults to `crypto.randomUUID()`. Used for the session ownership stamp and
 * sync-report attribution (not for receipt numbering).
 */
export function getDeviceId(
  store: KVStore,
  genId: () => string = () => crypto.randomUUID(),
): string {
  const existing = store.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = genId();
  store.setItem(DEVICE_ID_KEY, id);
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline/device.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/device.ts src/lib/offline/device.test.ts
git commit -m "feat(offline): persistent device id with injectable store"
```

---

### Task 2: Offline receipt numbering

**Files:**
- Create: `src/lib/offline/offlineReceiptNumber.ts`
- Test: `src/lib/offline/offlineReceiptNumber.test.ts`

**Interfaces:**
- Consumes: `KVStore` from `@/lib/offline/device`.
- Produces:
  - `export function formatOfflineReceiptNumber(args: { storeCode: string; date: Date; seq: number }): string`
  - `export function nextDailySeq(store: KVStore, date: Date): number`
  - `export function allocateOfflineReceiptNumber(store: KVStore, storeCode: string, date: Date): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/offlineReceiptNumber.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formatOfflineReceiptNumber,
  nextDailySeq,
  allocateOfflineReceiptNumber,
} from "@/lib/offline/offlineReceiptNumber";
import type { KVStore } from "@/lib/offline/device";

function memStore(): KVStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("formatOfflineReceiptNumber", () => {
  it("formats <storeCode>-OL-<HHMM>-<NNN> with zero-padding", () => {
    const date = new Date(2026, 6, 1, 3, 20, 0); // 03:20 local
    expect(formatOfflineReceiptNumber({ storeCode: "SHT", date, seq: 1 })).toBe(
      "SHT-OL-0320-001",
    );
  });

  it("pads hours, minutes and sequence correctly", () => {
    const date = new Date(2026, 6, 1, 9, 5, 0); // 09:05 local
    expect(formatOfflineReceiptNumber({ storeCode: "MNL", date, seq: 42 })).toBe(
      "MNL-OL-0905-042",
    );
  });
});

describe("nextDailySeq", () => {
  it("starts at 1 and increments within the same day", () => {
    const store = memStore();
    const d = new Date(2026, 6, 1, 10, 0, 0);
    expect(nextDailySeq(store, d)).toBe(1);
    expect(nextDailySeq(store, d)).toBe(2);
    expect(nextDailySeq(store, d)).toBe(3);
  });

  it("resets to 1 when the local calendar day changes", () => {
    const store = memStore();
    expect(nextDailySeq(store, new Date(2026, 6, 1, 23, 59, 0))).toBe(1);
    expect(nextDailySeq(store, new Date(2026, 6, 1, 23, 59, 30))).toBe(2);
    expect(nextDailySeq(store, new Date(2026, 6, 2, 0, 1, 0))).toBe(1);
  });
});

describe("allocateOfflineReceiptNumber", () => {
  it("allocates a sequence and formats it in one call", () => {
    const store = memStore();
    const d = new Date(2026, 6, 1, 3, 20, 0);
    expect(allocateOfflineReceiptNumber(store, "SHT", d)).toBe("SHT-OL-0320-001");
    expect(allocateOfflineReceiptNumber(store, "SHT", d)).toBe("SHT-OL-0320-002");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline/offlineReceiptNumber.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/offline/offlineReceiptNumber.ts`:

```ts
"use client";

import type { KVStore } from "@/lib/offline/device";

/** Zero-pads a non-negative integer to `width` digits. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Formats an offline receipt number `<storeCode>-OL-<HHMM>-<NNN>`.
 * `date` supplies the device wall-clock finalize time; `seq` is the per-device
 * daily sequence. Example: `SHT-OL-0320-001`.
 */
export function formatOfflineReceiptNumber(args: {
  storeCode: string;
  date: Date;
  seq: number;
}): string {
  const { storeCode, date, seq } = args;
  const hhmm = pad(date.getHours(), 2) + pad(date.getMinutes(), 2);
  return `${storeCode}-OL-${hhmm}-${pad(seq, 3)}`;
}

const SEQ_KEY = "pos_offline_seq";

interface DailySeqState {
  ymd: string; // local calendar day the counter belongs to
  seq: number; // last issued sequence for that day
}

function localYmd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * Allocates the next gapless per-device sequence for the local day of `date`,
 * resetting to 1 when the calendar day changes. Persisted via `KVStore` so it
 * survives reloads. NOTE: production callers must serialize access to avoid two
 * tabs reusing a sequence; the durable IndexedDB single-writer wrapper is added
 * in Plan 3 where this is wired into payment.
 */
export function nextDailySeq(store: KVStore, date: Date): number {
  const ymd = localYmd(date);
  let state: DailySeqState | null = null;
  const raw = store.getItem(SEQ_KEY);
  if (raw) {
    try {
      state = JSON.parse(raw) as DailySeqState;
    } catch {
      state = null;
    }
  }
  const seq = state && state.ymd === ymd ? state.seq + 1 : 1;
  store.setItem(SEQ_KEY, JSON.stringify({ ymd, seq }));
  return seq;
}

/** Convenience: allocate the next daily sequence and format it in one call. */
export function allocateOfflineReceiptNumber(
  store: KVStore,
  storeCode: string,
  date: Date,
): string {
  const seq = nextDailySeq(store, date);
  return formatOfflineReceiptNumber({ storeCode, date, seq });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline/offlineReceiptNumber.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/offlineReceiptNumber.ts src/lib/offline/offlineReceiptNumber.test.ts
git commit -m "feat(offline): offline receipt numbering (storeCode-OL-HHMM-NNN)"
```

---

### Task 3: Commit-local-first helper

**Files:**
- Create: `src/lib/offline/commit.ts`
- Test: `src/lib/offline/commit.test.ts`

**Interfaces:**
- Consumes: nothing (declares its own minimal batch shape so it carries no Firestore import).
- Produces:
  - `export interface Committable { commit(): Promise<void>; }`
  - `export function commitLocalFirst(batch: Committable, onError?: (err: unknown) => void): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/commit.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { commitLocalFirst, type Committable } from "@/lib/offline/commit";

describe("commitLocalFirst", () => {
  it("returns synchronously even when the commit never resolves (offline)", () => {
    const batch: Committable = { commit: () => new Promise<void>(() => {}) };
    expect(() => commitLocalFirst(batch)).not.toThrow();
  });

  it("invokes the batch commit exactly once", () => {
    const commit = vi.fn(() => Promise.resolve());
    commitLocalFirst({ commit });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("routes a server-side commit failure to onError", async () => {
    const err = new Error("permission denied");
    const onError = vi.fn();
    commitLocalFirst({ commit: () => Promise.reject(err) }, onError);
    // let the rejection microtask settle
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("swallows a commit failure when no onError is given (no synchronous throw)", () => {
    const commit = vi.fn(() => Promise.reject(new Error("x")));
    expect(() => commitLocalFirst({ commit })).not.toThrow();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline/commit.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/offline/commit.ts`:

```ts
"use client";

/** The subset of Firebase's `WriteBatch` we depend on — declared locally so the
 *  helper is unit-testable with a fake and carries no hard Firestore import. */
export interface Committable {
  commit(): Promise<void>;
}

/**
 * Commits a batch "local-first". Firestore applies a batch's writes to the local
 * cache synchronously inside `commit()`, but the returned promise only resolves
 * once the SERVER acknowledges — which never happens while offline. We therefore
 * DO NOT await it: we return immediately (the caller already holds any
 * pre-generated doc ids) and route a late server-side failure to `onError` for
 * the sync report. This is the change that lets writes complete with no
 * connection.
 */
export function commitLocalFirst(
  batch: Committable,
  onError?: (err: unknown) => void,
): void {
  // Calling commit() triggers the synchronous local-cache write. The promise is
  // intentionally not awaited; we only observe eventual failure.
  void batch.commit().catch((err) => {
    if (onError) onError(err);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline/commit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full offline suite and commit**

Run: `npx vitest run src/lib/offline`
Expected: PASS (all Task 1–3 tests, 11 total).

```bash
git add src/lib/offline/commit.ts src/lib/offline/commit.test.ts
git commit -m "feat(offline): commit-local-first helper for offline-safe writes"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- Device identity (spec §4.2.1) → Task 1. ✅
- Offline receipt numbering `<storeCode>-OL-<HHMM>-<NNN>` (spec §3, §4.2.2) → Task 2. ✅
- The offline-write mechanism / non-resolving `commit()` (spec §4.1, §2) → Task 3. ✅
- Deferred to later plans (explicitly out of scope here): transaction→batch conversion of `startSession`/payment/void/kitchen (Plans 2, 3, 5), durable IndexedDB outbox + sync engine (Plan 4), connectivity service + offline UI (Plans 4/6), reference-data cache warming (Plan 6). Tracked in the roadmap below.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every step carries full code and exact commands. ✅

**Type consistency:** `KVStore` defined in Task 1 and reused verbatim in Task 2. `Committable` defined and used only in Task 3. Function names match between Interfaces blocks and implementations (`getDeviceId`, `formatOfflineReceiptNumber`, `nextDailySeq`, `allocateOfflineReceiptNumber`, `commitLocalFirst`). ✅

---

## Roadmap (subsequent plans)

Each plan below is written only after the prior one is executed and reviewed, so it can encode the real, as-merged signatures.

- **Plan 2 — Offline session start & billing:** convert `startSession` (`src/components/cashier/firestore.ts:136`) from `runTransaction` (writes-only — 1:1 mappable) to `writeBatch` committed via `commitLocalFirst`; stamp `ownerTerminalId` (device id) + monotonic `revision`; confirm bill-line edits already work offline. Delivers: start a session and take orders with no connection.
- **Plan 3 — Offline payment, numbering & receipt print:** convert `completePaymentFromUnits` to `writeBatch` + `allocateOfflineReceiptNumber`; back the daily sequence with a durable IndexedDB single-writer; unify the existing `src/lib/offline/payment-queue.ts`; print via existing `printHub`. Delivers: take payment + print receipt with no connection.
  - **Guardrail (from Plan 1 final review) — never let numbering crash the sale:** `nextDailySeq` throws on corrupt persisted state (correct — refusing to reissue a duplicate OR number). The payment path MUST wrap allocation in try/catch and enter controlled recovery (re-init today's counter and/or surface to the sync report), never let the throw bubble into the payment modal. The spec's cardinal rule is "never block the sale" (spec §5, §4.3).
  - **Guardrail — the sync `nextDailySeq` is NOT the atomic single-writer.** Firestore runs `persistentMultipleTabManager`, so multi-tab is a real race. `nextDailySeq(kv, date)` is a synchronous read-modify-write and cannot run inside an async IndexedDB transaction via the `KVStore` seam. Plan 3 must **re-implement the read-modify-write inside the async IDB transaction** (single-writer); treat Plan 1's `nextDailySeq` as the *reference rule*, not a drop-in atomic allocator.
  - **Guardrail — OL numbers are unique only within (store, day).** The format has no date component, so `SHT-OL-0320-001` repeats across days. Consumers must always store/query the OL number **paired with its date** and never use it as a standalone unique key.
- **Plan 4 — Durable outbox & idempotent sync engine:** IndexedDB outbox with idempotency keys for deferred side effects (loyalty/PIN/analytics `/api/*`); upgrade `use-payment-queue-sync`; add real connectivity reachability probe; sync report. Delivers: reliable exactly-once sync + online/offline indicator.
- **Plan 5 — Void & kitchen tickets offline:** convert `voidSession` and `createKitchenTickets` to batch; local kitchen-printer path. Delivers: void + kitchen tickets offline.
- **Plan 6 — Reference-data cache warming & offline UX:** warm menu/products/tables/store config/receipt settings for cold full-day offline; offline banner, unsynced count, sync-report UI; on-device APK test pass.
