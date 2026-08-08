# Offline POS — Void Session (Plan B of void/adjustments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier **void a session with no internet** — cancel its kitchen tickets, mark it voided, free the table — with the server-only effects (loyalty-redemption reversal + PIN finalize) replayed on reconnect via the Plan 4A outbox.

**Architecture:** Same approach as offline payment (Plan 3 + 4A): a **separate `voidSessionOffline` path** (the online `voidSession` transaction stays untouched) that reads from the local cache, writes via a local-first `writeBatch` (`commitLocalFirst`), and **defers** loyalty-reversal + PIN to sync. The Plan 4A outbox (`payment-queue.ts` / `replayDeferredEffects.ts` / `PaymentQueueSyncProvider.tsx`) is **extended** to carry a `void` kind: a new `loyaltyReverse` effect (DELETE `/api/loyalty/redeem` per redemption id) and `pinFinalize` with `reason:"session_voided"`. On reconnect the same drain replays void effects idempotently, with no receipt involved.

**Tech Stack:** TypeScript, Firebase JS SDK v10 (offline persistence on), Next.js/Capacitor client, Vitest (node).

## Global Constraints

- Node `>=20 <21`. Vitest node env, glob `src/**/*.test.ts`, alias `@`→`./src`. Pure-unit-test pattern (injected deps/fakes). No new runtime dependencies. Browser modules start with `"use client";`.
- Reuse (merged): `commitLocalFirst` (`@/lib/offline/commit`), `getActorStamp` (`@/components/cashier/firestore`), the Plan 4A outbox (`@/lib/offline/payment-queue`, `@/lib/offline/replayDeferredEffects`), `PaymentQueueSyncProvider`, `useOnlineStatus`.
- **Do NOT modify the online `voidSession`** (transaction) or the online void-dialog branch. Plan B adds a `voidSessionOffline` path + an `!isOnline` branch in the dialog + extends the outbox — payment behavior and online void are unchanged.
- Offline void must never await a server ack: `commitLocalFirst` for the batch; the `/api` effects are DEFERRED (enqueued, replayed on reconnect), never called in the offline path.
- Void deferred effects & idempotency: `loyaltyReverse` = `DELETE /api/loyalty/redeem {redemptionId, storeId, reason:"void"}` per id (reversing an already-reversed redemption should no-op server-side); `pinFinalize` = `POST /api/pins/finalize {storeId, sessionId, pin, reason:"session_voided"}`. Client per-effect tracking (Plan 4A) is the primary idempotency guard.
- Back-compat: existing payment queue items have no `kind` → treated as `"payment"`; their effect set/behavior is unchanged.
- Typecheck: `npm run typecheck`. **Testing:** the outbox model + replay engine extensions are TDD'd in Node; `voidSessionOffline` + the dialog wiring + the provider branch are verified by `npm run typecheck` + the **on-device protocol** (Task 6).

---

### Task 1: Extend the outbox model for `void`

**Files:**
- Modify: `src/lib/offline/payment-queue.ts`
- Test: `src/lib/offline/payment-queue.test.ts` (add cases)

**Interfaces:**
- Produces (additions): `DeferredEffect` gains `"loyaltyReverse"`; `QueuedReceiptContext` gains `redemptionIds?: string[]`; `QueuedPayment` gains `kind?: "payment" | "void"`.

- [ ] **Step 1: Write failing tests** (append to `payment-queue.test.ts`)

```ts
import { pendingEffects, isItemComplete, markEffect, type QueuedPayment } from "@/lib/offline/payment-queue";

function voidItem(effects: Partial<QueuedPayment["effects"]> = {}): QueuedPayment {
  return {
    id: "v1", storeId: "s1", sessionId: "sess1", receiptId: "sess1", queuedAtMs: 0, status: "pending", kind: "void",
    ctx: { amount: 0, pin: "1234", redemptionIds: ["r1", "r2"] },
    effects: { analytics: "skip", loyaltyFinalize: "skip", loyaltyEarn: "skip", pinFinalize: "pending", loyaltyReverse: "pending", ...effects },
  };
}

describe("outbox void support", () => {
  it("lists only the void effects as pending", () => {
    expect(pendingEffects(voidItem()).sort()).toEqual(["loyaltyReverse", "pinFinalize"]);
  });
  it("markEffect works for loyaltyReverse", () => {
    const after = markEffect(voidItem(), "loyaltyReverse", "done");
    expect(after.effects.loyaltyReverse).toBe("done");
  });
  it("isItemComplete true when void effects done/skip", () => {
    expect(isItemComplete(voidItem({ loyaltyReverse: "done", pinFinalize: "done" }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/offline/payment-queue.test.ts` → FAIL (type: `loyaltyReverse`/`kind`/`redemptionIds` don't exist).

- [ ] **Step 3: Implement.** In `payment-queue.ts`:
- Add `"loyaltyReverse"` to the `DeferredEffect` union AND to the `ALL_EFFECTS` array.
- Add `redemptionIds?: string[]` to `QueuedReceiptContext`.
- Add `kind?: "payment" | "void"` to `QueuedPayment`.
Nothing else changes — `pendingEffects`/`markEffect`/`isItemComplete`/`getQueue`/`addToQueue`/etc. work unchanged (they iterate `ALL_EFFECTS` and the effect map).

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/offline/payment-queue.test.ts` → PASS (existing + 3 new).

- [ ] **Step 5: Commit** (standard trailer lines)
```bash
git add src/lib/offline/payment-queue.ts src/lib/offline/payment-queue.test.ts
git commit -m "feat(offline): outbox supports void kind (loyaltyReverse effect + redemptionIds)"
```

---

### Task 2: Replay engine handles void effects

**Files:**
- Modify: `src/lib/offline/replayDeferredEffects.ts`
- Test: `src/lib/offline/replayDeferredEffects.test.ts` (add cases)

- [ ] **Step 1: Write failing tests** (append)

```ts
describe("replay void effects", () => {
  function voidItem() {
    return {
      id: "v1", storeId: "s1", sessionId: "sess1", receiptId: "sess1", queuedAtMs: 0, status: "pending" as const, kind: "void" as const,
      ctx: { amount: 0, pin: "1234", redemptionIds: ["r1", "r2"] },
      effects: { analytics: "skip" as const, loyaltyFinalize: "skip" as const, loyaltyEarn: "skip" as const, pinFinalize: "pending" as const, loyaltyReverse: "pending" as const },
    };
  }
  const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);

  it("reverses each redemption (DELETE /api/loyalty/redeem) and finalizes the pin with session_voided", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    const { item, complete } = await replayDeferredEffects(voidItem(), { getToken: async () => "tok", fetchImpl });
    expect(complete).toBe(true);
    const calls = (fetchImpl as any).mock.calls;
    const redeemCalls = calls.filter((c: any[]) => String(c[0]).includes("/loyalty/redeem"));
    expect(redeemCalls.length).toBe(2); // one DELETE per redemptionId
    expect(redeemCalls[0][1].method).toBe("DELETE");
    const pinCall = calls.find((c: any[]) => String(c[0]).includes("/pins/finalize"));
    expect(JSON.parse(pinCall[1].body)).toMatchObject({ storeId: "s1", sessionId: "sess1", pin: "1234", reason: "session_voided" });
    expect(item.effects.loyaltyReverse).toBe("done");
    expect(item.effects.pinFinalize).toBe("done");
  });

  it("leaves loyaltyReverse pending if any redemption DELETE fails", async () => {
    const fetchImpl = vi.fn((url: string) => String(url).includes("/loyalty/redeem")
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response) : ok()) as unknown as typeof fetch;
    const { item, complete } = await replayDeferredEffects(voidItem(), { getToken: async () => "tok", fetchImpl });
    expect(complete).toBe(false);
    expect(item.effects.loyaltyReverse).toBe("pending");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/offline/replayDeferredEffects.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `replayDeferredEffects.ts`, inside the `for (const effect of pendingEffects(item))` loop, add handling:
- `loyaltyReverse`: DELETE `/api/loyalty/redeem` once per id in `ctx.redemptionIds` (`{ redemptionId, storeId, reason: "void" }`), Bearer token; the effect succeeds only if EVERY delete returns ok (if `redemptionIds` is empty/undefined → treat as ok, mark done). Use a `DELETE` method variant of the existing `post` helper (add a `method` param or a `del` helper).
- `pinFinalize`: use `reason: item.kind === "void" ? "session_voided" : "payment_closed"` (payment path unchanged — default/`"payment"` → `"payment_closed"`).
Keep the existing analytics/loyaltyFinalize/loyaltyEarn branches unchanged. `onEffectDone` per-effect persistence (Plan 4A) still applies.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/offline/replayDeferredEffects.test.ts` → PASS (existing + 2 new).

- [ ] **Step 5: Commit** (trailer lines)
```bash
git add src/lib/offline/replayDeferredEffects.ts src/lib/offline/replayDeferredEffects.test.ts
git commit -m "feat(offline): replay void effects (loyalty reversal + session_voided pin finalize)"
```

---

### Task 3: `voidSessionOffline` — record the void locally

**Files:**
- Create: `src/components/cashier/offlineVoid.ts`
- Modify: `src/components/cashier/firestore.ts` — export `getCurrentSessionBillingState`? (not needed for void). Export nothing new unless required; `getActorStamp` is already exported.

**Interfaces:**
- Produces: `export async function voidSessionOffline(args: { storeId: string; sessionId: string; reason: string; actor: AppUser }): Promise<{ reversedRedemptionIds: string[]; pin: string | null }>`

- [ ] **Step 1: Read the online `voidSession`** (`firestore.ts` ~line 872) — its transaction is a read-modify-write: reads (getDocs active tickets, `tx.get(session)`, `tx.get(activeProjection)`), idempotency skip (`closed`/`voided`/`isPaid`), collects `redemptionIdsToReverse` from `sessionData.loyaltyRedemptions`, then writes: cancel each active ticket (update + rtKds `deleteField`/`arrayRemove` + `closedKdsTickets` set), void the session (`status:'voided'` …), move projection active→closed, free table + table projection.

- [ ] **Step 2: Create `src/components/cashier/offlineVoid.ts`** mirroring those writes as a local-first batch. Read the session + active projection from the CACHE via `getDoc`, and the active tickets via `getDocs` (cache). Idempotency: if the session is already `closed`/`voided`/`isPaid`, return early (`{ reversedRedemptionIds: [], pin: <from projection> }`). Collect `reversedRedemptionIds` from `sessionData.loyaltyRedemptions`. Read `customerPin` from the active projection (BEFORE the batch deletes it). Build a `writeBatch` reproducing the online void writes EXACTLY (cancel tickets + rtKds updates + closedKdsTickets, void session with `status:'voided'` + `voidedAt`/`voidedByUid`/`voidReason` + **`revision: (sessionData.revision ?? 1) + 1`**, move projection, free table + projection), `commitLocalFirst(batch, onError)`, and return `{ reversedRedemptionIds, pin }`. Import the same Firestore fns used by `voidSession` (`doc/collection/getDoc/getDocs/query/where/writeBatch/serverTimestamp/deleteField/arrayRemove`), `db`, `getActorStamp`, `commitLocalFirst`. Reproduce the ticket/session/projection/table payloads verbatim from `voidSession` — do not invent fields.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit** (trailer lines)
```bash
git add src/components/cashier/offlineVoid.ts src/components/cashier/firestore.ts
git commit -m "feat(offline): voidSessionOffline records the void locally"
```

> On-device verification is Task 6 (with the dialog wiring).

---

### Task 4: Wire the void dialog's offline branch + enqueue the void marker

**Files:**
- Modify: `src/components/cashier/void-session-dialog.tsx`

**Interfaces:**
- Consumes: `voidSessionOffline` (Task 3); `addToQueue` (`@/lib/offline/payment-queue`); `useOnlineStatus`.

- [ ] **Step 1: Add the offline branch.**
The dialog currently does (online): read `currentPin` from the active projection, `await voidSession(...)`, then `/api/loyalty/redeem` DELETE per reversed id, then `/api/pins/finalize`. Add `const isOnline = useOnlineStatus();` and branch the submit handler:
```ts
if (isOnline) {
  // ...existing online body unchanged...
} else {
  const { reversedRedemptionIds, pin } = await voidSessionOffline({ storeId, sessionId: session.id, reason: safeReason, actor: user });
  addToQueue({
    storeId,
    sessionId: session.id,
    receiptId: session.id,
    kind: "void",
    ctx: { amount: 0, pin, redemptionIds: reversedRedemptionIds },
    effects: {
      analytics: "skip", loyaltyFinalize: "skip", loyaltyEarn: "skip",
      loyaltyReverse: reversedRedemptionIds.length > 0 ? "pending" : "skip",
      pinFinalize: pin ? "pending" : "skip",
    },
  });
  toast({ title: "Session Voided", description: "The session has been cancelled and the table is now free. Loyalty/PIN will sync when back online." });
  onClose();
}
```
Do NOT change the online branch or call any `/api` in the offline branch (those are deferred). Keep the existing try/catch (a thrown validation error surfaces via the existing toast).

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/cashier/void-session-dialog.tsx
git commit -m "feat(offline): void a session offline; defer loyalty-reversal + pin to sync"
```

---

### Task 5: Provider drains void items (skip the receipt guard)

**Files:**
- Modify: `src/components/shared/PaymentQueueSyncProvider.tsx`

- [ ] **Step 1: Branch the 5a guard on kind.**
The provider's drain currently does a payment-specific guardrail-5a check (skip if the server already has a non-offline final receipt) then `replayDeferredEffects`. Void items have no receipt, so skip that check for them:
```ts
usePaymentQueueSync(async (item) => {
  if (!firebaseUser) return { item, complete: false };
  if (item.kind !== "void") {
    // existing 5a receipt-conflict check (payment items only)
    let receiptSnap; try { receiptSnap = await getDoc(doc(db, "stores", item.storeId, "receipts", item.sessionId)); } catch { return { item, complete: false }; }
    if (receiptSnap.exists()) { const r: any = receiptSnap.data(); if (r.status === "final" && r.offlineOrigin !== true) throw new Error(`Server already has an online receipt for session ${item.sessionId}; offline effects skipped (conflict).`); }
  }
  return await replayDeferredEffects(item, { getToken: () => firebaseUser.getIdToken(), onEffectDone: (updated) => updateQueueItem(updated.id, { effects: updated.effects }) });
}, !!firebaseUser);
```
(Adapt to the actual current code — the only change is wrapping the existing receipt check in `if (item.kind !== "void") { … }`.)

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/shared/PaymentQueueSyncProvider.tsx
git commit -m "feat(offline): drain void outbox items (skip receipt guard for voids)"
```

---

### Task 6: On-device acceptance protocol (MANDATORY)

- [ ] **Step 1: Verify offline void end-to-end.**
On the APK or `npm run dev` + DevTools **Offline**, from an open offline session (ideally one with a **loyalty redemption** and a **customer PIN**). Record PASS/FAIL:
1. **Offline**, void the session → no hang; the session shows `voided`; its active kitchen tickets are cancelled; the table is freed; you're returned to the list.
2. Inspect `localStorage` `offline_payment_queue`: one item `kind:"void"`, `loyaltyReverse`/`pinFinalize` `pending` (or `skip` if no redemptions/pin), `ctx.redemptionIds`/`ctx.pin` populated.
3. **Reconnect** → the void syncs to Firebase (session voided, tickets cancelled, table free); then the outbox drains — the loyalty redemptions are **reversed** (points returned) and the PIN is finalized; the queue item is removed; **no duplicate** void.
4. Void a session with **no loyalty/PIN** offline → voids locally; queue item has those effects `skip`; nothing to replay on reconnect.
5. Partial failure (block one endpoint on reconnect) → only the failed effect stays `pending`; retries on next reconnect (no double reversal).
6. **Online** void → behaves exactly as before (live loyalty-reversal + PIN, no queue item).

If any step FAILS, report BLOCKED with specifics.

---

## Self-Review

**Spec coverage:**
- Offline void records locally (cancel tickets, void, free table) → Task 3. ✅
- Defer loyalty-reversal + PIN to sync (user decision) → Tasks 1,2,4,5. ✅
- Outbox extended for void (loyaltyReverse effect + kind + redemptionIds) → Task 1. ✅
- Replay void effects idempotently (per-redemption DELETE + session_voided pin) → Task 2. ✅
- Online `voidSession` + online dialog branch + payment path untouched → Tasks 3–5 add-only. ✅
- On-device verification → Task 6. ✅

**Placeholder scan:** Tasks 1–2 carry full test + implementation deltas. Tasks 3–5 give exact wiring + instruct mirroring the online `voidSession` writes verbatim (rather than reproducing ~100 lines that could drift) + a concrete on-device protocol. No hand-waving.

**Type/behavior consistency:** `kind`/`loyaltyReverse`/`redemptionIds` defined in Task 1 are consumed by Task 2 (replay), Task 4 (enqueue), Task 5 (drain branch). `voidSessionOffline` return `{reversedRedemptionIds, pin}` (Task 3) feeds the Task 4 marker. Payment items (no `kind`) keep their exact effect set + drain path.

**Risk notes:** (1) `voidSessionOffline` reproduces the online void writes — mirror them verbatim; the on-device protocol + a careful review guard fidelity. (2) Idempotency of loyalty-reverse/PIN on the server isn't independently confirmed — client per-effect tracking is the primary guard (Plan 4A); a crash between server-success and client-mark could repeat (rare). (3) Stale-cache: if the session was voided/closed online but not yet in this device's cache, offline void could double-write — mirrors the payment 5a edge; the void has no receipt so the conflict is lower-impact, but note it for the sync report.
