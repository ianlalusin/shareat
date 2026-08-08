# Offline POS — Plan 2: Offline Session Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier start a dining/ala-carte session with **no internet**, by converting `startSession` from an offline-incompatible Firestore transaction to a local-first `writeBatch` committed via `commitLocalFirst`, and stamping each session with an owner/`revision` for later conflict handling.

**Architecture:** `startSession`'s transaction body is **writes-only** (no `transaction.get`), so it maps 1:1 to a `writeBatch`. We swap the mechanism in place (preserving every existing write payload verbatim), commit via Plan 1's `commitLocalFirst` (which does not await the server ack that never arrives offline), fire the post-write activity log **without awaiting** it, and add `ownerTerminalId` + `revision` fields from two small new helpers. The intricate session/package/bundle/KDS write payloads are **not** rewritten — only the transaction wrapper, the commit call, and the activity-log await change — which keeps regression risk on this critical working function minimal.

**Tech Stack:** TypeScript, Firebase JS SDK v10 (Firestore, offline persistence already enabled), Next.js/Capacitor client build, Vitest (node).

## Global Constraints

- Node engine `>=20 <21`. Vitest, `environment: "node"`, glob `src/**/*.test.ts`, alias `@` → `./src`. Follow the repo's pure-unit-test pattern (in-memory fakes).
- Do **not** add new runtime dependencies. Browser-facing modules start with `"use client";`.
- **Reuse Plan 1 modules** (already merged on this branch): `commitLocalFirst` from `@/lib/offline/commit`, `getDeviceId` + `KVStore` from `@/lib/offline/device`.
- In the offline-critical path, **never await a Firestore server ack**: commit via `commitLocalFirst`; fire `writeActivityLog` without `await`.
- **Preserve `startSession`'s existing write payloads exactly.** The ONLY changes to its body: (1) `runTransaction(db, async (transaction) => { … })` → `const batch = writeBatch(db); … ` with `transaction.` → `batch.`; (2) `commitLocalFirst(batch, …)` after the writes; (3) `ownerTerminalId` + `revision` added to the session doc and its `activeSessions` projection; (4) `await writeActivityLog(...)` → fire-and-forget local-first. Do not touch any field values, bundle-overflow math, kitchen-ticket, or KDS-projection logic.
- Session ownership contract (spec §4.4): every session carries `ownerTerminalId: string` (device id) and `revision: number` (starts at 1; later payment/void writes increment it).
- Typecheck command: `npm run typecheck` (`tsc --noEmit`).
- **Testing reality:** Firestore's IndexedDB-backed offline persistence cannot be exercised in Node/Vitest and the repo has no Firestore emulator. Pure helpers get unit tests (TDD). The `startSession` conversion is verified by `npm run typecheck` plus the **mandatory on-device offline protocol** in Task 2 — this protocol IS the acceptance test, not an optional extra.

---

### Task 1: Session-ownership helper + browser device-id accessor

**Files:**
- Create: `src/lib/offline/sessionOwnership.ts`
- Create: `src/lib/offline/browserDevice.ts`
- Test: `src/lib/offline/sessionOwnership.test.ts`
- Test: `src/lib/offline/browserDevice.test.ts`

**Interfaces:**
- Consumes: `getDeviceId`, `KVStore` from `@/lib/offline/device` (Plan 1, merged).
- Produces:
  - `export function sessionOwnershipFields(deviceId: string, revision?: number): { ownerTerminalId: string; revision: number }`
  - `export function getBrowserDeviceId(store?: KVStore): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/offline/sessionOwnership.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sessionOwnershipFields } from "@/lib/offline/sessionOwnership";

describe("sessionOwnershipFields", () => {
  it("stamps the owning terminal and initializes revision to 1 by default", () => {
    expect(sessionOwnershipFields("device-abc")).toEqual({
      ownerTerminalId: "device-abc",
      revision: 1,
    });
  });

  it("accepts an explicit starting revision", () => {
    expect(sessionOwnershipFields("device-abc", 5)).toEqual({
      ownerTerminalId: "device-abc",
      revision: 5,
    });
  });
});
```

Create `src/lib/offline/browserDevice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getBrowserDeviceId } from "@/lib/offline/browserDevice";
import type { KVStore } from "@/lib/offline/device";

function memStore(): KVStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("getBrowserDeviceId", () => {
  it("returns a stable, non-empty id backed by the provided store", () => {
    const store = memStore();
    const a = getBrowserDeviceId(store);
    const b = getBrowserDeviceId(store);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(b).toBe(a); // persisted, so stable across calls
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/offline/sessionOwnership.test.ts src/lib/offline/browserDevice.test.ts`
Expected: FAIL — modules/exports not found.

- [ ] **Step 3: Write minimal implementations**

Create `src/lib/offline/sessionOwnership.ts`:

```ts
"use client";

/**
 * Fields stamped on a session at creation for the offline conflict model
 * (spec §4.4): which device owns the session and a monotonic revision that
 * later payment/void writes increment. Pure so it is unit-testable.
 */
export function sessionOwnershipFields(
  deviceId: string,
  revision: number = 1,
): { ownerTerminalId: string; revision: number } {
  return { ownerTerminalId: deviceId, revision };
}
```

Create `src/lib/offline/browserDevice.ts`:

```ts
"use client";

import { getDeviceId, type KVStore } from "@/lib/offline/device";

/**
 * Resolves this install's persistent device id from the browser's
 * localStorage. `store` is injectable for tests; at runtime it defaults to
 * `window.localStorage` (this module is client-only). Referencing `window`
 * lazily (inside the call, not at module load) keeps the import SSR-safe.
 */
export function getBrowserDeviceId(store?: KVStore): string {
  const kv = store ?? (window.localStorage as unknown as KVStore);
  return getDeviceId(kv);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/offline/sessionOwnership.test.ts src/lib/offline/browserDevice.test.ts`
Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/sessionOwnership.ts src/lib/offline/sessionOwnership.test.ts src/lib/offline/browserDevice.ts src/lib/offline/browserDevice.test.ts
git commit -m "feat(offline): session-ownership fields + browser device-id accessor"
```

(Append the two standard trailer lines to the commit message: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01WgURiYhzTBxNtqXqT5F1uw`, with a blank line before them.)

---

### Task 2: Convert `startSession` to a local-first offline batch

**Files:**
- Modify: `src/components/cashier/firestore.ts` — function `startSession` (currently `runTransaction`-based, approx. lines 136–372) and its import block (approx. lines 5–51).

**Interfaces:**
- Consumes: `commitLocalFirst` from `@/lib/offline/commit`; `sessionOwnershipFields` from `@/lib/offline/sessionOwnership`; `getBrowserDeviceId` from `@/lib/offline/browserDevice`. `writeBatch` is already imported in `firestore.ts`.
- Produces: `startSession` keeps its existing signature `startSession(storeId: string, payload: StartSessionPayload, user: AppUser): Promise<string>` and still returns `newSessionRef.id`, but now resolves immediately (local-first) and works offline.

This task edits the real file in place. Do NOT reproduce the unchanged write payloads — apply exactly the changes below and leave every field value as-is.

- [ ] **Step 1: Add the three imports**

In `src/components/cashier/firestore.ts`, in the existing import block near the top (after the existing `import { writeActivityLog } from '@/components/cashier/activity-log';` line at ~line 51), add:

```ts
import { commitLocalFirst } from '@/lib/offline/commit';
import { sessionOwnershipFields } from '@/lib/offline/sessionOwnership';
import { getBrowserDeviceId } from '@/lib/offline/browserDevice';
```

- [ ] **Step 2: Stamp ownership onto the session payload and projection**

In `startSession`, immediately before the `const sessionPayload = stripUndefined({` line, add:

```ts
  const ownership = sessionOwnershipFields(getBrowserDeviceId());
```

Then inside the `sessionPayload = stripUndefined({ … })` object literal, add `...ownership,` right after the `id: newSessionRef.id,` line.

Then inside the `projectionPayload = { … }` object literal (the `activeSessions` projection, which also begins `id: newSessionRef.id,`), add `...ownership,` right after its `id: newSessionRef.id,` line.

Leave every other field in both objects unchanged.

- [ ] **Step 3: Swap the transaction wrapper for a batch**

Replace the transaction opener. Change:

```ts
  await runTransaction(db, async (transaction) => {
```

to:

```ts
  const batch = writeBatch(db);
```

Then, within the former transaction body, replace every `transaction.` with `batch.` (there are write calls on: `newSessionRef` set; `tableRef` update; `tableProjectionRef` update; `sessionProjectionRef` set; the package `lineRef` set; the bundle `extraLineRef` set; the `ticketRef` set; the `rtKdsDocRef` set and update). Do not change any arguments to those calls.

At the end of the former transaction body, replace the transaction's closing `});` (the one that closed `runTransaction(db, async (transaction) => {`) with a plain close of the block you no longer have — i.e. remove that `});` entirely, since `const batch = writeBatch(db);` opened no callback. After the last `batch.*` write statement, add:

```ts
  commitLocalFirst(batch, (err) => {
    console.error('[startSession] batch sync failed', err);
  });
```

> Note on same-document writes: the original code calls `batch.set(rtKdsDocRef, …, { merge: true })` and then `batch.update(rtKdsDocRef, …)`. A `writeBatch` permits multiple ordered writes to the same document, so this preserves the original semantics.

- [ ] **Step 4: Fire the activity log local-first (don't await)**

Later in `startSession`, change:

```ts
  await writeActivityLog({
```

to:

```ts
  void writeActivityLog({
```

and after that call's closing `});`, append `.catch((err) => console.warn('[startSession] activity log sync failed', err));` so the fired promise is handled. `writeActivityLog` internally uses a `writeBatch`, whose `commit()` never resolves offline; firing it without `await` lets the local write apply while `startSession` returns immediately. Keep the final `return newSessionRef.id;` unchanged.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors). If `runTransaction` is now unused elsewhere, leave the import — other functions in this file still use it (`completePaymentFromUnits`, `voidSession`), so do not remove it.

- [ ] **Step 6: On-device offline acceptance protocol (MANDATORY — this is the test)**

Build and run the app, then verify offline behavior. Preferred: the Capacitor APK on a device/emulator (`npm run build:cap` then install). Acceptable fallback for the Firestore-offline behavior: `npm run dev`, open the cashier in Chrome, and use DevTools → Network → **Offline**.

Record PASS/FAIL for each in the report:
1. Go offline (airplane mode / DevTools Offline).
2. **Ala-carte:** open the cashier, start an ala-carte session. Expected: no spinner hang; a session id is returned; the app navigates to `/cashier?sessionId=<id>` and the new session is visible (served from local cache). PASS/FAIL.
3. **Package dine-in:** start a package/table session. Expected: navigates to `/pins?sessionId=<id>`; the session and its package bill line exist; for a package with a kitchen location, a kitchen ticket was created locally. PASS/FAIL.
4. **Bill edit offline:** add/adjust a bill line on the offline session. Expected: it persists locally (this path already uses `writeBatch`). PASS/FAIL.
5. Inspect the offline session doc (via app UI or, once online, Firestore console) and confirm it carries `ownerTerminalId` and `revision: 1`. PASS/FAIL.
6. **Reconnect** (go back online). Expected within a few seconds: the session(s), bill lines, kitchen ticket, and activity log appear in the Firestore backend (check the Firebase console), with no duplicate documents. PASS/FAIL.

If any step FAILS, report status BLOCKED with the specific step and observed behavior rather than committing.

- [ ] **Step 7: Commit**

```bash
git add src/components/cashier/firestore.ts
git commit -m "feat(offline): start sessions offline via local-first writeBatch"
```

(Append the two standard trailer lines as in Task 1.)

---

## Self-Review

**Spec coverage (this plan's slice):**
- Convert `startSession` `runTransaction` → `writeBatch` (spec §4.1) → Task 2. ✅
- Local-first commit that doesn't block offline (spec §2, §4.1) → Task 2 Steps 3–4 via `commitLocalFirst` + fire-and-forget activity log. ✅
- Session ownership `ownerTerminalId` + `revision` (spec §4.4) → Task 1 + Task 2 Step 2. ✅
- Bill-line edits already work offline (spec §4.1) → verified in Task 2 Step 6.4 (no code change needed; they already use `writeBatch`). ✅
- Deferred (not this plan): offline payment + numbering (Plan 3), void + kitchen-ticket *offline finalize* semantics beyond creation (Plan 5), outbox/sync-report + connectivity UI (Plan 4/6). The Plan-1 numbering guardrails do not apply here (no numbering in session start).

**Placeholder scan:** No TBD/TODO. Task 1 carries full code; Task 2 carries exact, anchored edit instructions plus a concrete on-device acceptance protocol (not a hand-wave). ✅

**Type consistency:** `sessionOwnershipFields` / `getBrowserDeviceId` signatures match between the Interfaces block, the implementations, and their Task 2 call sites. `getBrowserDeviceId()` is called with no args in `startSession` (production path → `window.localStorage`); tests pass an injected `KVStore`. `ownership` is spread into both the session doc and its projection so the two stay consistent. ✅

**Risk note:** Task 2 mutates a critical, working function. Mitigations: payloads are preserved verbatim (only wrapper/commit/await change); `writeBatch` is already imported and used elsewhere in the file; the caller (`start-session-form.tsx`) already consumes an immediately-resolved id then navigates, so it needs no change; the on-device protocol exercises ala-carte, package, bundle, bill-edit, ownership fields, and reconnect-sync.
