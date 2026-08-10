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
    expect(fanoutWrites[0].data.kitchenLocationId).toBe("grill");
    expect(fanoutWrites[0].data.tickets).toMatchObject({ ord_1_0: { itemName: "Unli Samgyup" } });
    expect(fanoutWrites[0].data.activeIds).toEqual({ __sentinel: "arrayUnion", values: ["ord_1_0"] });
    expect(fanoutWrites[0].data.sessionIndex).toEqual({ ord_1: { __sentinel: "arrayUnion", values: ["ord_1_0"] } });
    expect(fanoutWrites[0].data.meta).toEqual({ updatedAt: { __sentinel: "serverTimestamp" } });
  });

  it("never uses a dotted string as a top-level key in the rtKdsTickets fan-out write (set(merge) does not parse dots as field paths — only update() does)", () => {
    const result = buildOnlineOrderKitchenTicketWrites({
      ...baseParams,
      lines: [{ productId: "p1", name: "Unli Samgyup", qty: 1 }],
      locationByInvId: new Map([["p1", { kitchenLocationId: "grill" }]]),
    });
    const fanoutWrites = result.writes.filter((w) => w.path.startsWith("stores/store1/rtKdsTickets/"));
    expect(fanoutWrites).toHaveLength(1);
    for (const write of fanoutWrites) {
      for (const key of Object.keys(write.data)) {
        expect(key.includes(".")).toBe(false);
      }
    }
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