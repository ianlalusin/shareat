# Offline POS — Plan 4A: Deferred-Effects Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On reconnect, an offline sale replays its **deferred server effects** (analytics apply-delta, loyalty finalize, loyalty earn, PIN finalize) **idempotently**, and the sync path **never re-runs the payment** — eliminating the duplicate-receipt (`OL` + `SELIP`) risk in the current drain.

**Architecture:** The existing `PaymentQueueSyncProvider` drains the queue by re-running `completePaymentFromUnits` (the online payment fn). Now that `completePaymentOffline` already records the sale locally (and Firestore auto-syncs that batch on reconnect), re-running the payment risks a second, server-counter (`SELIP-`) receipt and skips the deferred effects. Plan 4A replaces that drain: the offline sale enqueues a **rich outbox marker** capturing the deferred-effect context (pin, phone, receiptId, amount) at payment time; on reconnect a **replay engine** calls the same `/api/*` endpoints the online modal fires post-payment, tracking **per-effect completion** so a retry never repeats a completed effect. Client-side per-effect tracking is the primary idempotency guard; analytics is additionally server-idempotent (`analyticsApplied`).

**Tech Stack:** TypeScript, Firebase JS SDK v10, Next.js/Capacitor client, Vitest (node). Queue persists in `localStorage` (durable across reload/reboot; race-free in the single-webview APK — same rationale as the offline sequence counter). IndexedDB migration is out of scope (future hardening).

## Global Constraints

- Node `>=20 <21`. Vitest node env, glob `src/**/*.test.ts`, alias `@` → `./src`. Pure-unit-test pattern (in-memory/injected fakes). No new runtime dependencies. Browser modules start with `"use client";`.
- **Do NOT modify `completePaymentFromUnits` or `completePaymentOffline`'s sale-recording writes.** Plan 4A only (a) enriches the outbox marker `completePaymentOffline` enqueues, and (b) replaces the drain logic. The online payment path and the offline batch writes are unchanged.
- The replay must **NEVER call `completePaymentFromUnits`** or otherwise re-record the sale. It only calls `/api/*` deferred-effect endpoints.
- Endpoints + payloads to mirror (verbatim from the online modal / firestore.ts):
  - Analytics: `POST /api/analytics/apply-delta` — match the exact body the online code sends (see `firestore.ts` ~line 764); server is idempotent on `analyticsApplied`.
  - Loyalty finalize: `POST /api/loyalty/finalize` body `{ storeId, sessionId, receiptId }`.
  - Loyalty earn: `POST /api/loyalty/earn` body `{ storeId, sessionId, phone, amount, receiptId }` (only when a linked phone exists).
  - PIN finalize: `POST /api/pins/finalize` body `{ storeId, sessionId, pin, reason: "payment_closed" }`, on failure fallback `POST /api/pins/disable` body `{ storeId, sessionId }` (only when a pin exists).
  - All authorized with `Authorization: Bearer <idToken>`.
- **Idempotency:** track each effect's completion in the outbox item; the engine runs only `pending` effects and removes the item only when none remain `pending`. Known residual risk (document, don't fix here): a crash after a non-idempotent server call (loyalty earn / PIN finalize) succeeds but before the client marks it done could repeat it on retry — mitigated by loyalty/earn's `receiptId` and recommended server-side dedup; note it.
- **Guardrail 5a (stale-cache receipt overwrite):** the replay engine must detect when the server already holds a **non-offline** (`offlineOrigin` not true) final receipt for the session and, in that case, **skip effect replay and flag a conflict** (log + mark the item `failed` with a clear message) rather than applying offline effects on top of an authoritative online sale. Full prevention (a Firestore rule blocking overwrite of a final non-offline receipt) is recommended as future hardening, noted not built.
- Typecheck: `npm run typecheck`. **Testing:** pure outbox state + the replay engine (with injected `fetch`/token) are TDD'd in Node; the end-to-end reconnect behavior is verified by the **on-device protocol** in Task 4.

---

### Task 1: Rich outbox model + pure effect-state helpers

**Files:**
- Modify: `src/lib/offline/payment-queue.ts` (evolve the `QueuedPayment` type + add pure helpers; keep `getQueue/addToQueue/updateQueueItem/removeFromQueue/clearQueue`).
- Test: `src/lib/offline/payment-queue.test.ts` (new).

**Interfaces:**
- Produces:
  - `export type DeferredEffect = "analytics" | "loyaltyFinalize" | "loyaltyEarn" | "pinFinalize";`
  - `export type EffectState = "pending" | "done" | "skip";`
  - `export interface QueuedReceiptContext { pin?: string | null; phone?: string | null; amount: number; }`
  - `export interface QueuedPayment { id: string; storeId: string; sessionId: string; receiptId: string; queuedAtMs: number; status: "pending" | "syncing" | "failed"; ctx: QueuedReceiptContext; effects: Record<DeferredEffect, EffectState>; errorMessage?: string; }`
  - `export function pendingEffects(item: QueuedPayment): DeferredEffect[]`
  - `export function markEffect(item: QueuedPayment, effect: DeferredEffect, state: EffectState): QueuedPayment`
  - `export function isItemComplete(item: QueuedPayment): boolean`
  - (keep existing `getQueue`, `addToQueue`, `updateQueueItem`, `removeFromQueue`, `clearQueue`; `addToQueue` now takes the richer shape.)

- [ ] **Step 1: Write the failing tests** (`src/lib/offline/payment-queue.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  pendingEffects,
  markEffect,
  isItemComplete,
  type QueuedPayment,
} from "@/lib/offline/payment-queue";

function item(overrides: Partial<QueuedPayment> = {}): QueuedPayment {
  return {
    id: "q1",
    storeId: "s1",
    sessionId: "sess1",
    receiptId: "sess1",
    queuedAtMs: 0,
    status: "pending",
    ctx: { pin: "1234", phone: "0917", amount: 100 },
    effects: {
      analytics: "pending",
      loyaltyFinalize: "pending",
      loyaltyEarn: "pending",
      pinFinalize: "pending",
    },
    ...overrides,
  };
}

describe("pendingEffects", () => {
  it("lists only effects still pending", () => {
    const it0 = item({ effects: { analytics: "done", loyaltyFinalize: "pending", loyaltyEarn: "skip", pinFinalize: "pending" } });
    expect(pendingEffects(it0).sort()).toEqual(["loyaltyFinalize", "pinFinalize"]);
  });
});

describe("markEffect", () => {
  it("returns a new item with the effect state changed, others untouched", () => {
    const before = item();
    const after = markEffect(before, "analytics", "done");
    expect(after.effects.analytics).toBe("done");
    expect(after.effects.loyaltyEarn).toBe("pending");
    expect(before.effects.analytics).toBe("pending"); // immutability
  });
});

describe("isItemComplete", () => {
  it("is true when no effect is pending (done/skip only)", () => {
    expect(isItemComplete(item({ effects: { analytics: "done", loyaltyFinalize: "done", loyaltyEarn: "skip", pinFinalize: "done" } }))).toBe(true);
  });
  it("is false when any effect is still pending", () => {
    expect(isItemComplete(item({ effects: { analytics: "done", loyaltyFinalize: "pending", loyaltyEarn: "skip", pinFinalize: "done" } }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/offline/payment-queue.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement.** In `payment-queue.ts`, replace the `QueuedPayment` type with the richer shape above (and the new `DeferredEffect`/`EffectState`/`QueuedReceiptContext` exports), update `addToQueue`'s parameter type to `Omit<QueuedPayment, "id" | "queuedAtMs" | "status">` (callers now supply `receiptId`, `ctx`, `effects`), and add the three pure helpers:

```ts
export type DeferredEffect = "analytics" | "loyaltyFinalize" | "loyaltyEarn" | "pinFinalize";
export type EffectState = "pending" | "done" | "skip";
export interface QueuedReceiptContext { pin?: string | null; phone?: string | null; amount: number; }
export interface QueuedPayment {
  id: string;
  storeId: string;
  sessionId: string;
  receiptId: string;
  queuedAtMs: number;
  status: "pending" | "syncing" | "failed";
  ctx: QueuedReceiptContext;
  effects: Record<DeferredEffect, EffectState>;
  errorMessage?: string;
}

const ALL_EFFECTS: DeferredEffect[] = ["analytics", "loyaltyFinalize", "loyaltyEarn", "pinFinalize"];

export function pendingEffects(item: QueuedPayment): DeferredEffect[] {
  return ALL_EFFECTS.filter((e) => item.effects[e] === "pending");
}

export function markEffect(item: QueuedPayment, effect: DeferredEffect, state: EffectState): QueuedPayment {
  return { ...item, effects: { ...item.effects, [effect]: state } };
}

export function isItemComplete(item: QueuedPayment): boolean {
  return pendingEffects(item).length === 0;
}
```
Keep the localStorage read/write functions; only the item shape and `addToQueue`'s input type change. Preserve the SW background-sync registration in `addToQueue` if present.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/offline/payment-queue.test.ts` → PASS (5 tests). Then `npm run typecheck` — it WILL flag the old `addToQueue({ storeId, sessionId, payload })` call in `offlinePayment.ts` and the old drain in `PaymentQueueSyncProvider.tsx`; that is expected — those are updated in Tasks 3 & 4. If you want a green typecheck at this step, you may temporarily leave them; they are fixed in the later tasks. Note the failing call sites in your report.

- [ ] **Step 5: Commit** (trailer lines as standard)
```bash
git add src/lib/offline/payment-queue.ts src/lib/offline/payment-queue.test.ts
git commit -m "feat(offline): rich outbox model + per-effect state helpers"
```

---

### Task 2: Deferred-effects replay engine

**Files:**
- Create: `src/lib/offline/replayDeferredEffects.ts`
- Test: `src/lib/offline/replayDeferredEffects.test.ts`

**Interfaces:**
- Consumes: `QueuedPayment`, `DeferredEffect`, `pendingEffects`, `markEffect`, `isItemComplete` from `@/lib/offline/payment-queue`.
- Produces:
  - `export interface ReplayDeps { getToken: () => Promise<string>; fetchImpl?: typeof fetch; }`
  - `export async function replayDeferredEffects(item: QueuedPayment, deps: ReplayDeps): Promise<{ item: QueuedPayment; complete: boolean }>`

The engine runs each **pending** effect once (via the endpoints/payloads in Global Constraints), marks it `done` on HTTP success, leaves it `pending` on failure (for a later retry), and returns the updated item + whether it is now complete. It does not throw on a single effect's failure — it accumulates and returns; the caller decides removal vs. retry.

- [ ] **Step 1: Write the failing tests** (`src/lib/offline/replayDeferredEffects.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { replayDeferredEffects } from "@/lib/offline/replayDeferredEffects";
import type { QueuedPayment } from "@/lib/offline/payment-queue";

function item(effects: Partial<QueuedPayment["effects"]> = {}): QueuedPayment {
  return {
    id: "q1", storeId: "s1", sessionId: "sess1", receiptId: "sess1", queuedAtMs: 0, status: "pending",
    ctx: { pin: "1234", phone: "0917", amount: 100 },
    effects: { analytics: "pending", loyaltyFinalize: "pending", loyaltyEarn: "pending", pinFinalize: "pending", ...effects },
  };
}
const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
const fail = () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);

describe("replayDeferredEffects", () => {
  it("marks all effects done and reports complete when every call succeeds", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    const { item: out, complete } = await replayDeferredEffects(item(), { getToken: async () => "tok", fetchImpl });
    expect(complete).toBe(true);
    expect(out.effects).toEqual({ analytics: "done", loyaltyFinalize: "done", loyaltyEarn: "done", pinFinalize: "done" });
    // one call per pending effect
    expect((fetchImpl as any).mock.calls.length).toBe(4);
  });

  it("leaves a failed effect pending and reports not complete", async () => {
    // analytics ok, loyaltyFinalize fails, others ok
    const fetchImpl = vi.fn((url: string) =>
      String(url).includes("/loyalty/finalize") ? fail() : ok(),
    ) as unknown as typeof fetch;
    const { item: out, complete } = await replayDeferredEffects(item(), { getToken: async () => "tok", fetchImpl });
    expect(complete).toBe(false);
    expect(out.effects.loyaltyFinalize).toBe("pending");
    expect(out.effects.analytics).toBe("done");
  });

  it("does not call endpoints for effects already done/skip", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    const out = await replayDeferredEffects(
      item({ analytics: "done", loyaltyEarn: "skip", loyaltyFinalize: "done", pinFinalize: "pending" }),
      { getToken: async () => "tok", fetchImpl },
    );
    expect((fetchImpl as any).mock.calls.length).toBe(1); // only pinFinalize
    expect(out.complete).toBe(true);
  });

  it("includes the bearer token and correct body for loyalty earn", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    await replayDeferredEffects(item({ analytics: "skip", loyaltyFinalize: "skip", pinFinalize: "skip" }), { getToken: async () => "tok", fetchImpl });
    const call = (fetchImpl as any).mock.calls.find((c: any[]) => String(c[0]).includes("/loyalty/earn"));
    expect(call).toBeTruthy();
    expect(call[1].headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({ storeId: "s1", sessionId: "sess1", phone: "0917", amount: 100, receiptId: "sess1" });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/offline/replayDeferredEffects.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/offline/replayDeferredEffects.ts`.**

```ts
"use client";

import {
  type QueuedPayment,
  type DeferredEffect,
  pendingEffects,
  markEffect,
  isItemComplete,
} from "@/lib/offline/payment-queue";

export interface ReplayDeps {
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

async function post(fetchImpl: typeof fetch, url: string, token: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Replays the pending deferred server-effects for one offline sale. Runs each
 * pending effect once; marks it "done" on HTTP success, leaves it "pending" on
 * failure for a later retry. Never re-records the sale. Returns the updated
 * item and whether all effects are now resolved.
 */
export async function replayDeferredEffects(
  item: QueuedPayment,
  deps: ReplayDeps,
): Promise<{ item: QueuedPayment; complete: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = await deps.getToken();
  const { storeId, sessionId, receiptId, ctx } = item;
  let out = item;

  for (const effect of pendingEffects(item)) {
    let okResult = false;
    if (effect === "analytics") {
      // Match the online apply-delta call (server reads the synced receipt; idempotent on analyticsApplied).
      okResult = await post(fetchImpl, "/api/analytics/apply-delta", token, { storeId, sessionId, receiptId, kind: "payment" });
    } else if (effect === "loyaltyFinalize") {
      okResult = await post(fetchImpl, "/api/loyalty/finalize", token, { storeId, sessionId, receiptId });
    } else if (effect === "loyaltyEarn") {
      okResult = await post(fetchImpl, "/api/loyalty/earn", token, { storeId, sessionId, phone: ctx.phone, amount: ctx.amount, receiptId });
    } else if (effect === "pinFinalize") {
      okResult = await post(fetchImpl, "/api/pins/finalize", token, { storeId, sessionId, pin: ctx.pin, reason: "payment_closed" });
      if (!okResult) {
        okResult = await post(fetchImpl, "/api/pins/disable", token, { storeId, sessionId });
      }
    }
    out = markEffect(out, effect as DeferredEffect, okResult ? "done" : "pending");
  }

  return { item: out, complete: isItemComplete(out) };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/offline/replayDeferredEffects.test.ts` → PASS (4 tests).

- [ ] **Step 5: Confirm the analytics payload matches production.** Read `src/components/cashier/firestore.ts` around the `fetch("/api/analytics/apply-delta"` call (~line 764) and the online receipt-analytics application. If the real body differs from `{ storeId, sessionId, receiptId, kind: "payment" }`, update the `analytics` branch to match it exactly and adjust the test. Record what the real payload is in your report.

- [ ] **Step 6: Commit** (trailer lines)
```bash
git add src/lib/offline/replayDeferredEffects.ts src/lib/offline/replayDeferredEffects.test.ts
git commit -m "feat(offline): idempotent deferred-effects replay engine"
```

---

### Task 3: Enrich the outbox marker at payment time

**Files:**
- Modify: `src/components/cashier/offlinePayment.ts` (the `addToQueue(...)` call near the end of `completePaymentOffline`).

**Interfaces:**
- Consumes: the new `addToQueue` shape (Task 1); `activeProjectionSnap` already read in `completePaymentOffline`.

- [ ] **Step 1: Capture pin/phone and enqueue the rich marker.**
`completePaymentOffline` already reads `activeProjectionSnap` (the `activeSessions/{sessionId}` doc) before deleting it. The online modal reads `customerPin` and `linkedCustomerPhone` from that same projection. Extract them and enqueue a rich marker. Replace the existing minimal `addToQueue({ storeId, sessionId, payload: { payments, totalAmount: amountDue } })` call with:

```ts
  const projData: any = activeProjectionSnap.exists() ? activeProjectionSnap.data() : {};
  const pin = projData.customerPin ? String(projData.customerPin) : null;
  const phone = projData.linkedCustomerPhone ? String(projData.linkedCustomerPhone) : null;
  addToQueue({
    storeId,
    sessionId,
    receiptId: sessionId,
    ctx: { pin, phone, amount: amountDue },
    effects: {
      analytics: "pending",
      loyaltyFinalize: "pending",
      loyaltyEarn: phone ? "pending" : "skip",
      pinFinalize: pin ? "pending" : "skip",
    },
  });
```
Read `activeProjectionSnap` for `customerPin`/`linkedCustomerPhone` BEFORE the batch delete takes effect on sync — since `activeProjectionSnap` was captured earlier in the function, its `.data()` is safe to read here regardless of the batched delete. Do not change any other logic.

- [ ] **Step 2: Typecheck** — `npm run typecheck`. The `offlinePayment.ts` `addToQueue` call should now match the new shape. (The `PaymentQueueSyncProvider` drain is still on the old shape — fixed in Task 4; note if it still errors.)

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/cashier/offlinePayment.ts
git commit -m "feat(offline): enqueue rich deferred-effects marker on offline payment"
```

---

### Task 4: Replace the drain with the replay engine (+ guardrail 5a)

**Files:**
- Modify: `src/hooks/use-payment-queue-sync.ts` (drain now persists per-effect progress; removes item only when complete).
- Modify: `src/components/shared/PaymentQueueSyncProvider.tsx` (call the replay engine + auth token + 5a conflict check; stop calling `completePaymentFromUnits`).

**Interfaces:**
- Consumes: `replayDeferredEffects` (Task 2); `getQueue/updateQueueItem/removeFromQueue`, `QueuedPayment`, `isItemComplete` (Task 1); Firestore `getDoc`; auth (`firebaseUser.getIdToken()`).

- [ ] **Step 1: Rework the sync hook to drain via a per-item processor that persists progress.**
Change `usePaymentQueueSync` so its `onSync` callback receives the full `QueuedPayment` item and returns the updated item + completion, and the hook persists the returned effect-state and only `removeFromQueue` when complete (else leaves it `pending`/`failed` for the next reconnect). Replace the body of `processQueue`'s per-item loop:

```ts
      for (const item of queue) {
        updateQueueItem(item.id, { status: "syncing" });
        try {
          const { item: updated, complete } = await onSyncRef.current(item);
          if (complete) {
            removeFromQueue(item.id);
            toast({ title: "Offline sale synced", description: `Session ${item.sessionId.slice(0, 6)}… finalized.` });
          } else {
            updateQueueItem(item.id, { status: "pending", effects: updated.effects, errorMessage: "Some effects pending; will retry." });
          }
        } catch (err: any) {
          updateQueueItem(item.id, { status: "failed", errorMessage: err?.message ?? String(err) });
          toast({ variant: "destructive", title: "Sync failed", description: `Session ${item.sessionId.slice(0, 6)}…: ${err?.message ?? err}` });
        }
      }
```
Update the hook's `onSync` type to `(item: QueuedPayment) => Promise<{ item: QueuedPayment; complete: boolean }>` and import `QueuedPayment`. Keep the online-trigger and SW-message effects. (Ensure `updateQueueItem` accepts an `effects` patch — it already does `{ ...queue[idx], ...patch }`.)

- [ ] **Step 2: Rewrite `PaymentQueueSyncProvider` to replay effects (not re-run payment) with the 5a guard.**
Replace its `usePaymentQueueSync(async (...) => { ... completePaymentFromUnits ... })` body with:

```ts
  const { firebaseUser } = useAuthContext();

  usePaymentQueueSync(async (item) => {
    if (!firebaseUser) throw new Error("Not authenticated");

    // Guardrail 5a: if the server already holds a NON-offline final receipt for
    // this session, an online sale beat us — do not apply offline effects on top.
    const receiptSnap = await getDoc(doc(db, "stores", item.storeId, "receipts", item.sessionId));
    if (receiptSnap.exists()) {
      const r: any = receiptSnap.data();
      if (r.status === "final" && r.offlineOrigin !== true) {
        throw new Error(`Server already has an online receipt for session ${item.sessionId}; offline effects skipped (conflict).`);
      }
    }

    return await replayDeferredEffects(item, { getToken: () => firebaseUser.getIdToken() });
  });
```
Remove the now-unused imports/helpers (`completePaymentFromUnits`, `loadQueuedStoreContext`, `useStoreContext`/`useStoreConfigDoc`/`useMemo` if no longer used) — but VERIFY each is unused before deleting; leave anything still referenced. Import `replayDeferredEffects`, `getDoc`, `doc`, `db`, and use `firebaseUser` from `useAuthContext`.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS. Confirm via `git grep` that `completePaymentFromUnits` is no longer referenced by `PaymentQueueSyncProvider.tsx`.

- [ ] **Step 4: On-device acceptance protocol (MANDATORY — this is the test)**
On the APK or `npm run dev` + DevTools Offline:
1. Offline: complete a sale for a session that has a **linked loyalty phone AND a customer PIN** (so all four effects are `pending`). Confirm the receipt prints (Plan 3 behavior). PASS/FAIL.
2. Inspect `localStorage` `offline_payment_queue`: one item with `effects` all `pending` (loyaltyEarn/pinFinalize `pending`, not `skip`) and `ctx` carrying the pin/phone/amount. PASS/FAIL.
3. **Reconnect.** Expected: the offline batch syncs the OL receipt; then within a few seconds the queue item drains — analytics applied (`analyticsApplied:true` on the receipt in Firebase), loyalty finalized + earned (points credited), PIN finalized; the queue item is REMOVED; **no second `SELIP-` receipt** is created for the session. PASS/FAIL.
4. Simulate a partial failure (e.g. temporarily block one endpoint / go offline mid-drain): the item stays with only the failed effect `pending`; on the next reconnect only that effect retries (no double loyalty points). PASS/FAIL.
5. Guardrail 5a: (if feasible) close a session online, then attempt an offline sale on a stale device for the same session and reconnect → the sync flags the conflict (item `failed` with the conflict message) and does NOT apply offline effects over the online receipt. PASS/FAIL (or note as not-tested if hard to stage).

If any step FAILS, report BLOCKED with specifics; do not mark Task 4 complete.

- [ ] **Step 5: Commit** (trailer lines)
```bash
git add src/hooks/use-payment-queue-sync.ts src/components/shared/PaymentQueueSyncProvider.tsx
git commit -m "feat(offline): replay deferred effects on sync (no payment re-run) + stale-receipt guard"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- Replace the payment-re-run drain (prevents `OL`+`SELIP` duplicate receipts) → Task 4. ✅
- Replay analytics + loyalty finalize/earn + PIN finalize idempotently (user decision "all") → Tasks 2 + 4. ✅
- Per-effect idempotency tracking (don't repeat completed effects) → Task 1 model + Task 2 engine + Task 4 persistence. ✅
- Capture deferred-effect context (pin/phone/receiptId/amount) at payment time (projection is deleted on sync) → Task 3. ✅
- Guardrail 5a (don't overwrite/stack on an authoritative online receipt) → Task 4 Step 2 conflict check. ✅
- Deferred to Plan 4B (not here): connectivity reachability service, offline banner, unsynced-count indicator, sync-report UI.
- Noted-not-built: IndexedDB migration; a Firestore rule to hard-block overwriting a final non-offline receipt; server-side dedup verification for loyalty/earn & pins/finalize.

**Placeholder scan:** Tasks 1–2 carry full code + tests; Tasks 3–4 give exact edits against real files + a concrete on-device protocol; Task 2 Step 5 requires confirming one real payload from source. No hand-waving. ✅

**Type/behavior consistency:** `QueuedPayment`/effect helpers defined in Task 1 are consumed unchanged by Tasks 2–4. `replayDeferredEffects` return shape `{ item, complete }` matches the hook's new `onSync` contract (Task 4 Step 1) and the provider (Task 4 Step 2). Marker written in Task 3 (`ctx`, `effects`, `receiptId`) matches what the engine reads in Task 2. ✅

**Risk notes:** (1) Non-idempotent servers (loyalty earn / PIN finalize) + a crash between server-success and client-mark could repeat an effect — mitigated by loyalty/earn's `receiptId`; documented, server dedup recommended. (2) 5a full prevention needs a Firestore rule (recommended, not built) — the client check reduces but can't fully eliminate a stale-cache overwrite because the offline batch may flush before the drain runs; flagged for Plan 4B / rules work. (3) The queue is localStorage (single-tab-safe for the APK), consistent with the offline counter decision.
