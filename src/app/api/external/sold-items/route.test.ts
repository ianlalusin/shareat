import { describe, it, expect, beforeEach, vi } from "vitest";

let receipts: any[] = [];
const inventory = new Map<string, any>();
let inventoryReads = 0;
let fullScans = 0;

const db = {
  collection: (p: string) => {
    if (p.endsWith("/inventory")) return { get: async () => { fullScans++; return { docs: [] }; } };
    const q: any = { where: () => q, get: async () => ({ docs: receipts.map((r) => ({ data: () => r })) }) };
    return q;
  },
  doc: (p: string) => ({ path: p, id: p.split("/").pop() }),
  getAll: async (...refs: any[]) => refs.map((ref) => {
    inventoryReads++;
    return { id: ref.id, exists: inventory.has(ref.id), data: () => inventory.get(ref.id) };
  }),
};

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => db }));
vi.mock("@/lib/server/external-auth", () => ({
  resolveExternalKeyScope: () => ({ response: null }),
  storeAllowed: () => true,
}));

import { GET } from "./route";

const get = () => GET(new Request("http://localhost/api/external/sold-items?storeId=a&date=2026-10-29"));

beforeEach(() => {
  receipts = [];
  inventory.clear();
  inventoryReads = 0;
  fullScans = 0;
});

describe("GET /api/external/sold-items (B27)", () => {
  it("an empty day performs zero inventory reads", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
    expect(inventoryReads).toBe(0);
    expect(fullScans).toBe(0);
  });

  it("a two-item day reads only those distinct item docs", async () => {
    for (let i = 0; i < 50; i++) inventory.set(`other${i}`, { name: `Other ${i}` });
    inventory.set("inv1", { name: "Coke", uom: "can" });
    receipts = [
      { status: "final", lines: [{ type: "addon", itemId: "inv1", qtyOrdered: 2, unitPrice: 50 }, { type: "addon", itemId: "gone", qtyOrdered: 1, unitPrice: 10 }] },
      { status: "final", lines: [{ type: "addon", itemId: "inv1", qtyOrdered: 1, unitPrice: 50, modifiersTotal: 5 }] },
    ];
    const body = await (await get()).json();
    expect(inventoryReads).toBe(2);
    expect(fullScans).toBe(0);
    const coke = body.items.find((i: any) => i.posItemId === "inv1");
    expect(coke.name).toBe("Coke");
    expect(coke.billableQty).toBe(3);
    expect(coke.grossAmount).toBe(155);
    expect(body.items.find((i: any) => i.posItemId === "gone").inventoryMissing).toBe(true);
  });
});
