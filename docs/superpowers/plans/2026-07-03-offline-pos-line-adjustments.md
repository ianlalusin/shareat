# Offline POS — Line Adjustments (Plan A of void/adjustments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier apply/remove line-level adjustments (discount, void-qty, free, mark) and bill-line patches on an open session with **no internet**, instead of the UI hanging.

**Architecture:** Three code paths build a `writeBatch` then `await batch.commit()` (which never resolves offline → the handler hangs), followed by awaited best-effort side-effects (`recomputeSessionAdjustmentFlags`, `writeActivityLog`) that also hang offline. Fix per the established Plan-5 pattern: **branch the commit on connectivity** — online `await batch.commit()` (unchanged, preserves error surfacing), offline `commitLocalFirst(batch, …)` (applies locally + syncs, no ack wait) — and **fire the best-effort side-effects local-first** when offline. No new data model; the local writes sync on reconnect via Firestore's cache. `voidSession` offline is a SEPARATE later plan (Plan B).

**Tech Stack:** TypeScript, Firebase JS SDK v10 (Firestore offline persistence on), Next.js/Capacitor client.

## Global Constraints

- Node `>=20 <21`. No new runtime dependencies. Browser modules keep `"use client";`.
- Reuse (merged): `commitLocalFirst` from `@/lib/offline/commit` (already imported in `firestore.ts` and `session-detail-view.tsx`); `useOnlineStatus` (`isOnline`) already read in `session-detail-view.tsx` (Plan 5).
- **Preserve ONLINE behavior exactly.** When online: `await batch.commit()` and `await`ed side-effects run as today (so a permission/rules error still surfaces to the caller/UI). Only the OFFLINE path changes: `commitLocalFirst` + fire-and-forget side-effects.
- Connectivity source: the data-layer functions (`firestore.ts`) have no React context → gate on `navigator.onLine`. The React handler (`session-detail-view.tsx`) uses the existing `isOnline` from `useOnlineStatus`.
- Offline writes must never await a server ack: `commitLocalFirst(batch, onError)` for the commit; `void X(...).catch(...)` for `recomputeSessionAdjustmentFlags`/`writeActivityLog`.
- Typecheck: `npm run typecheck`. **Testing:** these paths are Firestore-coupled (batch commit / updateDoc) with no pure logic to extract, and offline Firestore behavior isn't unit-testable (no emulator for the IndexedDB cache). Each task is verified by `npm run typecheck` + the **on-device offline protocol** (Task 3).

---

### Task 1: `updateSessionBillLine` + `removeLineAdjustment` offline-safe

**Files:**
- Modify: `src/components/cashier/firestore.ts` — `updateSessionBillLine` (~line 1295) and `removeLineAdjustment` (~line 1327).

- [ ] **Step 1: Make `updateSessionBillLine` offline-safe.**
Its tail currently is:
```ts
  const batch = writeBatch(db);
  batch.update(lineRef, updatePayload);
  batch.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });
  await batch.commit();

  if (patchAffectsAdjustmentFlags(patch as Record<string, any>)) {
    await recomputeSessionAdjustmentFlags(storeId, sessionId);
  }
```
Replace the `await batch.commit();` + the trailing `if (…) await recomputeSessionAdjustmentFlags(…)` with:
```ts
  const affectsFlags = patchAffectsAdjustmentFlags(patch as Record<string, any>);
  if (navigator.onLine) {
    await batch.commit();
    if (affectsFlags) await recomputeSessionAdjustmentFlags(storeId, sessionId);
  } else {
    // Offline: apply locally & sync later; never await the server ack (it never
    // resolves offline) and fire the flag refresh local-first so we don't hang.
    commitLocalFirst(batch, (err) => console.error("[updateSessionBillLine] offline sync failed", err));
    if (affectsFlags) void recomputeSessionAdjustmentFlags(storeId, sessionId).catch(() => {});
  }
```
Leave the batch construction, `updatePayload`, and everything above unchanged.

- [ ] **Step 2: Make `removeLineAdjustment` offline-safe.**
Its tail currently is:
```ts
  const batch = writeBatch(db);
  batch.update(lineRef, updatePayload);
  batch.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });
  await batch.commit();

  await recomputeSessionAdjustmentFlags(storeId, sessionId);
```
Replace the `await batch.commit();` + the trailing `await recomputeSessionAdjustmentFlags(…)` with:
```ts
  if (navigator.onLine) {
    await batch.commit();
    await recomputeSessionAdjustmentFlags(storeId, sessionId);
  } else {
    commitLocalFirst(batch, (err) => console.error("[removeLineAdjustment] offline sync failed", err));
    void recomputeSessionAdjustmentFlags(storeId, sessionId).catch(() => {});
  }
```
Leave everything above unchanged.

- [ ] **Step 3: Typecheck.** `npm run typecheck` → PASS. (`commitLocalFirst` is already imported in `firestore.ts` from Plan 2 — confirm; if not, add `import { commitLocalFirst } from '@/lib/offline/commit';`.)

- [ ] **Step 4: Commit** (standard trailer lines)
```bash
git add src/components/cashier/firestore.ts
git commit -m "feat(offline): updateSessionBillLine + removeLineAdjustment don't hang offline"
```

> On-device verification is Task 3 (all adjustment paths tested together).

---

### Task 2: `handleAddLineAdjustment` offline-safe

**Files:**
- Modify: `src/components/cashier/session-detail-view.tsx` — `handleAddLineAdjustment` (~line 488).

**Interfaces:**
- Consumes: `commitLocalFirst` (already imported); `isOnline` from `useOnlineStatus()` (already in scope in this component).

`handleAddLineAdjustment` builds a batch then `await batch.commit()`, and (for `adj.kind === "discount"`) awaits `recomputeSessionAdjustmentFlags` and `writeActivityLog` — all three hang offline.

- [ ] **Step 1: Branch the commit + fire the side-effects local-first.**
At the top of `handleAddLineAdjustment`'s `try`, add a local helper:
```ts
    // Best-effort server side-effects: awaited online, fired local-first offline
    // (their internal batch.commit()/updateDoc never resolves with no internet).
    const sideEffect = (run: () => Promise<unknown>): Promise<void> => {
      if (isOnline) return run().then(() => undefined);
      run().catch((err) => console.warn("[handleAddLineAdjustment] offline side-effect deferred", err));
      return Promise.resolve();
    };
```
Change the `await batch.commit();` to:
```ts
    if (isOnline) {
      await batch.commit();
    } else {
      commitLocalFirst(batch, (err) => console.error("[handleAddLineAdjustment] offline sync failed", err));
    }
```
Change the `await recomputeSessionAdjustmentFlags(storeId, sessionId);` (in the `adj.kind === "discount"` block) to:
```ts
      await sideEffect(() => recomputeSessionAdjustmentFlags(storeId, sessionId));
```
Change the `await writeActivityLog({ … });` (the `DISCOUNT_APPLIED` log in the second `adj.kind === 'discount'` block) to:
```ts
                await sideEffect(() => writeActivityLog({ … }));
```
(keep the `writeActivityLog` payload object exactly as-is — only wrap the call). Leave the `toast(...)`, the discount-amount computation, and all other logic unchanged.

- [ ] **Step 2: Typecheck.** `npm run typecheck` → PASS.

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/cashier/session-detail-view.tsx
git commit -m "feat(offline): add line adjustment offline without hanging"
```

---

### Task 3: On-device acceptance protocol (MANDATORY — the test for Tasks 1–2)

- [ ] **Step 1: Verify offline line adjustments.**
On the APK or `npm run dev` + Chrome DevTools → Network **Offline**, from an open offline session with billed lines. Record PASS/FAIL:
1. **Offline**, apply a **discount** to a line (via the bill-adjustments UI / session-detail) → no hang; the discount appears; the bill total updates; the session's adjustment badge/flag reflects it (recompute fired locally).
2. Offline, **void** part of a line's qty and **mark free** → applied locally, no hang.
3. Offline, **remove** an existing adjustment → removed locally, no hang.
4. Offline, edit a bill line via any path that calls `updateSessionBillLine` → applies, no hang.
5. **Reconnect** → all offline adjustments sync to Firebase; `billingRevision` advanced; adjustment flags consistent; **no duplicates**; no stuck spinner.
6. **Online** (normal): the same edits behave exactly as before (and a rules/permission failure, if any, still surfaces as an error).

If any step FAILS, report BLOCKED with specifics.

---

## Self-Review

**Spec coverage (this plan's slice):**
- `updateSessionBillLine` offline (no hang) → Task 1. ✅
- `removeLineAdjustment` offline (no hang) → Task 1. ✅
- `handleAddLineAdjustment` offline (commit + recompute + activity log) → Task 2. ✅
- Online behavior preserved (await + error surfacing) → Task 1/2 online branches. ✅
- Deferred (separate Plan B): `voidSession` offline + its outbox replay of loyalty-reversal/PIN.

**Placeholder scan:** Tasks 1–2 give exact before/after edits; Task 3 is a concrete on-device protocol. The `writeActivityLog({ … })` payload is explicitly "keep as-is, only wrap the call" (not reproduced — reproducing the large object risks drift). No hand-waving.

**Type/behavior consistency:** `commitLocalFirst(batch, onError)` used identically in all three functions; `navigator.onLine` for the data-layer functions, `isOnline` for the React handler; the `sideEffect` helper mirrors Plan 5's `handleUpdateLine` hang-fix exactly. Online branches are byte-identical to today.

**Risk notes:** (1) These are Firestore-coupled with no unit test — the on-device protocol is the gate. (2) `commitLocalFirst` doesn't surface commit errors to the caller offline (routes to `onError`/console) — acceptable, matches every other offline write in this project; online still surfaces errors. (3) `handleAddLineAdjustment` duplicates the tiny `sideEffect` helper (also defined in `handleUpdateLine`); acceptable for isolation — a future cleanup could lift it to component scope.
