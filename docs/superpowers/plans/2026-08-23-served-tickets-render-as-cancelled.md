# Served Kitchen Tickets Render as "Cancelled" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the CUSTOMER app telling diners their food was cancelled when POS says it was served, and stop POS's payment paths minting tickets that trigger it.

**Architecture:** Two layers, in this order. (1) CUSTOMER stops inferring the outcome from `qtyServed` and reads POS's `status` as the truth — this alone fixes every existing ticket, including the ~4 months of historical ones, with no data migration. (2) POS's two payment-time serve paths start writing the `qtyServed`/`qtyRemaining` bookkeeping that the KDS serve paths already write, through one shared helper so the three writers cannot drift again. A third, operational layer reloads the stale KDS clients at Lipa and Davao.

**Tech Stack:** Next.js 15 (App Router) in both repos, Firestore (`shareat-hub-v2`), Firebase Admin SDK server-side in CUSTOMER, Firebase Web SDK client-side in POS, vitest in both.

**Spec:** This document. The investigation that produced it is summarised in "Evidence" below; there is no separate spec doc.

## Global Constraints

- **Two repos, two branches.** POS work goes on `C:\Users\ianla\webapps\POS`, branch `sev5_advanced`. CUSTOMER work goes on `C:\Users\ianla\webapps\CUSTOMER`, branch `main`. Verify with `git rev-parse --abbrev-ref HEAD` before touching anything; if either prints something else, STOP and report what it printed.
- **Never push.** Ian pushes. Pushing POS `sev5_advanced` deploys app.shareat.net; pushing CUSTOMER `main` IS the CUSTOMER deploy. Commit locally only.
- **The ticket shape is a published interface between two separately-deployed apps.** Widen additively; never rename a field in place. See `POS/src/lib/kitchen/customer-order-billing.ts` for the existing statement of that contract.
- **`status` is the truth; `qtyServed` is bookkeeping.** Every change here follows from that. Do not reintroduce logic that derives an outcome from a quantity counter.
- **POS tests:** `npm test` (vitest run) from `C:\Users\ianla\webapps\POS`.
- **CUSTOMER tests:** `npx vitest run` from `C:\Users\ianla\webapps\CUSTOMER` — there is no `test` script in its `package.json`. `vitest.config.ts` collects **only** `src/lib/**/*.test.ts`, so any logic that needs a test must live under `src/lib/`.
- **CUSTOMER build on Windows:** `npm run build` uses a Unix `NODE_ENV=` prefix that fails on Windows. Use `NODE_ENV=production npx next build`.
- **Do not build a repo while its dev server is running** — `next build` overwrites the `.next` that `next dev` is serving.

---

## Evidence (why this plan exists)

Verified 2026-08-23 against production Firestore (`shareat-hub-v2`), read-only, plus a live end-to-end run on the TEST store through app.shareat.net and customer.shareat.net.

**The rendering rule.** `CUSTOMER/src/app/api/customer/session-orders/route.ts:41`:

```ts
if (s === "served") return qtyServed > 0 ? "served" : "cancelled";
```

`qtyServed` is read as `Number(t.qtyServed ?? 0) || 0`, so *missing* and *zero* both flip a served ticket to **Cancelled** in the diner's order log. Nothing else in `SessionOrdersPanel` can print that label — unknown statuses fall back to `preparing`.

**Live reproduction (TEST store, 2026-08-23).** Session `7cw36xaDf8dnQoTvND32`, package ticket "LT-Pork and Chicken": customer app showed **Preparing** → tapped **Served** on the KDS → customer app showed **Served**, and the ticket carries `qtyServed: 1`. So the *currently deployed* KDS code is correct; the bug is not in today's plain-serve path.

**Production scan, last 12 sessions per store,** classifying each served ticket by which writer closed it (`serveLog` ⇒ KDS batch serve, `preparedByUid` ⇒ KDS plain serve, neither ⇒ payment sweep):

| Store | kds-batch OK | kds-plain OK | kds-plain → renders CANCELLED | payment-sweep → renders CANCELLED |
|---|---|---|---|---|
| SharEat Lipa | 5 | 0 | **41** | 4 |
| SharEat Davao | 0 | 0 | **34** | 3 |
| SharEat Banay-Banay | 0 | 0 | 0 | **22** |
| SharEat Malvar | 2 | **40** | 0 | 5 |
| TEST | 1 | 25 | 11 (all pre-2026-08-21) | 1 |

Two independent producers, both live:

1. **Stale KDS clients.** `updatePayload.qtyServed` was added to `updateTicketStatus` in POS `dcb3271` at **2026-08-21 03:46 +08:00** (`src/app/kitchen/page.tsx:559`). Malvar's KDS writes it (40/40). Lipa's and Davao's write it **never** (0/41, 0/34) across three and one staff profile respectively — those tablets are still running the pre-`dcb3271` JS bundle in a tab that has never been reloaded. TEST shows the boundary inside one session: `1gONQ8Ku53KybBk0dUik` has a Kimbap served 03:31:42 with `qtyServed: 0` and another served 03:37:40 with `qtyServed: 1`.
2. **The payment sweep.** `completeSessionPayment` (`POS/src/components/cashier/firestore.ts:525-545`) and `settleOffline` (`POS/src/components/cashier/offlinePayment.ts:118-125`) flip every still-`preparing` ticket to `status: "served"` and write **no quantity fields at all**. This is 100% of Banay-Banay's served tickets — that branch never taps Served; the cashier's payment closes the tickets. This path is invisible to a diner (payment deletes `activeSessions/{id}`, so the customer route 404s afterwards) but it corrupts the record and the analytics.

**The package ticket is the first order and the most exposed.** `startSession` (`POS/src/components/cashier/firestore.ts:307-330`) writes the package ticket with `qty: 1` and **no** `qtyOrdered`, `qtyServed`, `qtyCancelled`, `qtyRemaining`, or `serveLog` — the only ticket in the system created without that bookkeeping (`createKitchenTickets` at `firestore.ts:1400-1406` and CUSTOMER's `writeKitchenTicket` both set them). Every production package ticket in the scan reads `qtyOrdered=undefined qtyServed=undefined`, which is why the diner's *first* row is the one that always reads Cancelled.

**Second-order damage.** `computeKdsTargets` reads `t.qtyServed ?? fallback` — nullish, not falsy (`POS/src/lib/analytics/kdsTargets.ts:41`, pinned by `kdsTargets.test.ts`). A ticket carrying an explicit `qtyServed: 0` therefore logs **zero serves**, so Lipa's, Davao's and Banay-Banay's kitchen throughput stats are understated today.

**Third-order damage.** `hasPendingFirstServing` (`CUSTOMER/src/lib/session-orders.ts`) treats a "cancelled" package ticket as *nothing is coming*, so the first-serving refill gate never fires for those tables.

---

## File Structure

**CUSTOMER** (`C:\Users\ianla\webapps\CUSTOMER`)

- `src/lib/session-orders.ts` — **modify.** Already owns the `SessionOrder` type and the pure order-list logic, and is inside the only directory vitest collects. Gains the three pure mapping functions the API route currently inlines.
- `src/lib/__tests__/session-orders.test.ts` — **modify.** Existing suite; gains the mapping tests.
- `src/app/api/customer/session-orders/route.ts` — **modify.** Loses its private `customerStatus`; becomes a thin caller of the library.

**POS** (`C:\Users\ianla\webapps\POS`)

- `src/lib/kitchen/served-qty.ts` — **create.** One function that answers "what quantity bookkeeping does closing this ticket as served imply?". Lives beside `customer-order-billing.ts`, the other module that exists so two serve paths cannot disagree.
- `src/lib/kitchen/served-qty.test.ts` — **create.**
- `src/app/kitchen/page.tsx` — **modify** (lines 528-560). Adopts the helper. Behaviour-identical; this is what stops the helper drifting from the path that already works.
- `src/components/cashier/firestore.ts` — **modify** (lines 525-545). Payment sweep adopts the helper.
- `src/components/cashier/offlinePayment.ts` — **modify** (lines 118-125). Offline payment sweep adopts the helper.

---

### Task 1: CUSTOMER — pure status/quantity mapping, with tests

The whole customer-facing fix lives here. Put it in `src/lib/` because that is the only place vitest looks.

**Files:**
- Modify: `C:\Users\ianla\webapps\CUSTOMER\src\lib\session-orders.ts`
- Test: `C:\Users\ianla\webapps\CUSTOMER\src\lib\__tests__\session-orders.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces, all exported from `@/lib/session-orders`:
  - `type RawKitchenTicket = { status?: unknown; qty?: unknown; qtyOrdered?: unknown; qtyServed?: unknown; qtyCancelled?: unknown }`
  - `orderedQtyFor(t: RawKitchenTicket): number`
  - `customerStatus(t: RawKitchenTicket): SessionOrder["status"]`
  - `servedQtyFor(t: RawKitchenTicket): number`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/session-orders.test.ts`, and add `customerStatus`, `orderedQtyFor`, `servedQtyFor`, and `type RawKitchenTicket` to the existing import block at the top of that file:

```ts
describe("customerStatus — POS's status is the truth", () => {
  it("shows Served for a ticket POS served but never counted", () => {
    // The package ticket startSession writes: qty only, no qty* bookkeeping.
    expect(customerStatus({ status: "served", qty: 1 })).toBe("served");
  });

  it("shows Served for a ticket carrying an explicit qtyServed: 0", () => {
    // What a pre-2026-08-21 KDS bundle and both payment sweeps leave behind.
    expect(customerStatus({ status: "served", qtyOrdered: 1, qtyServed: 0 })).toBe("served");
  });

  it("shows Cancelled only when POS says cancelled", () => {
    expect(customerStatus({ status: "cancelled", qtyOrdered: 1, qtyServed: 0 })).toBe("cancelled");
  });

  it("passes through the partial state", () => {
    expect(customerStatus({ status: "partially_served", qtyOrdered: 3, qtyServed: 1 })).toBe("partially_served");
  });

  it("treats anything else — including POS's `ready` — as still preparing", () => {
    expect(customerStatus({ status: "preparing" })).toBe("preparing");
    expect(customerStatus({ status: "ready" })).toBe("preparing");
    expect(customerStatus({})).toBe("preparing");
  });

  it("is case-insensitive, because the value crosses an app boundary", () => {
    expect(customerStatus({ status: "SERVED", qty: 1 })).toBe("served");
  });
});

describe("orderedQtyFor", () => {
  it("prefers qtyOrdered", () => {
    expect(orderedQtyFor({ qtyOrdered: 3, qty: 1 })).toBe(3);
  });

  it("falls back to qty for the package ticket, which has no qtyOrdered", () => {
    expect(orderedQtyFor({ qty: 1 })).toBe(1);
  });

  it("is 0 when neither is usable", () => {
    expect(orderedQtyFor({})).toBe(0);
    expect(orderedQtyFor({ qty: "junk" })).toBe(0);
  });
});

describe("servedQtyFor", () => {
  it("uses the recorded quantity when POS wrote one", () => {
    expect(servedQtyFor({ status: "partially_served", qtyOrdered: 3, qtyServed: 1 })).toBe(1);
  });

  it("infers the whole ticket when POS served it without counting", () => {
    expect(servedQtyFor({ status: "served", qty: 1 })).toBe(1);
    expect(servedQtyFor({ status: "served", qtyOrdered: 2, qtyServed: 0 })).toBe(2);
  });

  it("subtracts what was cancelled before the rest was served", () => {
    expect(servedQtyFor({ status: "served", qtyOrdered: 3, qtyCancelled: 1 })).toBe(2);
  });

  it("never infers a quantity for a ticket that was not served", () => {
    expect(servedQtyFor({ status: "preparing", qtyOrdered: 2 })).toBe(0);
    expect(servedQtyFor({ status: "cancelled", qtyOrdered: 2 })).toBe(0);
  });

  it("never goes negative", () => {
    expect(servedQtyFor({ status: "served", qtyOrdered: 1, qtyCancelled: 5 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/ianla/webapps/CUSTOMER && npx vitest run src/lib/__tests__/session-orders.test.ts`
Expected: FAIL — the module has no export named `customerStatus` (vitest reports it as an import/SyntaxError, not an assertion failure).

- [ ] **Step 3: Write the implementation**

Append to `src/lib/session-orders.ts`:

```ts
/**
 * A kitchen ticket as it arrives from Firestore.
 *
 * Deliberately `unknown` on every field: POS writes these documents from a
 * separately-deployed app, and several of them are optional in practice — the
 * package ticket `startSession` writes carries `qty` and nothing else.
 */
export type RawKitchenTicket = {
  status?: unknown;
  qty?: unknown;
  qtyOrdered?: unknown;
  qtyServed?: unknown;
  qtyCancelled?: unknown;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** What the diner ordered. `qtyOrdered` where POS wrote it, `qty` otherwise. */
export function orderedQtyFor(t: RawKitchenTicket): number {
  return Math.max(0, num(t.qtyOrdered ?? t.qty));
}

/**
 * The lifecycle a diner is shown, collapsed from POS's ticket statuses.
 *
 * POS's `status` is the ONLY thing consulted, and that is the whole point of
 * this function. It used to re-label a `served` ticket as cancelled whenever
 * `qtyServed` was not positive — but `qtyServed` is bookkeeping, not an
 * outcome, and several POS writers legitimately never set it: the package
 * ticket is created without it, both payment sweeps close tickets without it,
 * and any KDS client older than 2026-08-21 served without it. The result was
 * telling a diner their food had been cancelled while they were eating it.
 *
 * A cancelled ticket has its own status. POS never leaves a fully-cancelled
 * ticket in `served`: `handleCancelRemaining` sets `served` only when some
 * quantity actually went out, and `cancelled` otherwise.
 */
export function customerStatus(t: RawKitchenTicket): SessionOrder["status"] {
  const s = String(t.status ?? "").toLowerCase();
  if (s === "cancelled") return "cancelled";
  if (s === "partially_served") return "partially_served";
  if (s === "served") return "served";
  // Covers "preparing", POS's "ready", and anything a future POS adds: an
  // unrecognised state is still in the kitchen, never a cancellation.
  return "preparing";
}

/**
 * How much of the ticket actually reached the table.
 *
 * Trust `qtyServed` when POS recorded one. When POS says the ticket is served
 * but never counted it, the whole un-cancelled quantity went out — that is
 * what "served" means on a whole-ticket serve. Any other status infers
 * nothing.
 */
export function servedQtyFor(t: RawKitchenTicket): number {
  const recorded = Math.max(0, num(t.qtyServed));
  if (recorded > 0) return recorded;
  if (customerStatus(t) !== "served") return 0;
  return Math.max(0, orderedQtyFor(t) - Math.max(0, num(t.qtyCancelled)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/ianla/webapps/CUSTOMER && npx vitest run src/lib/__tests__/session-orders.test.ts`
Expected: PASS, including the pre-existing `hasPendingFirstServing` / `inFlightQty` cases.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/ianla/webapps/CUSTOMER
git add src/lib/session-orders.ts src/lib/__tests__/session-orders.test.ts
git commit -m "Read POS's ticket status as the truth, not qtyServed

A served ticket whose qtyServed was missing or zero was re-labelled
cancelled. qtyServed is bookkeeping several POS writers legitimately
never set, so diners were told food had been cancelled while they were
eating it."
```

---

### Task 2: CUSTOMER — route reads the library, and stops mis-labelling billed lines

**Files:**
- Modify: `C:\Users\ianla\webapps\CUSTOMER\src\app\api\customer\session-orders\route.ts` (delete lines 37-44; rewrite lines 94-133)

**Interfaces:**
- Consumes: `customerStatus`, `orderedQtyFor`, `servedQtyFor`, `RawKitchenTicket` from `@/lib/session-orders` (Task 1).
- Produces: no change to the JSON response *shape* — `orders[].status`, `qty`, `qtyServed`, `lineTotal`, `billed` keep their names and types. Only their values become correct.

- [ ] **Step 1: Add the import**

At the top of the file, beside the existing `computeRunningBill` import:

```ts
import { customerStatus, orderedQtyFor, servedQtyFor } from "@/lib/session-orders";
```

- [ ] **Step 2: Delete the route's private mapper**

Delete lines 37-44 in full — the `/** The lifecycle a diner is shown... */` comment and the `function customerStatus(raw, qtyServed, qtyCancelled)` it documents. Its `qtyCancelled` parameter was never read; the library version replaces it.

- [ ] **Step 3: Rewrite the per-ticket mapping**

Replace lines 94-96:

```ts
      const qtyOrdered = Number(t.qtyOrdered ?? t.qty ?? 0) || 0;
      const qtyServed = Number(t.qtyServed ?? 0) || 0;
      const qtyCancelled = Number(t.qtyCancelled ?? 0) || 0;
```

with:

```ts
      const status = customerStatus(t as RawKitchenTicket);
      const qtyOrdered = orderedQtyFor(t as RawKitchenTicket);
      const qtyServed = servedQtyFor(t as RawKitchenTicket);
```

and add `RawKitchenTicket` to the import from Step 1 as a type import:

```ts
import { customerStatus, orderedQtyFor, servedQtyFor, type RawKitchenTicket } from "@/lib/session-orders";
```

Replace line 107:

```ts
        status: customerStatus(t.status, qtyServed, qtyCancelled),
```

with:

```ts
        status,
```

Replace line 132 and its doc comment:

```ts
        /** True once the amount above is on the bill rather than an expectation. */
        billed: qtyServed > 0,
```

with:

```ts
        /**
         * True once the amount above is on the bill rather than an expectation.
         *
         * A ticket POS marked served IS billed — that is when POS creates or
         * increments the line (see `customer-order-billing.ts`). Keying this
         * off `qtyServed` alone left an already-charged line captioned
         * "when served" whenever POS served it without counting.
         */
        billed: status === "served" || qtyServed > 0,
```

Leave `lineTotal` (lines 128-131) exactly as written: `qtyServed` now resolves to the full quantity for an uncounted whole-ticket serve, so `(qtyServed > 0 ? qtyServed : qtyOrdered)` already lands on the right number.

- [ ] **Step 4: Typecheck**

Run: `cd /c/Users/ianla/webapps/CUSTOMER && npm run typecheck`
Expected: clean. If it complains that `qtyCancelled` is unused, delete the leftover binding — nothing else in the map reads it.

- [ ] **Step 5: Verify against the running app**

Start the CUSTOMER dev server on its reserved port and drive it against a live session:

```bash
cd /c/Users/ianla/webapps/CUSTOMER && npm run dev   # port 9004
```

On the TEST store, issue a PIN for an active package session (POS → PINs → Reissue), join at `http://localhost:9004`, and confirm the package row reads **Served** after the KDS serves it and **Preparing** before. A session whose package ticket was served by an old client (any TEST session from before 2026-08-21) must now also read **Served**.

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/ianla/webapps/CUSTOMER
git add src/app/api/customer/session-orders/route.ts
git commit -m "Order log: label rows from POS's status, and stop calling billed lines an estimate"
```

---

### Task 3: POS — one helper for "closing this ticket as served", adopted by the KDS

Behaviour-identical refactor. It exists so Task 4 cannot re-derive the arithmetic slightly differently, which is exactly how the payment sweep drifted from the KDS in the first place.

**Files:**
- Create: `C:\Users\ianla\webapps\POS\src\lib\kitchen\served-qty.ts`
- Test: `C:\Users\ianla\webapps\POS\src\lib\kitchen\served-qty.test.ts`
- Modify: `C:\Users\ianla\webapps\POS\src\app\kitchen\page.tsx:528-560`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `type ServedQtyTicket = { qty?: number | null; qtyOrdered?: number | null; qtyCancelled?: number | null }`
  - `servedQtyFields(ticket: ServedQtyTicket): { qtyServed: number; qtyRemaining: number }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/kitchen/served-qty.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { servedQtyFields } from "./served-qty";

describe("servedQtyFields", () => {
  it("serves the whole ticket", () => {
    expect(servedQtyFields({ qtyOrdered: 3 })).toEqual({ qtyServed: 3, qtyRemaining: 0 });
  });

  it("falls back to qty for the package ticket, which has no qtyOrdered", () => {
    expect(servedQtyFields({ qty: 1 })).toEqual({ qtyServed: 1, qtyRemaining: 0 });
  });

  it("defaults to one when the ticket carries no quantity at all", () => {
    expect(servedQtyFields({})).toEqual({ qtyServed: 1, qtyRemaining: 0 });
  });

  it("does not re-serve quantity the kitchen already cancelled", () => {
    expect(servedQtyFields({ qtyOrdered: 3, qtyCancelled: 1 })).toEqual({ qtyServed: 2, qtyRemaining: 0 });
  });

  it("never goes negative", () => {
    expect(servedQtyFields({ qtyOrdered: 1, qtyCancelled: 4 })).toEqual({ qtyServed: 0, qtyRemaining: 0 });
  });

  it("treats an explicit zero as zero, not as missing", () => {
    expect(servedQtyFields({ qtyOrdered: 0 })).toEqual({ qtyServed: 0, qtyRemaining: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/ianla/webapps/POS && npx vitest run src/lib/kitchen/served-qty.test.ts`
Expected: FAIL — cannot resolve `./served-qty`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kitchen/served-qty.ts`:

```ts
/**
 * The quantity bookkeeping that closing a kitchen ticket as SERVED implies.
 *
 * Three places close a whole ticket: the KDS "Served" button
 * (`updateTicketStatus`), `completeSessionPayment`, and `settleOffline`. For a
 * long time only the first wrote these fields, and the gap was expensive:
 *
 *  - `computeKdsTargets` reads `qtyServed ?? fallback` — nullish, not falsy —
 *    so a ticket left with an explicit `qtyServed: 0` logs ZERO serves to KDS
 *    analytics (pinned in `src/lib/analytics/kdsTargets.test.ts`).
 *  - The CUSTOMER app's order log used to read a served ticket with no
 *    `qtyServed` as CANCELLED, and told diners their food had been cancelled.
 *
 * `qtyOrdered ?? qty ?? 1` mirrors what every other quantity reader in POS
 * does, so a package ticket — created by `startSession` with `qty: 1` and no
 * `qtyOrdered` — resolves to 1 here exactly as it does on the KDS card.
 */
export type ServedQtyTicket = {
  qty?: number | null;
  qtyOrdered?: number | null;
  qtyCancelled?: number | null;
};

export function servedQtyFields(ticket: ServedQtyTicket): { qtyServed: number; qtyRemaining: number } {
  const ordered = Number(ticket.qtyOrdered ?? ticket.qty ?? 1) || 0;
  const cancelled = Number(ticket.qtyCancelled ?? 0) || 0;
  return { qtyServed: Math.max(0, ordered - cancelled), qtyRemaining: 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/ianla/webapps/POS && npx vitest run src/lib/kitchen/served-qty.test.ts`
Expected: PASS.

- [ ] **Step 5: Adopt it in the KDS serve path**

In `src/app/kitchen/page.tsx`, add to the imports:

```ts
import { servedQtyFields } from '@/lib/kitchen/served-qty';
```

At line 558-560, replace:

```ts
                const qtyNowServed = Math.max(0, ticketQtyOrdered - alreadyCancelled);
                updatePayload.qtyServed = qtyNowServed;
                updatePayload.qtyRemaining = 0;
```

with:

```ts
                const { qtyServed: qtyNowServed, qtyRemaining } = servedQtyFields(oldTicketState);
                updatePayload.qtyServed = qtyNowServed;
                updatePayload.qtyRemaining = qtyRemaining;
```

Leave `ticketQtyOrdered` and `alreadyServed` (lines 528-529) in place — the cancel branch at line 607 and the `qtyToBill` calculation both still read them. Delete `alreadyCancelled` (line 530) only if the typechecker reports it unused; line 607 does not use it, but confirm before deleting.

- [ ] **Step 6: Run the full POS suite and typecheck**

Run: `cd /c/Users/ianla/webapps/POS && npm test && npx tsc --noEmit`
Expected: PASS, clean. `src/lib/analytics/kdsTargets.test.ts` must stay green — it is the existing guard on this exact trap.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/ianla/webapps/POS
git add src/lib/kitchen/served-qty.ts src/lib/kitchen/served-qty.test.ts src/app/kitchen/page.tsx
git commit -m "Extract the served-quantity bookkeeping the KDS writes

One helper, so the payment paths in the next commit cannot derive it
slightly differently."
```

---

### Task 4: POS — both payment sweeps write the same bookkeeping

**Files:**
- Modify: `C:\Users\ianla\webapps\POS\src\components\cashier\firestore.ts:525-545`
- Modify: `C:\Users\ianla\webapps\POS\src\components\cashier\offlinePayment.ts:118-125`

**Interfaces:**
- Consumes: `servedQtyFields` from `@/lib/kitchen/served-qty` (Task 3).
- Produces: nothing new. Both sweeps now write `qtyServed` and `qtyRemaining` alongside `status: "served"`.

- [ ] **Step 1: Fix `completeSessionPayment`**

In `src/components/cashier/firestore.ts`, add to the imports:

```ts
import { servedQtyFields } from '@/lib/kitchen/served-qty';
```

Inside the `for (const ticketDoc of activeTicketsSnap.docs)` loop that begins under the `// Mark remaining active tickets as served` comment (line 525), replace the `updatePayload` literal at lines 537-544:

```ts
      const updatePayload: any = {
          status: 'served',
          servedAt: serverTs,
          servedAtClientMs: now,
          servedByUid: actor.uid,
          durationMs: durationMs,
          updatedAt: serverTs,
      };
```

with:

```ts
      // Same quantity bookkeeping the KDS "Served" button writes. Without it
      // this sweep leaves `qtyServed` unset, which logs zero serves to KDS
      // analytics and used to read as "cancelled" in the customer app.
      const updatePayload: any = {
          status: 'served',
          servedAt: serverTs,
          servedAtClientMs: now,
          servedByUid: actor.uid,
          durationMs: durationMs,
          updatedAt: serverTs,
          ...servedQtyFields(oldTicketState),
      };
```

`oldTicketState` is already in scope on the line above.

- [ ] **Step 2: Fix `settleOffline`**

In `src/components/cashier/offlinePayment.ts`, add to the imports:

```ts
import { servedQtyFields } from "@/lib/kitchen/served-qty";
```

At lines 121-125, replace:

```ts
  activeTicketsSnap.docs.forEach((t) => {
    const st = t.data() as any;
    if (st.status === "served" || st.status === "cancelled") return;
    batch.update(t.ref, { status: "served", servedAt: serverTs, servedAtClientMs: now, servedByUid: actor.uid, updatedAt: serverTs });
  });
```

with:

```ts
  activeTicketsSnap.docs.forEach((t) => {
    const st = t.data() as any;
    if (st.status === "served" || st.status === "cancelled") return;
    // Same quantity bookkeeping the KDS "Served" button writes — see
    // `servedQtyFields`. KDS rollups are deferred on this path, so the fields
    // have to be right on the ticket for the later reconcile to read them.
    batch.update(t.ref, { status: "served", servedAt: serverTs, servedAtClientMs: now, servedByUid: actor.uid, updatedAt: serverTs, ...servedQtyFields(st) });
  });
```

- [ ] **Step 3: Run the full POS suite and typecheck**

Run: `cd /c/Users/ianla/webapps/POS && npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 4: Verify against a real session**

Start POS on its reserved port (`cd /c/Users/ianla/webapps/POS && npm run dev`, port 9003). On the TEST store: start a package session, add one add-on, serve **neither**, then take payment. Read the tickets back and confirm both now carry `qtyServed` equal to their ordered quantity and `qtyRemaining: 0`. The read-only probe used for the evidence table is reproducible — query `stores/TEST/sessions/{id}/kitchentickets` with the Admin SDK and print `status`, `qtyOrdered`, `qtyServed`, `qtyRemaining`.

Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/ianla/webapps/POS
git add src/components/cashier/firestore.ts src/components/cashier/offlinePayment.ts
git commit -m "Payment no longer marks tickets served without counting them

Both payment sweeps flipped leftover tickets to served and wrote no
quantity at all. At Banay-Banay that is every served ticket the branch
produces, so its KDS serve stats read zero."
```

---

### Task 5: Reload the stale KDS clients at Lipa and Davao

Not a code change, and it must happen anyway: those tablets will keep writing uncounted serves until their tab is reloaded, which keeps their kitchen analytics at zero. Task 1 already protects the diner-facing label, so this is no longer urgent — but it is still wrong data every service.

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Establish the baseline**

Re-run the production scan (read-only) and record the current per-store counts of served tickets with a missing or zero `qtyServed`, classified by writer as in the Evidence table. Expect Lipa and Davao to be dominated by `kds-plain`.

- [ ] **Step 2: Reload each KDS tablet**

Ask the branch to hard-reload the Kitchen Display tab at **Lipa** and **Davao** (Ctrl+Shift+R, or close and reopen the tab). Malvar needs nothing — it is already on the current bundle, which is the control that proves a reload is the whole fix.

- [ ] **Step 3: Confirm**

After the next service, re-run the scan. New `kds-plain` serves at Lipa and Davao must show `qtyServed > 0`. If any still do not, the tablet did not actually reload (a pinned tab restored from session state keeps its old chunks) — reopen it from a fresh tab and re-check before concluding anything about the code.

- [ ] **Step 4: Record the outcome**

No commit. Report the before/after counts.

---

## Out of scope — found while investigating, deliberately not bundled

1. **Both payment sweeps ignore `partially_served`.** `completeSessionPayment` and `settleOffline` query `where("status", "in", ["preparing", "ready"])`, so a ticket that was partly served is never closed at payment: it stays `partially_served` forever and lingers in the `rtKdsTickets` projection. Widening the query is *not* a safe drive-by — a `partially_served` bill-on-serve ticket (`billOnServe: true`) would be flipped to served without the sweep creating or incrementing its bill line, so the diner would silently not be charged for the remainder. Fixing it properly means teaching the sweep the billing contract in `customer-order-billing.ts`. Worth its own plan.

2. **Backfilling historical tickets.** Task 1 makes the customer app read old tickets correctly with no migration, so a backfill buys only analytics accuracy — recomputing `qtyServed` for the ~4 months of tickets that never got one would let KDS serve stats reflect reality. It is not free: those tickets already carry applied `analyticsServedQty` / `analyticsKdsAppliedAt` markers, and changing `qtyServed` without reconciling the markers risks double-counting on any later delta (see `applyKdsTicketDelta` and `/api/analytics/kds-delta`). Decide whether the history is worth it; if yes, it needs its own plan with the marker reconciliation designed in.

3. **A stale-client guard for the KDS.** The root reason a shipped fix never reached Lipa and Davao is that the Kitchen Display is a long-lived SPA tab that never reloads, so App Hosting can serve new HTML for days while the tablet keeps its old JS chunks. A version banner — a constant baked into the client compared against a value in `storeConfig/current`, showing "Kitchen display is out of date — tap to reload" — would close it. Every future KDS fix has the same delivery problem, so this is worth doing; it is separate because it is a feature, not this bug.

---

## Self-Review

**Spec coverage.** The rendering rule at `route.ts:41` → Tasks 1-2. Producer (1), stale KDS clients → Task 5 (and neutralised for diners by Task 1). Producer (2), the payment sweeps → Tasks 3-4. The package ticket's missing bookkeeping → covered by `orderedQtyFor`/`servedQtyFields` falling back to `qty`; deliberately *not* fixed at the `startSession` write, because doing so would only help future tickets while Task 1 fixes past and future alike. KDS-analytics understatement → Tasks 4 and 5 stop new cases; historical cases are listed as out-of-scope item 2 with the reason. `hasPendingFirstServing` needs no change: it reads `status`, which Task 1 makes correct.

**Placeholders.** None — every step carries the literal code or command to run.

**Type consistency.** `RawKitchenTicket`, `orderedQtyFor`, `customerStatus`, `servedQtyFor` are defined in Task 1 and used under those exact names in Task 2. `ServedQtyTicket` and `servedQtyFields` are defined in Task 3 and used under those exact names in Tasks 3 and 4. `servedQtyFields` returns `{ qtyServed, qtyRemaining }`, spread into the update payloads in Task 4 and destructured in Task 3 Step 5. `customerStatus` returns `SessionOrder["status"]`, the union already declared at the top of `session-orders.ts`.
