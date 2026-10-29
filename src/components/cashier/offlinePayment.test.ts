import { describe, it, expect, beforeEach, vi } from "vitest";

// completePaymentOffline ordering (audit B17) and offline CAS stamps (B16).
const state = new Map<string, any>();
const calls: string[] = [];
let batchWrites: { op: string; path: string; data?: any }[] = [];
let commitOnError: ((e: unknown) => void) | undefined;

const snap = (path: string) => ({ id: path.split("/").pop(), exists: () => state.has(path), data: () => state.get(path) });

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => {
    const path = parts.join("/");
    return { path, id: path.split("/").pop() };
  },
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  query: (c: any) => c, where: () => ({}), orderBy: () => ({}),
  getDoc: async (ref: any) => snap(ref.path),
  getDocs: async () => ({ docs: [] }),
  serverTimestamp: () => ({ __ts: true }),
  writeBatch: () => ({
    set: (ref: any, data: any) => batchWrites.push({ op: "set", path: ref.path, data }),
    update: (ref: any, data: any) => batchWrites.push({ op: "update", path: ref.path, data }),
    delete: (ref: any) => batchWrites.push({ op: "delete", path: ref.path }),
    commit: async () => {},
  }),
}));
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("@/components/cashier/firestore", () => ({
  getActorStamp: () => ({ uid: "u1", username: "cashier" }),
  getCurrentSessionBillingState: async () => ({
    billingRevision: 0, billDiscount: null, customAdjustments: [], loyaltyRedemptions: [],
    billLines: [{ type: "addon", itemName: "Wings", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 }],
  }),
}));
vi.mock("@/lib/offline/commit", () => ({
  commitLocalFirst: (_b: unknown, onError?: (e: unknown) => void) => { calls.push("commit"); commitOnError = onError; },
}));
vi.mock("@/lib/offline/offlineReceiptNumber", () => ({ nextDailySeq: () => 7, formatOfflineReceiptNumber: () => "OL-X-7" }));
vi.mock("@/lib/offline/browserDevice", () => ({ deviceReceiptTag: () => "X", getBrowserDeviceId: () => "dev" }));
const addToQueue = vi.fn((item: any) => { calls.push("queue"); return { ...item, id: "q1" }; });
const updateQueueItem = vi.fn();
vi.mock("@/lib/offline/payment-queue", () => ({
  addToQueue: (item: any) => addToQueue(item),
  updateQueueItem: (...a: any[]) => updateQueueItem(...a),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (a: any) => toast(a) }));
vi.mock("@/context/auth-context", () => ({}));

(globalThis as any).window ??= { localStorage: {} };

import { completePaymentOffline } from "./offlinePayment";
import { calculateBillTotals } from "@/lib/tax";

const store = { id: "s1", code: "S1" } as any;
const methods = [{ id: "cash", name: "Cash", type: "cash" }, { id: "qr", name: "QR", gateway: "paymongo_qrph" }] as any[];
let due = 0;

beforeEach(() => {
  state.clear();
  calls.length = 0;
  batchWrites = [];
  commitOnError = undefined;
  addToQueue.mockClear();
  updateQueueItem.mockClear();
  toast.mockClear();
  due = calculateBillTotals([{ type: "addon", itemName: "Wings", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 } as any], store, null, [], []).grandTotal;
  state.set("stores/s1/sessions/sA", { status: "active", tableId: "t1", sessionMode: "dinein", billingRevision: 0, revision: 3 });
  state.set("stores/s1/tables/t1", { currentSessionId: "sA" });
});

const cash = () => [{ id: "c", methodId: "cash", amount: due }];

describe("completePaymentOffline (audit B16/B17)", () => {
  it("saves the queue marker BEFORE committing the batch, with receipt number + write id", async () => {
    const r = await completePaymentOffline("s1", "sA", {} as any, cash(), store, methods, due);
    expect(calls).toEqual(["queue", "commit"]);
    const queued = addToQueue.mock.calls[0][0];
    expect(queued.receiptNumber).toBe(r.receiptNumber);
    expect(queued.offlineWriteId).toMatch(/[0-9a-f-]{36}/);
    expect(queued.ctx.tenders).toEqual([{ methodId: "cash", amount: due, reference: null }]);
  });

  it("does not commit the sale when the queue marker cannot be saved", async () => {
    addToQueue.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    await expect(completePaymentOffline("s1", "sA", {} as any, cash(), store, methods, due)).rejects.toThrow(/payment was not taken/);
    expect(calls).not.toContain("commit");
  });

  it("marks the queued sale failed and toasts when the server rejects the batch", async () => {
    await completePaymentOffline("s1", "sA", {} as any, cash(), store, methods, due);
    commitOnError!(new Error("permission-denied"));
    expect(updateQueueItem).toHaveBeenCalledWith("q1", expect.objectContaining({ status: "failed" }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("stamps the compare-and-swap fields the rules check", async () => {
    await completePaymentOffline("s1", "sA", {} as any, cash(), store, methods, due);
    const sess = batchWrites.find((w) => w.path === "stores/s1/sessions/sA")!;
    expect(sess.data.revision).toBe(4);
    const writeId = sess.data.offlineWriteId;
    expect(writeId).toBeTruthy();
    for (const p of ["stores/s1/tables/t1", "stores/s1/storeConfig/current/tables/t1"]) {
      const w = batchWrites.find((x) => x.path === p)!;
      expect(w.data).toMatchObject({ currentSessionId: null, closedSessionId: "sA", releasedByWriteId: writeId });
    }
    expect(batchWrites.find((w) => w.path === "stores/s1/receipts/sA")!.data.offlineOrigin).toBe(true);
  });

  it("refuses a QR tender whose bridge isn't cached / linked", async () => {
    await expect(
      completePaymentOffline("s1", "sA", {} as any, [{ id: "q", methodId: "qr", amount: due, reference: "pay_x", intentDocId: "b9" }], store, methods, due),
    ).rejects.toThrow(/could not be found/);
    expect(calls).toEqual([]);
  });
});
