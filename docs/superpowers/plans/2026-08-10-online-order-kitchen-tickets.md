# Online Order Kitchen Tickets + KDS History Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accepting an online order creates one kitchen ticket per line item (routed to that item's kitchen station) and shows it on the same `/kitchen` KDS queue dine-in tickets already use, tagged as online. Bundled: make the KDS's history sidebar collapsible to reclaim screen space.

**Architecture:** Ticket writes reuse the existing `kitchentickets` collection *name* but nest under `onlineOrders/{orderId}` instead of `sessions/{sessionId}` — every existing `collectionGroup('kitchentickets')` consumer (indexes, the KDS repair tool) already matches by collection name regardless of parent path, so nothing there needs to change. Ticket creation runs inside the same Admin-SDK transaction that flips an online order to `"accepted"`. On the KDS side, a new sibling function handles serve/cancel for online tickets (deliberately NOT reusing the existing session-shaped `updateTicketStatus`, which is full of dine-in-only side effects — session counters, bill-line voiding, analytics deltas — none of which apply to an online order).

**Tech Stack:** Next.js API routes (Admin SDK, `firebase-admin/firestore`), React client components (client SDK, `firebase/firestore`), Vitest.

## Global Constraints

- Ticket creation must never block accepting the order — a missing kitchen-location mapping (per item) or a lookup failure (for the whole order) still lets the order accept; it just creates fewer (or zero) tickets. (Spec §1, §6)
- Online tickets never enter the batch/partial-serve flow — a plain "Served"/"Cancel" only. This is achieved by deliberately never setting `qtyOrdered` on an online ticket, which is what makes `KdsItemCard` treat a ticket as a batch ticket. (Implementation-level scope decision — keeps this plan from having to touch `handleServeBatch`/`handleCancelRemaining` at all.)
- A late online ticket still gets the full red late-border — lateness overrides the online gradient treatment, never the other way around. (Spec §5, confirmed via mockup)
- History panel starts **collapsed** by default and remembers the choice per device via `localStorage`. (Spec §8)
- No changes to `SyncKdsTicketsTool` — its `collectionGroup('kitchentickets')` query is path-agnostic and already correct. (Spec §5, verified against the tool's actual query in `src/components/kitchen/SyncKdsTicketsTool.tsx:32-37`)

---

### Task 1: `buildOnlineOrderKitchenTicketWrites` — pure ticket-write builder

**Files:**
- Modify: `src/lib/types.ts:496-584` (`KitchenTicket` type)
- Create: `src/lib/kitchen/online-order-tickets.ts`
- Create: `src/lib/kitchen/online-order-tickets.test.ts`

**Interfaces:**
- Produces: `resolveInventoryLookupId(line: { productId: string; variantId?: string | null }): string` — the inventory-doc id a line resolves to.
- Produces: `type PlannedWrite = { path: string; data: Record<string, any>; merge?: boolean }`
- Produces: `buildOnlineOrderKitchenTicketWrites(params: BuildTicketsParams): { writes: PlannedWrite[]; ticketsCreated: number; itemsSkipped: number }` — consumed by Task 2.

**Step 1: Write the failing test**

Create `src/lib/kitchen/online-order-tickets.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    arrayUnion: (...values: any[]) => ({ __sentinel: "arrayUnion", values }),
  },
}));

import { resolveInventoryLookupId, buildOnlineOrderKitchenTicketWrites } from "./online-order-tickets";

describe("resolveInventoryLookupId", () => {
  it("uses variantId when present", () => {
    expect(resolveInventoryLookupId({ productId: "p1", variantId: "v1" })).toBe("v1");
  });
  it("falls back to productId when there is no variant", () => {
    expect(resolveInventoryLookupId({ productId: "p1" })).toBe("p1");
  });
});

describe("buildOnlineOrderKitchenTicketWrites", () => {
  const baseParams = {
    storeId: "store1",
    orderId: "ord_1",
    customerName: "Juan Dela Cruz",
    actorUid: "staff_1",
    nowMs: 1000,
  };

  it("creates one ticket write + one rtKdsTickets fan-out write per mapped line", () => {
    const result = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [
        { productId: "p1", name: "Unli Samgyup", qty: 1 },
        { productId: "p2", name: "Iced Tea", qty: 2 },
      ],
      locationByInvId: new Map([
        ["p1", { kitchenLocationId: "grill", kitchenLocationName: "Grill" }],
        ["p2", { kitchenLocationId: "drinks", kitchenLocationName: "Drinks" }],
      ]),
    });

    expect(result.ticketsCreated).toBe(2);
    expect(result.itemsSkipped).toBe(0);
    // One ticket doc write + one rtKdsTickets fan-out write per line = 4 total.
    expect(result.writes).toHaveLength(4);

    const ticketWrites = result.writes.filter((w) => w.path.includes("/kitchentickets/"));
    expect(ticketWrites).toHaveLength(2);
    expect(ticketWrites[0].path).toBe("stores/store1/onlineOrders/ord_1/kitchentickets/ord_1_0");
    expect(ticketWrites[0].data).toMatchObject({
      id: "ord_1_0",
      onlineOrderId: "ord_1",
      storeId: "store1",
      itemId: "p1",
      itemName: "Unli Samgyup",
      qty: 1,
      status: "preparing",
      kitchenLocationId: "grill",
      kitchenLocationName: "Grill",
      customerName: "Juan Dela Cruz",
      createdByUid: "staff_1",
      createdAtClientMs: 1000,
    });
    // Deliberately never set — this is what keeps online tickets out of the
    // batch-serve UI path in KdsItemCard.
    expect(ticketWrites[0].data.qtyOrdered).toBeUndefined();

    const fanoutWrites = result.writes.filter((w) => w.path.startsWith("stores/store1/rtKdsTickets/"));
    expect(fanoutWrites).toHaveLength(2);
    expect(fanoutWrites[0].path).toBe("stores/store1/rtKdsTickets/grill");
    expect(fanoutWrites[0].merge).toBe(true);
    expect(fanoutWrites[0].data["tickets.ord_1_0"]).toMatchObject({ itemName: "Unli Samgyup" });
    expect(fanoutWrites[0].data.activeIds).toEqual({ __sentinel: "arrayUnion", values: ["ord_1_0"] });
    expect(fanoutWrites[0].data["sessionIndex.ord_1"]).toEqual({ __sentinel: "arrayUnion", values: ["ord_1_0"] });
  });

  it("uses variantId over productId to resolve the kitchen location", () => {
    const result = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "family1", variantId: "spicy_variant", name: "Kimbap (Spicy)", qty: 1 }],
      locationByInvId: new Map([["spicy_variant", { kitchenLocationId: "grill" }]]),
    });
    expect(result.ticketsCreated).toBe(1);
    expect(result.writes[0].data.itemId).toBe("spicy_variant");
  });

  it("skips a line with no kitchen-location mapping, without failing the others", () => {
    const result = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [
        { productId: "p1", name: "Mapped Item", qty: 1 },
        { productId: "p2", name: "Unmapped Item", qty: 1 },
      ],
      locationByInvId: new Map([["p1", { kitchenLocationId: "grill" }]]),
    });
    expect(result.ticketsCreated).toBe(1);
    expect(result.itemsSkipped).toBe(1);
    expect(result.writes.filter((w) => w.path.includes("/kitchentickets/"))).toHaveLength(1);
  });

  it("returns no writes at all when nothing is mapped", () => {
    const result = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "p1", name: "Item", qty: 1 }],
      locationByInvId: new Map(),
    });
    expect(result.ticketsCreated).toBe(0);
    expect(result.itemsSkipped).toBe(1);
    expect(result.writes).toHaveLength(0);
  });

  it("joins modifier value names into modifiersText, and omits the field when there are none", () => {
    const withMods = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "p1", name: "Samgyupsal", qty: 1, modifiers: [{ valueName: "Extra Spicy" }, { valueName: "No Onions" }] }],
      locationByInvId: new Map([["p1", { kitchenLocationId: "grill" }]]),
    });
    expect(withMods.writes[0].data.modifiersText).toBe("Extra Spicy, No Onions");

    const withoutMods = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "p1", name: "Samgyupsal", qty: 1 }],
      locationByInvId: new Map([["p1", { kitchenLocationId: "grill" }]]),
    });
    expect(withoutMods.writes[0].data.modifiersText).toBeUndefined();
  });

  it("generates a deterministic ticket id per line index, so a transaction retry overwrites rather than duplicates", () => {
    const first = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "p1", name: "Item A", qty: 1 }, { productId: "p2", name: "Item B", qty: 1 }],
      locationByInvId: new Map([["p1", { kitchenLocationId: "grill" }], ["p2", { kitchenLocationId: "drinks" }]]),
    });
    const second = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "p1", name: "Item A", qty: 1 }, { productId: "p2", name: "Item B", qty: 1 }],
      locationByInvId: new Map([["p1", { kitchenLocationId: "grill" }], ["p2", { kitchenLocationId: "drinks" }]]),
    });
    const idsA = first.writes.filter((w) => w.path.includes("/kitchentickets/")).map((w) => w.data.id);
    const idsB = second.writes.filter((w) => w.path.includes("/kitchentickets/")).map((w) => w.data.id);
    expect(idsA).toEqual(idsB);
  });
});
```

- [ ] Write the test file exactly as above (delete the throwaway scaffold at the top — the real content is the second code block).

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/kitchen/online-order-tickets.test.ts`
Expected: FAIL — `Cannot find module './online-order-tickets'`

**Step 3: Extend the `KitchenTicket` type**

In `src/lib/types.ts`, replace lines 496-509 (the start of `KitchenTicket`, up through `kitchenLocationId`):

```ts
export type KitchenTicket = {
    id: string;
    // A ticket has exactly one of sessionId (dine-in) or onlineOrderId
    // (online order) set, never both. tableId/tableNumber/guestCount are
    // dine-in-only and stay unset for an online-order ticket.
    sessionId?: string;
    onlineOrderId?: string;
    storeId: string;
    tableId?: string;
    tableNumber?: string;
    type: OrderItemType;
    itemId?: string;
    itemName: string;
    guestCount?: number;
    status: OrderItemStatus;
    kitchenLocationId: string;
    kitchenLocationName?: string;
```

- [ ] Make that edit.

**Step 4: Write the minimal implementation**

Create `src/lib/kitchen/online-order-tickets.ts`:

```ts
import { FieldValue } from "firebase-admin/firestore";

export type PlannedWrite = { path: string; data: Record<string, any>; merge?: boolean };

type OrderLineModifier = { valueName?: string };

export type OnlineOrderLine = {
  productId: string;
  variantId?: string | null;
  name: string;
  qty: number;
  modifiers?: OrderLineModifier[];
};

export type KitchenLocationRef = { kitchenLocationId: string; kitchenLocationName?: string | null };

export type BuildTicketsParams = {
  storeId: string;
  orderId: string;
  lines: OnlineOrderLine[];
  customerName: string | null;
  actorUid: string;
  locationByInvId: Map<string, KitchenLocationRef>;
  nowMs: number;
};

/** The inventory-doc id a line resolves to: the variant's own id when this
 * line is a chosen variant of a family, else the line's own product id. */
export function resolveInventoryLookupId(line: { productId: string; variantId?: string | null }): string {
  return String(line.variantId || line.productId);
}

/**
 * Builds the Firestore writes for one accepted online order's kitchen
 * tickets, as plain data — no Firestore Transaction/Firestore instance
 * involved, so this is trivially unit-testable. The caller (the accept
 * transition in route.ts) applies each write via `tx.set(db.doc(path), data,
 * merge ? { merge: true } : undefined)`.
 *
 * A line with no kitchen-location mapping is skipped (counted, not failed) —
 * the order still accepts; that item just never reaches a KDS screen.
 *
 * Ticket ids are deterministic (`${orderId}_${lineIndex}`), not Firestore
 * auto-ids: a Firestore transaction that retries on contention calls this
 * function again, and a deterministic id means the retry overwrites the same
 * ticket rather than creating a duplicate.
 */
export function buildOnlineOrderKitchenTicketWrites(params: BuildTicketsParams): {
  writes: PlannedWrite[];
  ticketsCreated: number;
  itemsSkipped: number;
} {
  const { storeId, orderId, lines, customerName, actorUid, locationByInvId, nowMs } = params;
  const writes: PlannedWrite[] = [];
  let ticketsCreated = 0;
  let itemsSkipped = 0;

  lines.forEach((line, idx) => {
    const invId = resolveInventoryLookupId(line);
    const location = locationByInvId.get(invId);
    if (!location) {
      itemsSkipped += 1;
      return;
    }

    const ticketId = `${orderId}_${idx}`;
    const modifiersText = (line.modifiers || [])
      .map((m) => m.valueName)
      .filter((v): v is string => !!v)
      .join(", ");

    const ticketData: Record<string, any> = {
      id: ticketId,
      onlineOrderId: orderId,
      storeId,
      type: "addon",
      itemId: invId,
      itemName: line.name,
      qty: line.qty,
      status: "preparing",
      kitchenLocationId: location.kitchenLocationId,
      kitchenLocationName: location.kitchenLocationName ?? null,
      customerName: customerName ?? null,
      createdByUid: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      createdAtClientMs: nowMs,
    };
    if (modifiersText) ticketData.modifiersText = modifiersText;

    writes.push({ path: `stores/${storeId}/onlineOrders/${orderId}/kitchentickets/${ticketId}`, data: ticketData });
    writes.push({
      path: `stores/${storeId}/rtKdsTickets/${location.kitchenLocationId}`,
      data: {
        [`tickets.${ticketId}`]: ticketData,
        activeIds: FieldValue.arrayUnion(ticketId),
        [`sessionIndex.${orderId}`]: FieldValue.arrayUnion(ticketId),
        "meta.updatedAt": FieldValue.serverTimestamp(),
      },
      merge: true,
    });
    ticketsCreated += 1;
  });

  return { writes, ticketsCreated, itemsSkipped };
}
```

- [ ] Create the file exactly as above.

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/kitchen/online-order-tickets.test.ts`
Expected: PASS, all 7 tests.

**Step 6: Run the full type-check to confirm the `KitchenTicket` change didn't break an existing consumer**

Run: `npx tsc --noEmit`
Expected: no new errors. (Every existing dine-in write already sets `sessionId`/`tableId`/`tableNumber`/`guestCount`, so widening those to optional cannot break a writer; a reader that assumed they were always present would only break if it dereferences them without a guard — `KdsItemCard`'s `tableLabel` logic already guards with `??`/`||` fallbacks, so this is expected to be clean. If it isn't, fix the flagged call site before continuing — do not silence with `as any`.)

**Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/kitchen/online-order-tickets.ts src/lib/kitchen/online-order-tickets.test.ts
git commit -m "Add buildOnlineOrderKitchenTicketWrites and loosen KitchenTicket to allow online orders"
```

---

### Task 2: Wire ticket creation into the accept transition

**Files:**
- Modify: `src/app/api/admin/online-orders/route.ts`
- Modify: `src/app/api/admin/online-orders/route.test.ts`

**Interfaces:**
- Consumes: `buildOnlineOrderKitchenTicketWrites`, `resolveInventoryLookupId` from Task 1 (`src/lib/kitchen/online-order-tickets.ts`).
- Produces: the transition response gains `ticketsCreated: number` and `itemsSkipped: number` (always present, `0` when `toStatus !== "accepted"`) — consumed by Task 3.

**Step 1: Write the failing tests**

In `src/app/api/admin/online-orders/route.test.ts`, add a new `describe` block. First add a helper next to the existing `seed()`/`baseOrder()` helpers (around line 143):

```ts
function seedWithInventory(order: Record<string, any>, inventory: Record<string, any> = {}) {
  const docs: Record<string, any> = {
    [ORDER_PATH]: order,
    [`stores/${STORE}/receiptSettings/main`]: { receiptNoFormat: "SELIP-######" },
    [`stores/${STORE}/counters/receipts`]: { seq: 41 },
    [`stores/${STORE}`]: { name: "Lipa" },
  };
  for (const [invId, data] of Object.entries(inventory)) {
    docs[`stores/${STORE}/inventory/${invId}`] = data;
  }
  harness = makeHarness(docs);
}
```

Then the test block (append at the end of the file):

```ts
describe("transition: accepted creates kitchen tickets", () => {
  it("creates a ticket + rtKdsTickets fan-out for each mapped line, and reports the counts", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [
          { lineId: "l1", productId: "p1", name: "Unli Samgyup", category: "Mains", unitPrice: 500, qty: 1 },
          { lineId: "l2", productId: "p2", name: "Iced Tea", category: "Drinks", unitPrice: 40, qty: 2 },
        ],
      }),
      {
        p1: { kitchenLocationId: "grill", kitchenLocationName: "Grill" },
        p2: { kitchenLocationId: "drinks", kitchenLocationName: "Drinks" },
      }
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ticketsCreated).toBe(2);
    expect(json.itemsSkipped).toBe(0);

    const ticketSets = harness.sets.filter((s) => s.path.includes("/kitchentickets/"));
    expect(ticketSets).toHaveLength(2);
    expect(ticketSets.map((s) => s.path).sort()).toEqual([
      `stores/${STORE}/onlineOrders/${ORDER}/kitchentickets/${ORDER}_0`,
      `stores/${STORE}/onlineOrders/${ORDER}/kitchentickets/${ORDER}_1`,
    ]);

    const fanoutSets = harness.sets.filter((s) => s.path.startsWith(`stores/${STORE}/rtKdsTickets/`));
    expect(fanoutSets.map((s) => s.path).sort()).toEqual([
      `stores/${STORE}/rtKdsTickets/drinks`,
      `stores/${STORE}/rtKdsTickets/grill`,
    ]);
  });

  it("still accepts the order and reports itemsSkipped when a line has no kitchen-location mapping", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [{ lineId: "l1", productId: "p1", name: "Unmapped Item", category: "Mains", unitPrice: 500, qty: 1 }],
      }),
      { p1: {} } // exists, but no kitchenLocationId
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(orderUpdate().status).toBe("accepted");
    expect(json.ticketsCreated).toBe(0);
    expect(json.itemsSkipped).toBe(1);
    expect(harness.sets.filter((s) => s.path.includes("/kitchentickets/"))).toHaveLength(0);
  });

  it("still accepts the order when the inventory doc doesn't exist at all", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [{ lineId: "l1", productId: "does-not-exist", name: "Ghost Item", category: "Mains", unitPrice: 500, qty: 1 }],
      })
      // no inventory docs seeded at all
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(orderUpdate().status).toBe("accepted");
    expect(json.ticketsCreated).toBe(0);
    expect(json.itemsSkipped).toBe(1);
  });

  it("resolves the kitchen location via variantId, not productId, for a variant line", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [{ lineId: "l1", productId: "family1", variantId: "spicy_v1", name: "Kimbap (Spicy)", category: "Mains", unitPrice: 200, qty: 1 }],
      }),
      { spicy_v1: { kitchenLocationId: "grill" } }
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(json.ticketsCreated).toBe(1);
    const ticketSet = harness.sets.find((s) => s.path.includes("/kitchentickets/"));
    expect(ticketSet!.data.itemId).toBe("spicy_v1");
  });

  it("does not create tickets for a transition other than accepted", async () => {
    seedWithInventory(
      baseOrder({ status: "accepted", lines: [{ lineId: "l1", productId: "p1", name: "Item", category: "Mains", unitPrice: 500, qty: 1 }] }),
      { p1: { kitchenLocationId: "grill" } }
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "preparing" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ticketsCreated).toBe(0);
    expect(json.itemsSkipped).toBe(0);
    expect(harness.sets.filter((s) => s.path.includes("/kitchentickets/"))).toHaveLength(0);
  });
});
```

- [ ] Add `seedWithInventory` and the test block exactly as above.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/admin/online-orders/route.test.ts -t "creates kitchen tickets"`
Expected: FAIL — `json.ticketsCreated` is `undefined`, not `2` (the route doesn't create tickets yet).

**Step 3: Write the minimal implementation**

In `src/app/api/admin/online-orders/route.ts`:

1. Add the import (near the other local imports, after line 12):

```ts
import { buildOnlineOrderKitchenTicketWrites, resolveInventoryLookupId } from "@/lib/kitchen/online-order-tickets";
```

2. Inside the transition's `db.runTransaction(async (tx) => {...})` callback, right after the fulfillment guards (after line 241, before the existing `let receiptRead...` completing-reads block at line 243) add the inventory reads:

```ts
      // --- more reads: resolve each line's kitchen location, only when accepting ---
      const accepting = toStatus === "accepted";
      const orderLines: any[] = Array.isArray(order.lines) ? order.lines : [];
      const locationByInvId = new Map<string, { kitchenLocationId: string; kitchenLocationName?: string | null }>();
      if (accepting) {
        const invIds = Array.from(new Set(orderLines.map((ln) => resolveInventoryLookupId(ln)).filter(Boolean)));
        const invSnaps = await Promise.all(invIds.map((id) => tx.get(db.doc(`stores/${storeId}/inventory/${id}`))));
        invSnaps.forEach((snap, i) => {
          if (!snap.exists) return;
          const data: any = snap.data();
          if (data?.kitchenLocationId) {
            locationByInvId.set(invIds[i], {
              kitchenLocationId: String(data.kitchenLocationId),
              kitchenLocationName: data.kitchenLocationName ?? null,
            });
          }
        });
      }
```

3. Declare the outer-scope result variables alongside `didComplete`/`notifyCtx` (line 218-222):

```ts
    let didComplete = false;
    let ticketsCreated = 0;
    let itemsSkipped = 0;
    let notifyCtx: StatusNotifyContext | null = null;
```

4. In the writes section, right before `tx.update(orderRef, orderUpdate);` (line 419), add:

```ts
      if (accepting) {
        const built = buildOnlineOrderKitchenTicketWrites({
          storeId,
          orderId,
          lines: orderLines,
          customerName: order?.contact?.name ?? null,
          actorUid,
          locationByInvId,
          nowMs: Date.now(),
        });
        ticketsCreated = built.ticketsCreated;
        itemsSkipped = built.itemsSkipped;
        for (const w of built.writes) {
          tx.set(db.doc(w.path), w.data, w.merge ? { merge: true } : undefined);
        }
      }
```

5. Extend the final response (line 467):

```ts
    return NextResponse.json({ ok: true, status: toStatus, completed: didComplete, analyticsApplied, ticketsCreated, itemsSkipped });
```

- [ ] Make all five edits.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/admin/online-orders/route.test.ts`
Expected: PASS, including every pre-existing test in this file (this confirms the new reads/writes are additive and don't disturb the `completing`/payment paths).

**Step 5: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

**Step 6: Commit**

```bash
git add src/app/api/admin/online-orders/route.ts src/app/api/admin/online-orders/route.test.ts
git commit -m "Create kitchen tickets when an online order is accepted"
```

---

### Task 3: Surface ticket counts in the accept toast

**Files:**
- Modify: `src/components/admin/online-orders/OnlineOrdersClient.tsx:437-459`

**Interfaces:**
- Consumes: `ticketsCreated`/`itemsSkipped` from the transition API response (Task 2).

This is a one-line toast-copy change consuming values already proven correct by Task 2's tests, so there's no new failing test to write first — verification is the existing component test suite (Step 2) plus the manual check in Task 7.

**Step 1: Write the implementation**

In `src/components/admin/online-orders/OnlineOrdersClient.tsx`, replace the success toast inside `transition()` (line 451):

```ts
      const ticketNote =
        typeof json.ticketsCreated === "number" && (json.ticketsCreated > 0 || json.itemsSkipped > 0)
          ? ` — ${json.ticketsCreated} kitchen ticket${json.ticketsCreated === 1 ? "" : "s"} created` +
            (json.itemsSkipped > 0 ? `, ${json.itemsSkipped} item${json.itemsSkipped === 1 ? "" : "s"} skipped (no station configured)` : "")
          : "";
      toast({ title: `Order ${STATUS_LABEL[toStatus] || toStatus}${ticketNote}` });
```

- [ ] Make that edit.

**Step 2: Run the existing test suite for this component**

Run: `npx vitest run src/components/admin/online-orders/OnlineOrdersClient.test.ts`
Expected: PASS — this file doesn't assert on toast copy (confirm by reading it first; if it does, update the matching assertion to allow the optional suffix rather than an exact string).

**Step 3: Commit**

```bash
git add src/components/admin/online-orders/OnlineOrdersClient.tsx
git commit -m "Show kitchen-ticket counts in the accept-order toast"
```

---

### Task 4: KDS serve/cancel for online-order tickets

**Files:**
- Modify: `src/app/kitchen/page.tsx`
- Modify: `src/components/kitchen/kds-item-card.tsx`

**Interfaces:**
- Produces (page.tsx): `updateOnlineOrderTicketStatus(ticketId: string, onlineOrderId: string, newStatus: "served" | "cancelled", opts?: { overrideAtMs?: number; silent?: boolean }): Promise<boolean>`
- Modifies: `updateTicketStatus`'s signature gains a 5th param `opts?: { overrideAtMs?: number; silent?: boolean; source?: "online" }` and dispatches to `updateOnlineOrderTicketStatus` when `opts?.source === "online"`.
- Modifies: `KdsItemCardProps.onUpdateStatus` gains the same optional 5th param.

This path touches `runTransaction` against the real client SDK — the existing `updateTicketStatus` it mirrors has no unit test either (no Firestore-emulator harness exists for this file), so verification here follows that same precedent: manual, against a real dev store, in Step 2 below. The manual check is written out now so it's not improvised later:

1. Seed one online order with an accepted status and one kitchen ticket (via Task 2's flow, or directly in Firestore) with `onlineOrderId` set and `status: "preparing"`.
2. Open `/kitchen`, find the ticket's station tab, confirm the card renders (visual treatment lands in Task 5 — for this task, confirm the plain card renders and the "Served" button is present, not the batch-serve button).
3. Click "Served". Confirm: the ticket's `status` becomes `"served"` in Firestore, it disappears from `rtKdsTickets/{station}.activeIds`, and a doc appears under `rtKdsTickets/{station}/closedKdsTickets/{ticketId}`.
4. Repeat for "Cancel" on a fresh ticket.

**Step 1: Write the implementation**

1. In `src/app/kitchen/page.tsx`, add the icon imports needed later in Task 6 now too (single edit to this import line, line 18):

```ts
import { Loader, Send, History, X } from "lucide-react";
```

2. Change `updateTicketStatus`'s signature (line 476-482) to accept and dispatch on `source`:

```ts
  const updateTicketStatus = async (
    ticketId: string,
    sessionId: string,
    newStatus: "served" | "cancelled",
    reason?: string,
    opts?: { overrideAtMs?: number; silent?: boolean; source?: "online" },
  ) => {
    if (opts?.source === "online") {
      return updateOnlineOrderTicketStatus(ticketId, sessionId, newStatus, opts);
    }
```

(The rest of the existing function body is unchanged — this is a single new `if` block inserted at the top.)

3. Add the new sibling function directly after `updateTicketStatus`'s closing brace (after line 631, before the "Auto-acknowledge tickets printed to the offline backup kitchen printer" comment on line 633):

```ts
  // Serve/cancel for an online-order ticket. Deliberately NOT a branch inside
  // updateTicketStatus above: that function's dine-in path also increments
  // session serve counters, voids sessionBillLines, and pushes KDS analytics
  // deltas — none of which have an online-order equivalent (online-order
  // analytics already flow through the receipt/completion path in
  // route.ts, unrelated to kitchen-ticket serve timing). This function does
  // only what actually applies: flip the ticket, remove it from the active
  // rtKdsTickets projection, archive it into closedKdsTickets.
  const updateOnlineOrderTicketStatus = async (
    ticketId: string,
    onlineOrderId: string,
    newStatus: "served" | "cancelled",
    opts?: { overrideAtMs?: number; silent?: boolean },
  ): Promise<boolean> => {
    if (!appUser || !activeStore) {
      toast({ variant: "destructive", title: "Action Failed", description: "Authentication or store context is missing." });
      return false;
    }
    const nowMs = opts?.overrideAtMs ?? Date.now();

    try {
      await runTransaction(db, async (transaction: Transaction) => {
        const ticketRef = doc(db, "stores", activeStore.id, "onlineOrders", onlineOrderId, "kitchentickets", ticketId);
        const ticketSnap = await transaction.get(ticketRef);
        if (!ticketSnap.exists()) throw new Error("Ticket not found.");

        const oldTicketState = ticketSnap.data() as KitchenTicket;
        if (oldTicketState.status === "served" || oldTicketState.status === "cancelled") {
          console.log(`Ticket ${ticketId} is already finalized. Skipping update.`);
          return;
        }

        const updatePayload: any = { status: newStatus, updatedAt: serverTimestamp() };
        if (newStatus === "served") {
          const startMs = getStartMs(oldTicketState.createdAtClientMs ?? oldTicketState.createdAt);
          updatePayload.servedAt = serverTimestamp();
          updatePayload.servedAtClientMs = nowMs;
          updatePayload.servedByUid = appUser.uid;
          updatePayload.durationMs = startMs ? Math.max(0, nowMs - startMs) : 0;
        } else {
          updatePayload.cancelledAt = serverTimestamp();
          updatePayload.cancelledAtClientMs = nowMs;
          updatePayload.cancelledByUid = appUser.uid;
        }
        transaction.update(ticketRef, updatePayload);

        const { kitchenLocationId } = oldTicketState;
        if (kitchenLocationId) {
          const rtKdsDocRef = doc(db, "stores", activeStore.id, "rtKdsTickets", kitchenLocationId);
          transaction.update(rtKdsDocRef, {
            [`tickets.${ticketId}`]: deleteField(),
            activeIds: arrayRemove(ticketId),
            [`sessionIndex.${onlineOrderId}`]: arrayRemove(ticketId),
            "meta.updatedAt": serverTimestamp(),
          });
          const closedTicketRef = doc(db, "stores", activeStore.id, "rtKdsTickets", kitchenLocationId, "closedKdsTickets", ticketId);
          transaction.set(closedTicketRef, { ...oldTicketState, ...updatePayload, closedAtClientMs: nowMs });
        }
      });

      if (!opts?.silent) {
        const ticket = ticketsWithData.find((t) => t.id === ticketId);
        showFlash(
          newStatus === "cancelled" ? "cancelled" : "served",
          `${ticket?.itemName || "Item"} ${newStatus}`,
          ticket?.customerName ? `Online · ${ticket.customerName}` : "Online order",
        );
      }
      return true;
    } catch (error: any) {
      console.error(`Failed to update online ticket status to ${newStatus}:`, error);
      if (!opts?.silent) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update the ticket status." });
      }
      return false;
    }
  };
```

4. In `src/components/kitchen/kds-item-card.tsx`, widen the prop type (line 74):

```ts
interface KdsItemCardProps {
    ticket: KitchenTicket;
    onUpdateStatus: (
      ticketId: string,
      sessionId: string,
      newStatus: "served" | "cancelled",
      reason?: string,
      opts?: { source?: "online" },
    ) => void;
    onServeBatch?: (payload: ServeBatchPayload) => void;
    onCancelRemaining?: (payload: CancelRemainingPayload) => void;
    slaMinutes?: number;
}
```

5. Add an `isOnline` flag near the other derived booleans (after line 104, `const isPackage = ticket.type === 'package';`):

```ts
    const isOnline = !!ticket.onlineOrderId;
```

6. Update the two `onUpdateStatus` call sites to pass the online source hint. In `handleCancel` (line 122):

```ts
        if (confirmed) onUpdateStatus(ticket.id, ticket.sessionId || ticket.onlineOrderId!, "cancelled", reason, isOnline ? { source: "online" } : undefined);
```

And the plain "Served" button (line 286):

```tsx
                                    <Button className="h-11 px-4 text-base" onClick={() => onUpdateStatus(ticket.id, ticket.sessionId || ticket.onlineOrderId!, 'served', undefined, isOnline ? { source: "online" } : undefined)}>
```

- [ ] Make all six edits.

**Step 2: Manual verification**

Run through the four steps written above (before Step 1) against a real dev store. Confirm both serve and cancel work, and that a SECOND click on an already-served/cancelled ticket is a no-op (matches the existing dine-in guard, reused verbatim).

**Step 3: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. (`KdsItemCard`'s own tests, if any, should still pass since `onUpdateStatus`'s new param is optional and every existing call site — dine-in — omits it, which is `undefined`, matching today's behavior exactly.)

**Step 4: Commit**

```bash
git add src/app/kitchen/page.tsx src/components/kitchen/kds-item-card.tsx
git commit -m "Add serve/cancel handling for online-order kitchen tickets"
```

---

### Task 5: Online-order visual treatment on the KDS card

**Files:**
- Modify: `src/components/kitchen/kds-item-card.tsx`

**Interfaces:**
- Consumes: `isOnline` from Task 4.

**Step 1: Manual test plan**

Since this is a pure rendering change with no existing snapshot-test infra for this component (confirmed: no `kds-item-card.test.tsx` exists), verification is visual: seed one dine-in ticket and one online ticket (from Task 4's manual setup) side by side on the same station tab and compare against the approved mockup.

**Step 2: Write the implementation**

1. Update `tableLabel` (line 105-107) to give online tickets their own identifier:

```ts
    const tableLabel = isOnline
        ? (ticket.customerName || "Online Order")
        : isAlaCarte
        ? (ticket.sessionLabel ?? (ticket.customerName || "Ala Carte"))
        : ((ticket as any).tableDisplayName || ticket.sessionLabel || `Table ${ticket.tableNumber}`);
```

2. Update `statusColor` (line 153-159) to add the gradient as a fallback below served/cancelled/late:

```ts
    const statusColor = ticket.status === 'served'
        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
        : ticket.status === 'cancelled'
        ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-200'
        : isLate
        ? 'border-destructive border-2 bg-destructive/5'
        : isOnline
        ? 'bg-gradient-to-br from-green-50 to-white dark:from-green-950/40 dark:to-background border-green-300 dark:border-green-800'
        : '';
```

3. Update the identifier text color and add the "Online" badge in the header (lines 164-175):

```tsx
                <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-center gap-2">
                        <p className={cn("text-2xl font-bold truncate", isOnline ? "text-green-700 dark:text-green-400" : "text-destructive")}>{identifier}</p>
                        <div className="flex items-center gap-2 shrink-0">
                            {isLate && (
                                <Badge variant="destructive" className="gap-1 animate-pulse">
                                    <AlarmClock className="h-3.5 w-3.5" /> Late
                                </Badge>
                            )}
                            <TimeLapse elapsedMs={elapsedMs} isLate={isLate} />
                        </div>
                    </div>
                    {isOnline && (
                        <Badge className="mt-1.5 w-fit gap-1 bg-green-600 text-white hover:bg-green-600">
                            ● Online
                        </Badge>
                    )}
                    <CardTitle className="text-xl leading-tight">{ticket.itemName}</CardTitle>
```

- [ ] Make all three edits.

**Step 3: Manual verification**

Confirm against a real dev store: dine-in cards look unchanged; an online ticket shows the green gradient, green identifier (customer name), and "● Online" badge; a LATE online ticket shows the full red late-border (not the gradient) — confirms the priority order in `statusColor` is correct.

**Step 4: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

**Step 5: Commit**

```bash
git add src/components/kitchen/kds-item-card.tsx
git commit -m "Add the online-order gradient card treatment to the KDS"
```

---

### Task 6: Collapsible KDS history panel

**Files:**
- Modify: `src/components/kitchen/history-view.tsx`
- Modify: `src/app/kitchen/page.tsx`

**Interfaces:**
- Modifies: `HistoryViewProps` gains `onCollapse?: () => void`.
- Produces (page.tsx): `historyCollapsed: boolean` state, persisted to `localStorage["kds_history_collapsed"]`.

**Step 1: Manual test plan**

No existing test file covers `HistoryView` or the page's layout, and this is a pure client-side layout/state change with no business logic to unit test. Verification is manual (Step 4).

**Step 2: Write the implementation**

1. In `src/components/kitchen/history-view.tsx`, add `ChevronRight` to the lucide-react import (line 8):

```ts
import { ArrowLeft, ArrowRight, Clock, Loader2, ChevronRight } from "lucide-react";
```

2. Extend the props and header (lines 13-23):

```tsx
interface HistoryViewProps {
    items: any[];
    isLoading: boolean;
    activeStationId: string;
    onCollapse?: () => void;
}

export function HistoryView({ items, isLoading, activeStationId, onCollapse }: HistoryViewProps) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                    <CardTitle>Order History</CardTitle>
                    <CardDescription>Recently completed or cancelled items.</CardDescription>
                </div>
                {onCollapse && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onCollapse} aria-label="Collapse history">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                )}
            </CardHeader>
```

3. In `src/app/kitchen/page.tsx`, add the collapsed-state hook. Place it near the other `useState` declarations at the top of the component (alongside `historyPreview`, line 229):

```ts
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("kds_history_collapsed");
    if (saved !== null) setHistoryCollapsed(saved === "true");
  }, []);
  const toggleHistoryCollapsed = () => {
    setHistoryCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("kds_history_collapsed", String(next));
      return next;
    });
  };
```

4. Replace the outer grid + `HistoryView` block (lines 874-929) with:

```tsx
        <div className={cn("grid grid-cols-1 gap-4 items-start", !historyCollapsed && "xl:grid-cols-4")}>
            <div className={!historyCollapsed ? "xl:col-span-3" : ""}>
                 <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    {isMobile ? (
                        <Select value={activeTab} onValueChange={setActiveTab}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a station..." />
                            </SelectTrigger>
                            <SelectContent>
                                {stations.map((station: KitchenStation) => {
                                    const count = stationCounts.get(station.id) || 0;
                                    const late = overSlaByStation.get(station.id) || 0;
                                    return (
                                        <SelectItem key={station.id} value={station.key}>
                                            {station.name} {count > 0 && `(${count})`}{late > 0 && ` · ${late} late`}
                                        </SelectItem>
                                    )
                                })}
                            </SelectContent>
                        </Select>
                    ) : (
                        <TabsList className="gap-2">
                            {stations.map((station: KitchenStation) => {
                                const count = stationCounts.get(station.id) || 0;
                                const late = overSlaByStation.get(station.id) || 0;
                                return (
                                    <TabsTrigger key={station.id} value={station.key} className="relative">
                                        {station.name}
                                        {count > 0 && (
                                            <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{count}</Badge>
                                        )}
                                        {late > 0 && (
                                            <Badge variant="outline" className="ml-2 border-destructive bg-destructive/10 text-destructive text-[10px] px-1.5 py-0 gap-0.5">
                                                {late} late
                                            </Badge>
                                        )}
                                    </TabsTrigger>
                                )
                            })}
                        </TabsList>
                    )}
                    {stations.map((station: KitchenStation) => (
                        <TabsContent key={station.id} value={station.key}>
                            <KdsView tickets={preparingItems} onUpdateStatus={updateTicketStatus} onServeBatch={handleServeBatch} onCancelRemaining={handleCancelRemaining} slaMinutes={activeStationSla} />
                        </TabsContent>
                    ))}
                 </Tabs>
            </div>
            {!historyCollapsed && (
                <div className="xl:col-span-1 space-y-4">
                    <HistoryView
                      items={historyPreview}
                      isLoading={isLoadingHistory}
                      activeStationId={activeTab}
                      onCollapse={toggleHistoryCollapsed}
                    />
                </div>
            )}
        </div>
        {historyCollapsed && (
            <Button
                onClick={toggleHistoryCollapsed}
                className="fixed bottom-6 right-6 z-40 h-14 px-5 gap-2 rounded-full text-base shadow-lg"
                size="lg"
            >
                <History className="h-5 w-5" /> History
            </Button>
        )}
```

(This is a straight structural replacement of the existing block — the `Tabs`/`TabsList`/`TabsContent` contents inside are unchanged from what's there today, only the wrapping `div` classNames and the `HistoryView`/floating-button logic around them change.)

5. Add the missing `Button` import (this file has no `Button` import today — confirm by checking the import block; add it alongside the other `@/components/ui/*` imports, e.g. after line 22's `Select` import):

```ts
import { Button } from "@/components/ui/button";
```

- [ ] Make all five edits (steps 1-2 in `history-view.tsx`; steps 3-5 in `page.tsx`).

**Step 3: Run the type-check**

Run: `npx tsc --noEmit`
Expected: no errors (this catches a missed import or a stray reference to the old unconditional `xl:col-span-3`/`xl:col-span-1` classes immediately).

**Step 4: Manual verification**

1. Load `/kitchen`. Confirm the history panel is collapsed by default (first load, no localStorage key yet) and the ticket grid uses the full width.
2. Click the floating "History" button (bottom-right). Confirm the panel expands, the ticket grid shrinks to 3 columns, and nothing overlaps.
3. Click the collapse chevron in the history panel's header. Confirm it collapses again and the grid regains the column.
4. Reload the page. Confirm the last state (expanded or collapsed) is remembered.
5. Resize below the `xl` breakpoint (or check on a narrow/mobile viewport) and confirm the layout still stacks sensibly (single column) regardless of collapsed state — the `xl:` prefix means this only matters at the `xl` breakpoint and up, matching today's existing mobile behavior.

**Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all green (no existing test touches this page's layout).

**Step 6: Commit**

```bash
git add src/components/kitchen/history-view.tsx src/app/kitchen/page.tsx
git commit -m "Make the KDS history panel collapsible, collapsed by default"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

**Step 1: Full regression run**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

**Step 2: Real end-to-end check against a dev store**

1. In `/admin/online-orders`, find or place a test online order with at least 2 items whose products have DIFFERENT `kitchenLocationId`s configured, and at least one item with NO kitchen location configured.
2. Click "Accept". Confirm the toast reports the right counts (e.g. "2 kitchen tickets created, 1 item skipped").
3. Open `/kitchen`. Confirm one ticket appears on each of the two correct station tabs, styled with the green gradient + "Online" badge + customer name, and that the unmapped item never appears on any station.
4. Serve one ticket, cancel the other. Confirm both leave the active queue and land in that station's history (collapse/expand the history panel to check).
5. Confirm `SyncKdsTicketsTool` ("Sync KDS" button near the page header) still runs cleanly and doesn't remove/duplicate the online tickets — this is the manual substitute for a dedicated regression test, since the tool's `collectionGroup('kitchentickets')` query is verified path-agnostic by reading its source (`SyncKdsTicketsTool.tsx:32-37`) rather than by a new test harness built to prove a Firestore platform guarantee.
6. Let one online ticket sit past its station's SLA window (or lower the SLA temporarily in Kitchen Locations settings). Confirm it flips to the full red late-border, not the green gradient.

**Step 3: Final commit (docs only, if anything needed updating)**

If any manual-check step above surfaced a required fix, it should already have its own commit from whichever task it belongs to — this step exists only to confirm there is nothing left uncommitted.

Run: `git status`
Expected: clean working tree on the feature branch.
