# Offline POS — Plan 5: Offline In-Session Ordering (Kitchen Tickets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier add items/addons, refills, and qty edits **to an open session with no internet**, so the kitchen tickets are **created offline** (they sync to the cloud/KDS on reconnect). This is the prerequisite for the kitchen network-printer backup (next plan). `voidSession` offline is explicitly out of scope (separate later plan).

**Architecture:** Same approved offline-first pattern as `completePaymentOffline`/`startSession`: the proven online `runTransaction` paths stay **untouched**; each ticket-creating flow gets an **offline branch** (taken when `!isOnline`) that mirrors the online writes as a local-first `writeBatch` committed via `commitLocalFirst`. The shared helper `createKitchenTickets` (writes-only) is taught to accept a `WriteBatch` as well as a `Transaction`, so both online and offline paths reuse the exact same ticket/KDS write shapes (no drift). Three of the four flows are writes-only (clean batch); `AddonsPOSModal` is read-modify-write and reads its line from cache first.

**Tech Stack:** TypeScript, Firebase JS SDK v10 (Firestore offline persistence on), Next.js/Capacitor client, Vitest (node).

## Global Constraints

- Node `>=20 <21`. Vitest node env, glob `src/**/*.test.ts`, alias `@` → `./src`. Pure-unit-test pattern. No new runtime dependencies. Browser modules start with `"use client";`.
- Reuse (merged): `commitLocalFirst` from `@/lib/offline/commit`; `useOnlineStatus` from `@/hooks/use-online-status`; `getActorStamp` from `@/components/cashier/firestore`.
- **Do NOT modify the ONLINE transaction branches.** Each modal keeps its existing `runTransaction(...)` path for when online; Plan 5 only (a) adds a `WriteBatch` option to `createKitchenTickets`, and (b) adds an `if (!isOnline) { …batch… } else { …existing transaction… }` branch. Preserve every write payload/field verbatim.
- Offline writes must never await a server ack: commit via `commitLocalFirst`; do not `await batch.commit()`.
- Kitchen tickets already carry `kitchenLocationId`/`kitchenLocationName` — leave those intact (the next plan's printer backup uses per-location config to decide what prints; nothing about that belongs here).
- Session `billingRevision`/`revision`: where the online path increments `billingRevision` (session-detail), the offline branch must do the same (`increment(1)`), so the concurrency guard stays consistent.
- Typecheck: `npm run typecheck`. **Testing:** `createKitchenTickets`'s writer-selection is TDD'd in Node with fake writers; the modal offline branches are Firestore/UI-coupled → verified by `npm run typecheck` + the **on-device protocol** in Task 5 (no emulator exercises the IndexedDB offline cache).

---

### Task 1: Teach `createKitchenTickets` to accept a `WriteBatch`

**Files:**
- Modify: `src/components/cashier/firestore.ts` — `createKitchenTickets` (~line 1323): change `opts: { tx: Transaction }` to `opts: { tx: Transaction } | { batch: WriteBatch }` and route the three writes through whichever writer is supplied. No behavior change for existing `{ tx }` callers.
- Create: `src/lib/offline/kitchenTicketWrites.ts` — a pure, testable description of the writes `createKitchenTickets` performs, so the writer-selection is unit-testable without Firestore.
- Test: `src/lib/offline/kitchenTicketWrites.test.ts`

**Interfaces:**
- Produces:
  - `export interface TicketWriter { set(ref: any, data: any, options?: any): unknown; update(ref: any, data: any): unknown; }`
  - `export function selectTicketWriter(opts: { tx: TicketWriter } | { batch: TicketWriter }): TicketWriter`
- `createKitchenTickets` gains the union `opts` type and uses `selectTicketWriter(opts)` internally.

- [ ] **Step 1: Write the failing test** (`src/lib/offline/kitchenTicketWrites.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { selectTicketWriter } from "@/lib/offline/kitchenTicketWrites";

describe("selectTicketWriter", () => {
  it("returns the transaction when opts has tx", () => {
    const tx = { set() {}, update() {} };
    expect(selectTicketWriter({ tx })).toBe(tx);
  });
  it("returns the batch when opts has batch", () => {
    const batch = { set() {}, update() {} };
    expect(selectTicketWriter({ batch })).toBe(batch);
  });
  it("prefers batch shape only when tx is absent (explicit branch)", () => {
    const batch = { set() {}, update() {} };
    const w = selectTicketWriter({ batch });
    expect(w).toBe(batch);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/offline/kitchenTicketWrites.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/offline/kitchenTicketWrites.ts`.**

```ts
"use client";

/** The write surface `createKitchenTickets` needs — satisfied by both a
 *  Firestore `Transaction` and a `WriteBatch`. */
export interface TicketWriter {
  set(ref: any, data: any, options?: any): unknown;
  update(ref: any, data: any): unknown;
}

/** Picks the transaction or batch writer, so `createKitchenTickets` can run
 *  inside an online transaction OR an offline local-first batch with identical
 *  write logic. */
export function selectTicketWriter(
  opts: { tx: TicketWriter } | { batch: TicketWriter },
): TicketWriter {
  return "tx" in opts ? opts.tx : opts.batch;
}
```

- [ ] **Step 4: Wire it into `createKitchenTickets`.**
In `src/components/cashier/firestore.ts`: import `selectTicketWriter` (and `WriteBatch` type from `firebase/firestore` if not already imported). Change the parameter `opts: { tx: Transaction }` to `opts: { tx: Transaction } | { batch: WriteBatch }`. At the top of the function body (after computing `ticketRef`/`ticketPayload`/`stationId`), add `const writer = selectTicketWriter(opts as any);` and replace the three write calls:
- `opts.tx.set(ticketRef, ticketPayload);` → `writer.set(ticketRef, ticketPayload);`
- `opts.tx.set(rtKdsDocRef, {...}, { merge: true });` → `writer.set(rtKdsDocRef, {...}, { merge: true });`
- `opts.tx.update(rtKdsDocRef, {...});` → `writer.update(rtKdsDocRef, {...});`
Do not change any payload. (The `as any` bridges the `Transaction`/`WriteBatch` union to `TicketWriter`; acceptable for this internal seam.)

- [ ] **Step 5: Run tests + typecheck.**
`npx vitest run src/lib/offline/kitchenTicketWrites.test.ts` → PASS (3). `npm run typecheck` → PASS (existing `{ tx }` callers still satisfy the wider union, so nothing else needs changing yet).

- [ ] **Step 6: Commit** (standard trailer lines)
```bash
git add src/components/cashier/firestore.ts src/lib/offline/kitchenTicketWrites.ts src/lib/offline/kitchenTicketWrites.test.ts
git commit -m "feat(offline): createKitchenTickets accepts a WriteBatch (offline-capable)"
```

---

### Task 2: RefillPOSModal — offline branches (writes-only, clean)

**Files:**
- Modify: `src/components/server/RefillPOSModal.tsx` — the two `runTransaction` blocks (~line 233 and ~line 366).

**Interfaces:**
- Consumes: `createKitchenTickets(..., { batch })` (Task 1); `commitLocalFirst`; `useOnlineStatus`.

Both refill transactions are **writes-only** (no `tx.get`) — they only create kitchen tickets via `createKitchenTickets`. So each converts cleanly to a batch.

- [ ] **Step 1: Add connectivity + offline branches.**
Import `commitLocalFirst` (`@/lib/offline/commit`), `writeBatch` (`firebase/firestore`), and `useOnlineStatus` (`@/hooks/use-online-status`); read `const isOnline = useOnlineStatus();` in the component. For EACH of the two `await runTransaction(db, async (tx) => { …createKitchenTickets(..., { tx })… })` blocks, wrap in a branch:

```ts
if (isOnline) {
  await runTransaction(db, async (tx) => { /* ...existing body unchanged, passing { tx }... */ });
} else {
  const batch = writeBatch(db);
  /* ...same body, but call createKitchenTickets(..., { batch }) instead of { tx }... */
  commitLocalFirst(batch, (err) => console.error("[RefillPOSModal] offline sync failed", err));
}
```
The offline body is the SAME loop/logic as the online one (the per-item and grouped-by-station `createKitchenTickets` calls), only swapping `{ tx }` → `{ batch }` and not awaiting. Do NOT change the ticket payloads or the station-missing validation (it still `throw`s before any commit, which is fine).

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/server/RefillPOSModal.tsx
git commit -m "feat(offline): create refill kitchen tickets offline via local-first batch"
```

> On-device verification is bundled into Task 5 (all ordering flows tested together offline).

---

### Task 3: session-detail-view — offline branch (writes-only)

**Files:**
- Modify: `src/components/cashier/session-detail-view.tsx` — the `runTransaction` at ~line 263 (line edit → optional addon kitchen ticket).

**Interfaces:**
- Consumes: `createKitchenTickets(..., { batch })`; `commitLocalFirst`; `useOnlineStatus`.

This transaction is **writes-only** (`tx.update(lineRef, after)`, `tx.update(sessionRef, { billingRevision: increment(1) })`, and `createKitchenTickets(..., { tx })`; `before`/`after`/`line` come from component state, not `tx.get`).

- [ ] **Step 1: Add the offline branch.**
Import/confirm `commitLocalFirst`, `writeBatch`, `useOnlineStatus` (this file already imports `writeBatch`). Read `const isOnline = useOnlineStatus();`. Wrap the `runTransaction` at ~263:

```ts
if (isOnline) {
  await runTransaction(db, async (tx) => { /* ...existing body unchanged, { tx }... */ });
} else {
  const batch = writeBatch(db);
  batch.update(lineRef, updatePayload);
  batch.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });
  const line = billLines.find((l) => l.id === lineId);
  if (!line) throw new Error("Line item not found in local state.");
  const diffQty = (after.qtyOrdered ?? 0) - (before.qtyOrdered ?? 0);
  if (line.type === "addon" && diffQty > 0 && line.kitchenLocationId) {
    await createKitchenTickets(db, storeId, sessionId, session, "addon", {
      billLineId: line.id,
      itemId: line.itemId,
      itemName: line.itemName,
      kitchenLocationId: line.kitchenLocationId,
      kitchenLocationName: line.kitchenLocationName,
    }, diffQty, actor, { batch });
  }
  commitLocalFirst(batch, (err) => console.error("[session-detail] offline sync failed", err));
}
```
Mirror the online body's exact field names (`updatePayload`, `actor`, the addon guard). Keep the online branch and everything after (the adjustment-flag refresh) unchanged.

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/cashier/session-detail-view.tsx
git commit -m "feat(offline): create addon kitchen tickets offline on session-detail edits"
```

---

### Task 4: AddonsPOSModal — offline branch (read-modify-write)

**Files:**
- Modify: `src/components/shared/AddonsPOSModal.tsx` — the `runTransaction` at ~line 290 (`tx.get(lineRef)` then update-or-create the line + kitchen ticket).

**Interfaces:**
- Consumes: `createKitchenTickets(..., { batch })`; `commitLocalFirst`; `useOnlineStatus`; Firestore `getDoc`.

This is the only **read-modify-write** flow: it reads the existing bill line to decide increment-vs-create. Offline, read from the local cache with `getDoc` (resolves from cache), then batch the same writes.

- [ ] **Step 1: Add the offline branch.**
Import `commitLocalFirst`, `useOnlineStatus`, and `getDoc` (the file already imports `writeBatch`, `doc`, `increment`, `serverTimestamp`). Read `const isOnline = useOnlineStatus();`. Wrap the `runTransaction` at ~290:

```ts
if (isOnline) {
  await runTransaction(db, async (tx) => { /* ...existing body unchanged, { tx }... */ });
} else {
  const lineRef = doc(db, `stores/${storeId}/sessions/${session.id}/sessionBillLines`, lineId);
  const lineSnap = await getDoc(lineRef); // cache-served offline
  const batch = writeBatch(db);
  if (lineSnap.exists()) {
    batch.update(lineRef, {
      qtyOrdered: increment(qty),
      updatedAt: serverTimestamp(),
      updatedByUid: actor.uid,
      updatedByName: actor.username,
    });
  } else {
    batch.set(lineRef, newLinePayload); // build newLinePayload identically to the online branch
  }
  if (addon.kitchenLocationId) {
    await createKitchenTickets(db, storeId, session.id, session, "addon", {
      itemId: addon.id,
      itemName: addon.displayName,
      kitchenLocationId: addon.kitchenLocationId,
      kitchenLocationName: addon.kitchenLocationName,
      billLineId: lineId,
    }, qty, actor, { batch }, /* notes/extra as in the online call */);
  }
  commitLocalFirst(batch, (err) => console.error("[AddonsPOSModal] offline sync failed", err));
}
```
Build `newLinePayload` and the `createKitchenTickets` line/args **identically** to the online branch (same fields — copy them from the online body; do not invent). Keep the online branch untouched.

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit** (trailer lines)
```bash
git add src/components/shared/AddonsPOSModal.tsx
git commit -m "feat(offline): add addon items + kitchen tickets offline (cache read + batch)"
```

---

### Task 5: On-device acceptance protocol (MANDATORY — the test for Tasks 2–4)

- [ ] **Step 1: Verify offline ticket creation end-to-end.**
On the APK or `npm run dev` + Chrome DevTools → Network **Offline**. Start from an open offline session (Plan 2). Record PASS/FAIL:
1. **Offline**, open the **Addons** modal and add an addon item with a kitchen location → no hang; the bill line appears; a kitchen ticket is created locally (visible in the session's tickets / local cache).
2. Add an addon that has **no kitchen location** → billed, but no ticket (unchanged behavior).
3. Offline, use the **Refill** modal (both the per-item refills AND the package first-order refill path) → refill kitchen tickets created locally.
4. Offline, on **session-detail**, increase an addon line's qty → an addon kitchen ticket is created for the diff; `billingRevision` incremented.
5. Confirm each offline ticket carries the correct `kitchenLocationId`/`kitchenLocationName`, `status:"preparing"`, and session context.
6. **Reconnect** → all offline tickets (addons, refills, session-detail) sync to Firebase and appear on the **kitchen tablet's** KDS, with **no duplicates** and correct stations.

If any step FAILS, report BLOCKED with specifics; do not close the plan.

---

## Self-Review

**Spec coverage (this plan's slice):**
- `createKitchenTickets` batch-capable (shared, no online/offline drift) → Task 1. ✅
- Refills offline (both paths) → Task 2. ✅
- Session-detail addon-qty edits offline → Task 3. ✅
- Add-addon-items offline (RMW, cache read) → Task 4. ✅
- All offline branches commit local-first, online transactions untouched, payloads verbatim → constraints + Tasks 2–4. ✅
- On-device verification incl. reconnect no-duplicates + correct stations → Task 5. ✅
- Explicitly deferred: `voidSession` offline (separate later plan); the kitchen network-printer backup + **per-kitchen-location print config** (next plan — tickets already carry `kitchenLocationId`, which that plan will use to print only designated locations).

**Placeholder scan:** Task 1 carries full code + tests. Tasks 2–4 give the exact offline-branch shape and instruct copying the online body's field names verbatim (rather than reproducing hundreds of lines that could drift) + a concrete on-device protocol. No "handle edge cases" hand-waving. ✅

**Type/behavior consistency:** `createKitchenTickets` opts union defined in Task 1 is what Tasks 2–4 pass (`{ batch }`); online callers still pass `{ tx }` unchanged. `commitLocalFirst`/`useOnlineStatus`/`getActorStamp` reused as in Plans 2–4A. Each offline branch mirrors its online sibling's writes 1:1 (only `{ tx }`→`{ batch }` and no-await). ✅

**Risk notes:** (1) Offline reads (AddonsPOSModal `getDoc(lineRef)`, and the component state the writes-only branches rely on) assume the session/lines are cached from normal use — exercised by the on-device protocol starting from a live offline session. (2) These modals also do non-Firestore work (toasts, close, local state) around the transaction — keep that outside/around the new branch exactly as today. (3) Any `await`ed post-write server call in these modals (if present) must be fired local-first offline the same way Plan 2 handled the activity log — check each modal's post-transaction code during implementation and flag if found.
