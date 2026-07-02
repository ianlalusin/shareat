# Offline POS — Plan 3: Offline Payment + OL Numbering + Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier take payment and print a receipt with **no internet**, by adding a **separate** offline payment path (`completePaymentOffline`) that mints a local `OL-` receipt number, records the sale via a local-first `writeBatch`, and defers all server-only side-effects (loyalty, PINs, analytics, KDS) to sync — while the proven online `completePaymentFromUnits` stays **completely untouched**.

**Architecture:** Chosen approach (user-confirmed): a separate offline path, not a refactor of the online transaction, so online money handling carries **zero regression risk**. Offline reads come from Firestore's local cache (`getDoc`/`getDocs`), the receipt number is minted locally (`<storeCode>-OL-<HHMM>-<NNN>`), and all writes go in one `writeBatch` committed via Plan 1's `commitLocalFirst` (no server-ack wait). The money-critical change/tender validation is extracted into a **pure, unit-tested** helper reused by the offline path. Server-only effects (loyalty earn/redeem, PIN finalize, server analytics, KDS rollups) are **deferred**: the offline receipt is written with `analyticsApplied: false` and an `offlineOrigin` marker, and a queue entry records that it needs server finalization on reconnect (the durable outbox that drains it is Plan 4).

**Tech Stack:** TypeScript, Firebase JS SDK v10 (Firestore, offline persistence on), Next.js/Capacitor client, Vitest (node).

## Global Constraints

- Node `>=20 <21`. Vitest node env, glob `src/**/*.test.ts`, alias `@` → `./src`. Pure-unit-test pattern (in-memory fakes). No new runtime dependencies. Browser modules start with `"use client";`.
- **Do NOT modify `completePaymentFromUnits` (the online path).** The only allowed change to `firestore.ts` is adding `export` to the existing `getCurrentSessionBillingState` (line ~113) so the offline module can reuse it.
- Reuse (already merged): `commitLocalFirst` (`@/lib/offline/commit`); `nextDailySeq` + `formatOfflineReceiptNumber` (`@/lib/offline/offlineReceiptNumber`); `getActorStamp` + (newly exported) `getCurrentSessionBillingState` (`@/components/cashier/firestore`); `calculateBillTotals` (`@/lib/tax`); `addToQueue` (`@/lib/offline/payment-queue`).
- Offline receipt number format EXACTLY `<storeCode>-OL-<HHMM>-<NNN>` from `store.code`, device clock, and the per-device daily sequence. Numbering must never crash the sale (Plan 1 guardrail): if the sequence state is corrupt, surface a controlled error to the caller, don't let it bubble unhandled — see Task 2 Step 4.
- Every session/receipt write in the offline path increments the session `revision` (spec §4.4 ownership model): closing the session sets `revision: (existing ?? 1) + 1`.
- **Deferred, NOT run offline:** loyalty earn/redeem, PIN finalize/disable, `/api/analytics/apply-delta`, `rtKdsTickets` rollups, KDS analytics deltas. The offline receipt omits the baked `analytics` object; analytics is computed and applied on reconnect (Plan 4).
- Numbering assumption (documented): the daily sequence uses localStorage (`nextDailySeq`), which is race-free in the **single-webview APK** (JS is single-threaded; a sync read-modify-write can't be interrupted). Multi-tab web contexts would need the IndexedDB single-writer from the Plan-1 guardrail; that hardening is deferred because the shipping target is the single-tab APK. Flag this to the user if the target changes.
- Typecheck: `npm run typecheck`. **Testing reality:** the pure helper (Task 1) is TDD'd in Node; the Firestore-coupled offline path (Tasks 2–3) is verified by `npm run typecheck` + the **mandatory on-device offline protocol** in Task 3 (no emulator exercises the IndexedDB offline cache).

---

### Task 1: Pure offline payment-summary helper (tender + change validation)

**Files:**
- Create: `src/lib/offline/offlinePaymentSummary.ts`
- Test: `src/lib/offline/offlinePaymentSummary.test.ts`

**Interfaces:**
- Consumes: nothing (leaf; declares its own minimal input shapes).
- Produces:
  - `export interface PaymentInput { methodId?: string; amount?: number }`
  - `export interface MopInput { id: string; name?: string; type?: string }`
  - `export interface PaymentSummary { mopMap: Record<string, number>; totalPaid: number; change: number }`
  - `export function buildOfflinePaymentSummary(args: { payments: PaymentInput[]; paymentMethods: MopInput[]; amountDueCents: number }): PaymentSummary`

This transcribes the online path's balance/tender/change logic (currently inside `completePaymentFromUnits`: the balance guard and the `mopCentsMap`/change block) into a pure, testable function. Same rules: reject underpayment; when change exceeds 1 cent, it must come from a cash tender, and cash must cover it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/offline/offlinePaymentSummary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOfflinePaymentSummary } from "@/lib/offline/offlinePaymentSummary";

const CASH = { id: "m_cash", name: "Cash", type: "cash" };
const CARD = { id: "m_card", name: "Card", type: "card" };

describe("buildOfflinePaymentSummary", () => {
  it("exact cash: no change, mop reflects the tender", () => {
    const r = buildOfflinePaymentSummary({
      payments: [{ methodId: "m_cash", amount: 100 }],
      paymentMethods: [CASH, CARD],
      amountDueCents: 10000,
    });
    expect(r).toEqual({ mopMap: { Cash: 100 }, totalPaid: 100, change: 0 });
  });

  it("cash with change: change is deducted from the cash mop", () => {
    const r = buildOfflinePaymentSummary({
      payments: [{ methodId: "m_cash", amount: 150 }],
      paymentMethods: [CASH, CARD],
      amountDueCents: 10000,
    });
    expect(r.change).toBe(50);
    expect(r.totalPaid).toBe(150);
    expect(r.mopMap.Cash).toBe(100); // 150 tendered - 50 change
  });

  it("card exact: no change, mop by method name", () => {
    const r = buildOfflinePaymentSummary({
      payments: [{ methodId: "m_card", amount: 100 }],
      paymentMethods: [CASH, CARD],
      amountDueCents: 10000,
    });
    expect(r).toEqual({ mopMap: { Card: 100 }, totalPaid: 100, change: 0 });
  });

  it("split cash+card exact: both mops present, no change", () => {
    const r = buildOfflinePaymentSummary({
      payments: [
        { methodId: "m_card", amount: 60 },
        { methodId: "m_cash", amount: 40 },
      ],
      paymentMethods: [CASH, CARD],
      amountDueCents: 10000,
    });
    expect(r.change).toBe(0);
    expect(r.mopMap).toEqual({ Card: 60, Cash: 40 });
  });

  it("throws when underpaid", () => {
    expect(() =>
      buildOfflinePaymentSummary({
        payments: [{ methodId: "m_cash", amount: 90 }],
        paymentMethods: [CASH],
        amountDueCents: 10000,
      }),
    ).toThrow(/balance is not zero/);
  });

  it("throws when change exists but no cash tender", () => {
    expect(() =>
      buildOfflinePaymentSummary({
        payments: [{ methodId: "m_card", amount: 150 }],
        paymentMethods: [CASH, CARD],
        amountDueCents: 10000,
      }),
    ).toThrow(/no Cash payment/i);
  });

  it("throws when change exceeds cash tendered", () => {
    expect(() =>
      buildOfflinePaymentSummary({
        payments: [
          { methodId: "m_card", amount: 90 },
          { methodId: "m_cash", amount: 60 },
        ],
        paymentMethods: [CASH, CARD],
        amountDueCents: 10000,
      }),
    ).toThrow(/exceeds cash paid/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/offline/offlinePaymentSummary.test.ts`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/offline/offlinePaymentSummary.ts`:

```ts
"use client";

export interface PaymentInput {
  methodId?: string;
  amount?: number;
}
export interface MopInput {
  id: string;
  name?: string;
  type?: string;
}
export interface PaymentSummary {
  mopMap: Record<string, number>;
  totalPaid: number;
  change: number;
}

/**
 * Pure tender/change validation + mode-of-payment breakdown for an offline
 * sale. Transcribed from the online completePaymentFromUnits balance/change
 * logic so offline and online agree. Amounts are in whole currency units;
 * `amountDueCents` is the bill total in cents. Throws on underpayment, on
 * change without a cash tender, or on change exceeding the cash tendered.
 */
export function buildOfflinePaymentSummary(args: {
  payments: PaymentInput[];
  paymentMethods: MopInput[];
  amountDueCents: number;
}): PaymentSummary {
  const { payments, paymentMethods, amountDueCents } = args;

  const totalPaidCents = payments.reduce(
    (s, p) => s + Math.round(Number(p.amount || 0) * 100),
    0,
  );

  if (totalPaidCents < amountDueCents - 1) {
    throw new Error(
      `Cannot complete payment: balance is not zero. Paid: ₱${(totalPaidCents / 100).toFixed(2)}, Due: ₱${(amountDueCents / 100).toFixed(2)}`,
    );
  }

  const mopCentsMap: Record<string, number> = {};
  for (const payment of payments) {
    const method = paymentMethods.find((m) => m.id === payment.methodId);
    const key = method?.name || payment.methodId || "unknown";
    mopCentsMap[key] =
      (mopCentsMap[key] || 0) + Math.round(Number(payment.amount || 0) * 100);
  }

  const changeCents = Math.max(0, totalPaidCents - amountDueCents);
  if (changeCents > 1) {
    const cashMethod =
      paymentMethods.find((pm) => String(pm.type || "").toLowerCase() === "cash") ||
      paymentMethods.find((pm) => String(pm.name || "").toLowerCase().includes("cash"));
    let cashKey = cashMethod?.name;
    if (!cashKey) cashKey = Object.keys(mopCentsMap).find((k) => k.toLowerCase().includes("cash"));
    if (!cashKey || mopCentsMap[cashKey] == null) {
      throw new Error("Change exists but no Cash payment was included. Add Cash payment.");
    }
    if (mopCentsMap[cashKey] < changeCents) {
      throw new Error(
        `Invalid payment: change (₱${(changeCents / 100).toFixed(2)}) exceeds cash paid (₱${(mopCentsMap[cashKey] / 100).toFixed(2)}).`,
      );
    }
    mopCentsMap[cashKey] -= changeCents;
  }

  const mopMap: Record<string, number> = {};
  for (const [key, cents] of Object.entries(mopCentsMap)) mopMap[key] = cents / 100;

  return { mopMap, totalPaid: totalPaidCents / 100, change: changeCents / 100 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/offline/offlinePaymentSummary.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit** (append the two standard trailer lines)

```bash
git add src/lib/offline/offlinePaymentSummary.ts src/lib/offline/offlinePaymentSummary.test.ts
git commit -m "feat(offline): pure offline payment-summary (tender + change validation)"
```

---

### Task 2: `completePaymentOffline` — record the sale locally

**Files:**
- Create: `src/components/cashier/offlinePayment.ts`
- Modify: `src/components/cashier/firestore.ts` — add `export` to `getCurrentSessionBillingState` (line ~113). Change `async function getCurrentSessionBillingState(` to `export async function getCurrentSessionBillingState(`. No other change to that file.

**Interfaces:**
- Consumes: `commitLocalFirst`; `nextDailySeq`, `formatOfflineReceiptNumber`; `getActorStamp`, `getCurrentSessionBillingState`; `calculateBillTotals`; `buildOfflinePaymentSummary`; `addToQueue`; Firestore `doc/collection/getDoc/getDocs/query/where/writeBatch/serverTimestamp`; `db`; `stripUndefined`; `uuidv4`.
- Produces: `export async function completePaymentOffline(storeId: string, sessionId: string, user: AppUser, payments: Payment[], store: Store, paymentMethods: ModeOfPayment[], expectedTotal?: number): Promise<{ receiptId: string; receiptNumber: string }>`

- [ ] **Step 1: Export the shared billing-state reader**

In `src/components/cashier/firestore.ts`, change the declaration at ~line 113 from `async function getCurrentSessionBillingState(` to `export async function getCurrentSessionBillingState(`. Nothing else in that file changes.

- [ ] **Step 2: Create the offline payment module**

Create `src/components/cashier/offlinePayment.ts`:

```ts
"use client";

import {
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { Payment, Store, ModeOfPayment } from "@/lib/types";
import { stripUndefined } from "@/lib/firebase/utils";
import { calculateBillTotals } from "@/lib/tax";
import {
  getActorStamp,
  getCurrentSessionBillingState,
} from "@/components/cashier/firestore";
import { commitLocalFirst } from "@/lib/offline/commit";
import {
  nextDailySeq,
  formatOfflineReceiptNumber,
} from "@/lib/offline/offlineReceiptNumber";
import { buildOfflinePaymentSummary } from "@/lib/offline/offlinePaymentSummary";
import { addToQueue } from "@/lib/offline/payment-queue";

/**
 * Records a completed sale entirely from the local Firestore cache — no
 * network. Mirrors the CORE of completePaymentFromUnits (reads → checks →
 * receipt → close → free table → mark tickets served) but: (1) reads from
 * cache via getDoc/getDocs; (2) mints a local OL receipt number instead of the
 * server counter; (3) writes via a single writeBatch committed local-first;
 * (4) defers ALL server-only effects (analytics, KDS rollups, loyalty, PINs)
 * to sync. Online sales still go through completePaymentFromUnits unchanged.
 */
export async function completePaymentOffline(
  storeId: string,
  sessionId: string,
  user: AppUser,
  payments: Payment[],
  store: Store,
  paymentMethods: ModeOfPayment[],
  expectedTotal?: number,
): Promise<{ receiptId: string; receiptNumber: string }> {
  // 1. Billing state + totals (cache-served reads).
  const billingState = await getCurrentSessionBillingState(storeId, sessionId);
  const { billLines, billDiscount, customAdjustments, loyaltyRedemptions } = billingState;
  const loyaltyDiscountInput = (loyaltyRedemptions || []).map((r) => ({ type: r.type, value: r.value }));
  const finalTotals = calculateBillTotals(billLines, store, billDiscount, customAdjustments, loyaltyDiscountInput);
  const amountDue = finalTotals.grandTotal;
  if (typeof expectedTotal === "number" && Math.abs(Math.round(expectedTotal * 100) - Math.round(amountDue * 100)) > 1) {
    throw new Error(`Bill changed before payment could be finalized. Review the bill and collect ₱${amountDue.toFixed(2)}.`);
  }

  const now = Date.now();
  const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
  const receiptRef = doc(db, `stores/${storeId}/receipts`, sessionId);
  const activeProjectionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);

  const [sessionSnap, receiptSnap, activeProjectionSnap] = await Promise.all([
    getDoc(sessionRef),
    getDoc(receiptRef),
    getDoc(activeProjectionRef),
  ]);

  const sessionData = sessionSnap.data() as any;
  if (!sessionData) throw new Error(`Session ${sessionId} is not available offline. Open it while online first.`);

  // Idempotency: already finalized.
  if ((receiptSnap.exists() && receiptSnap.data()?.analyticsApplied) || sessionData.status === "closed" || sessionData.isPaid === true) {
    const existingNumber = (receiptSnap.data()?.receiptNumber as string) || "";
    return { receiptId: receiptSnap.exists() ? receiptSnap.id : sessionId, receiptNumber: existingNumber };
  }

  // Billing-revision concurrency guard (same as online).
  const currentBillingRevision = Number(sessionData.billingRevision ?? 0);
  if (currentBillingRevision !== billingState.billingRevision) {
    throw new Error("Bill changed during payment. Review the bill and try again.");
  }

  // 2. Tender/change validation + MOP (pure, shared with tests).
  const amountDueCents = Math.round(Number(amountDue || 0) * 100);
  const summary = buildOfflinePaymentSummary({ payments, paymentMethods, amountDueCents });

  // 3. Mint the local OL receipt number (must not crash the sale on corruption).
  let seq: number;
  try {
    seq = nextDailySeq(window.localStorage, new Date());
  } catch (e) {
    throw new Error("Offline receipt numbering is unavailable on this device. Reconnect to take payment, or contact support.");
  }
  const receiptNumber = formatOfflineReceiptNumber({ storeCode: store.code, date: new Date(), seq });

  // 4. Build the local-first batch.
  const actor = getActorStamp(user);
  const serverTs = serverTimestamp();
  const batch = writeBatch(db);

  // payments subcollection
  const paymentsCol = collection(db, `stores/${storeId}/sessions`, sessionId, "payments");
  payments.forEach((payment) => {
    const paymentRef = doc(paymentsCol);
    batch.set(paymentRef, {
      ...payment,
      id: paymentRef.id,
      createdByUid: actor.uid,
      createdByUsername: actor.username,
      createdAt: serverTs,
    });
  });

  // mark active kitchen tickets served (local state; KDS rollups deferred)
  const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
  const activeTicketsSnap = await getDocs(query(ticketsRef, where("status", "in", ["preparing", "ready"])));
  activeTicketsSnap.docs.forEach((t) => {
    const st = t.data() as any;
    if (st.status === "served" || st.status === "cancelled") return;
    batch.update(t.ref, { status: "served", servedAt: serverTs, servedAtClientMs: now, servedByUid: actor.uid, updatedAt: serverTs });
  });

  // close session (increment ownership revision)
  batch.update(sessionRef, {
    status: "closed",
    isPaid: true,
    closedByUid: actor.uid,
    closedByUsername: actor.username,
    closedAt: serverTs,
    closedAtClientMs: now,
    revision: Number(sessionData.revision ?? 1) + 1,
    updatedAt: serverTs,
  });

  // move projection active → closed
  const closedProjectionRef = doc(db, `stores/${storeId}/closedSessions`, sessionId);
  const projectionSource = activeProjectionSnap.exists() ? activeProjectionSnap.data() : sessionData;
  batch.set(closedProjectionRef, {
    ...projectionSource,
    status: "closed",
    customerAccessEnabled: false,
    updatedAt: serverTs,
    closedAt: serverTs,
    closedAtClientMs: now,
  });
  if (activeProjectionSnap.exists()) batch.delete(activeProjectionRef);

  // receipt doc — analytics DEFERRED (analyticsApplied:false, no baked analytics)
  const receiptPayload = stripUndefined({
    id: sessionId,
    storeId,
    sessionId,
    receiptId: sessionId,
    createdByUid: actor.uid,
    createdByUsername: actor.username,
    sessionMode: sessionData.sessionMode,
    tableId: sessionData.sessionMode === "alacarte" ? null : sessionData.tableId ?? null,
    tableNumber: sessionData.sessionMode === "alacarte" ? null : sessionData.tableNumber ?? null,
    customerName: sessionData.customer?.name ?? sessionData.customerName ?? null,
    total: amountDue,
    totalPaid: summary.totalPaid,
    change: summary.change,
    mop: summary.mopMap,
    status: "final",
    receiptSeq: seq,
    receiptNumber,
    receiptNoFormatUsed: "OL",
    offlineOrigin: true,
    createdAtClientMs: now,
    lines: billLines,
    billDiscount: billDiscount ?? null,
    customAdjustments: customAdjustments ?? [],
    loyaltyRedemptions: loyaltyRedemptions ?? [],
    analyticsApplied: false,
    analyticsApplyId: uuidv4(),
    createdAt: serverTs,
  });
  batch.set(receiptRef, receiptPayload);

  // free the table + its projection
  if (sessionData.tableId && sessionData.tableId !== "alacarte") {
    const tableRef = doc(db, `stores/${storeId}/tables`, sessionData.tableId);
    const tableSnap = await getDoc(tableRef);
    if (tableSnap.exists() && (tableSnap.data() as any).currentSessionId === sessionId) {
      batch.update(tableRef, { status: "available", currentSessionId: null, updatedAt: serverTs });
      const tableProjectionRef = doc(db, `stores/${storeId}/storeConfig/current/tables`, sessionData.tableId);
      batch.update(tableProjectionRef, {
        status: "available",
        currentSessionId: null,
        customerName: null,
        packageLabel: null,
        sessionType: null,
        guestCount: null,
        itemCount: null,
        startedAtMs: null,
        updatedAt: serverTs,
      });
    }
  }

  // 5. Commit local-first (does not await the server ack that never comes offline).
  commitLocalFirst(batch, (err) => console.error("[completePaymentOffline] batch sync failed", err));

  // 6. Record a deferred-finalization marker (Plan 4's outbox drains loyalty/PINs/analytics).
  addToQueue({ storeId, sessionId, payload: { payments, totalAmount: amountDue } });

  return { receiptId: sessionId, receiptNumber };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `Payment`/`Store`/`ModeOfPayment` import paths differ, fix the import to match `firestore.ts`'s own imports (it imports these types from `@/lib/types`). If `getActorStamp`/`getCurrentSessionBillingState` aren't found, confirm Step 1's `export` was applied.

- [ ] **Step 4: Commit** (append the two standard trailer lines)

```bash
git add src/components/cashier/offlinePayment.ts src/components/cashier/firestore.ts
git commit -m "feat(offline): completePaymentOffline records sales locally with OL numbers"
```

> On-device verification for the offline write happens together with the modal wiring in Task 3 (the two must be tested as one flow).

---

### Task 3: Wire the payment modal's offline branch + print

**Files:**
- Modify: `src/components/cashier/payment-modal.tsx` — the existing `if (!isOnline) { … }` branch (around line 290, currently a stub that only calls `addToQueue`).

**Interfaces:**
- Consumes: `completePaymentOffline` from `@/components/cashier/offlinePayment`; the modal's existing receipt-print flow.

- [ ] **Step 1: Read the current offline branch and the online success/print flow**

Open `src/components/cashier/payment-modal.tsx`. Read the `handleConfirm`/submit handler around lines 280–400: the `if (!isOnline) { addToQueue(...) }` stub, the online `const receiptId = await completePaymentFromUnits(...)` call, and whatever the modal does after success (close session UI, trigger receipt print, toast, close modal). You will mirror the online success path for the offline result.

- [ ] **Step 2: Replace the offline stub with a real offline sale + print**

Replace the body of the `if (!isOnline) { … }` branch so it:
1. Calls `const { receiptId, receiptNumber } = await completePaymentOffline(storeId, sessionId, user, payments, activeStore, paymentMethods, grandTotal);` (use the same argument sources the online `completePaymentFromUnits` call uses in this file).
2. Runs the SAME post-success steps the online branch runs — trigger the existing receipt-print path (which builds ESC/POS text locally via `receiptFormatter`/`printHub` and already works offline), show the success toast, and close the modal/session UI — passing the offline `receiptNumber`/`receiptId` where the online path passes its own.
3. Keeps the existing `try/catch` so a thrown validation error (underpayment, corrupt numbering, bill changed) surfaces as the existing destructive toast rather than a silent failure.

Remove the old `addToQueue(...)`-only stub logic (the deferred-marker queue entry is now created inside `completePaymentOffline`, so it must not be duplicated here). Import `completePaymentOffline` at the top of the file.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: On-device offline acceptance protocol (MANDATORY — this is the test for Tasks 2 & 3)**

Build/run the app (APK via `npm run build:cap`, or `npm run dev` + Chrome DevTools → Network → **Offline**). Start from an offline session created per Plan 2. Record PASS/FAIL for each:
1. Go **offline**. Open a session with items on the bill.
2. Take an **exact cash** payment. Expected: no hang; a receipt with an `…-OL-<HHMM>-<NNN>` number is produced; the **receipt prints** (thermal/USB or browser); the session closes in the UI. PASS/FAIL.
3. Take a payment **with change** (cash tendered > total). Expected: change shown/printed correctly; sale completes. PASS/FAIL.
4. Try to confirm with an **underpayment**. Expected: blocked with the existing balance error toast (no receipt written). PASS/FAIL.
5. Inspect the offline receipt/session: receipt `status:'final'`, `offlineOrigin:true`, `analyticsApplied:false`, `receiptNumber` OL-formatted; session `status:'closed'`, `isPaid:true`, `revision` incremented; table freed. PASS/FAIL.
6. **Reconnect.** Expected within seconds: the receipt, payments, closed session, and freed table appear in the Firebase console, with **no duplicates** and the SAME OL receipt number. (Loyalty/PINs/analytics remain pending — that's Plan 4.) PASS/FAIL.

If any step FAILS, report BLOCKED with the step and observed behavior; do not mark Task 3 complete.

- [ ] **Step 5: Commit** (append the two standard trailer lines)

```bash
git add src/components/cashier/payment-modal.tsx
git commit -m "feat(offline): take payment + print receipt offline via completePaymentOffline"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- Offline payment records the sale locally (spec §4.3) → Task 2. ✅
- Local OL receipt number `<storeCode>-OL-<HHMM>-<NNN>` (spec §3, §4.2.2) → Task 2 Step 2 (via Plan 1 helpers). ✅
- Tender/change validation preserved & tested (money correctness) → Task 1. ✅
- Print receipt offline (scope item) → Task 3 (reuses existing offline-capable print). ✅
- Server-only effects deferred, never block the sale (user decision) → analytics omitted + `addToQueue` marker; full drain is Plan 4. ✅
- Online payment untouched (zero regression, user decision) → only `export` added to a reader; `completePaymentFromUnits` unchanged. ✅
- Numbering never crashes the sale (Plan 1 guardrail) → Task 2 Step wraps `nextDailySeq` in try/catch with a user-facing error. ✅
- Session `revision` increment on close (spec §4.4) → Task 2 batch `revision: (…)+1`. ✅
- Deferred to Plan 4: durable outbox + idempotent replay of loyalty/PINs/analytics/KDS; connectivity UI/sync report.

**Placeholder scan:** Task 1 & 2 carry complete code. Task 3 gives exact edit instructions against a file the implementer must read (the online success/print flow is in that file and must be mirrored, not reproduced blindly) plus a concrete on-device protocol. No TBD/hand-waving. ✅

**Type/behavior consistency:** `buildOfflinePaymentSummary` signature matches between Task 1 and its Task 2 call site. `getCurrentSessionBillingState` is exported (Task 2 Step 1) before Task 2 imports it. `completePaymentOffline` returns `{ receiptId, receiptNumber }`, consumed in Task 3. Receipt fields mirror the online receipt's core (minus deferred `analytics`). ✅

**Risk notes:** (1) Cache dependency — offline reads assume the session/bill/settings are already cached from normal use; the on-device protocol starts from a real offline session so this is exercised. (2) Logic duplication — the receipt/close/free-table write shapes are reproduced from the online path rather than shared, to honor "leave online untouched"; a future cleanup can DRY them. (3) The deferred effects (loyalty/PINs/analytics/KDS) are only marked, not yet replayed — Plan 4 owns the durable drain; until then, an offline sale's loyalty/analytics finalize only after reconnect via the existing (minimal) queue.
