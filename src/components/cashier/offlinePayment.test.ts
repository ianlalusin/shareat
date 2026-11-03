import { describe, it, expect, beforeEach, vi } from "vitest";

// completePaymentOffline after audit P1: the till records an immutable command
// (localStorage queue FIRST, then the create-only posCommands doc) and writes
// NO canonical doc (receipt, session close, table release, counter).
const state = new Map<string, any>();
const calls: string[] = [];
const setDocs: { path: string; data: any }[] = [];
let setDocImpl: () => Promise<void> = async () => {};

const snap = (path: string) => ({ id: path.split("/").pop(), exists: () => state.has(path), data: () => state.get(path) });

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => {
    const path = parts.join("/");
    return { path, id: path.split("/").pop() };
  },
  getDoc: async (ref: any) => snap(ref.path),
  setDoc: (ref: any, data: any) => {
    calls.push("posCommand");
    setDocs.push({ path: ref.path, data });
    return setDocImpl();
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: {}, auth: {} }));
vi.mock("@/components/cashier/firestore", () => ({
  getActorStamp: () => ({ uid: "u1", username: "cashier" }),
  getCurrentSessionBillingState: async () => ({
    billingRevision: 5, billDiscount: null, customAdjustments: [], loyaltyRedemptions: [],
    billLines: [{ type: "addon", itemName: "Wings", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 }],
  }),
}));
vi.mock("@/lib/offline/offlineReceiptNumber", () => ({ nextDailySeq: () => 7, formatOfflineReceiptNumber: () => "S1-OL-X-0320-007" }));
vi.mock("@/lib/offline/browserDevice", () => ({ deviceReceiptTag: () => "X", getBrowserDeviceId: () => "dev" }));
vi.mock("@/lib/pos-commands/client", () => ({ getOperatorSessionToken: () => "signed.token" }));
const addToQueue = vi.fn((item: any) => { calls.push("queue"); return { ...item, id: "q1" }; });
vi.mock("@/lib/offline/payment-queue", () => ({ addToQueue: (item: any) => addToQueue(item) }));
vi.mock("@/context/auth-context", () => ({}));

(globalThis as any).window ??= { localStorage: {} };

import { completePaymentOffline } from "./offlinePayment";
import { calculateBillTotals } from "@/lib/tax";

const store = { id: "s1", code: "S1" } as any;
const methods = [{ id: "cash", name: "Cash", type: "cash" }, { id: "qr", name: "QR", gateway: "paymongo_qrph" }] as any[];
const user = { uid: "u1" } as any;
let due = 0;

beforeEach(() => {
  state.clear();
  calls.length = 0;
  setDocs.length = 0;
  setDocImpl = async () => {};
  addToQueue.mockClear();
  due = calculateBillTotals([{ type: "addon", itemName: "Wings", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 } as any], store, null, [], []).grandTotal;
  state.set("stores/s1/sessions/sA", { status: "active", tableId: "t1", sessionMode: "dinein", billingRevision: 5, revision: 3 });
  state.set("stores/s1/activeSessions/sA", { customerPin: "111222" });
});

const cash = () => [{ id: "c", methodId: "cash", amount: due }];

describe("completePaymentOffline (audit P1 / B16 / B17)", () => {
  it("saves the queue item BEFORE the command doc, and writes nothing canonical", async () => {
    const r = await completePaymentOffline("s1", "sA", user, cash(), store, methods, due);
    expect(calls).toEqual(["queue", "posCommand"]);
    expect(setDocs.map((w) => w.path)).toEqual([`stores/s1/posCommands/${addToQueue.mock.calls[0][0].opId}`]);
    const queued = addToQueue.mock.calls[0][0];
    expect(queued.receiptNumber).toBe(r.receiptNumber);
    expect(queued.provisionalReceipt).toMatchObject({ receiptNumber: "S1-OL-X-0320-007", pendingSettlement: true, total: due });
    expect(Object.values(queued.effects).every((e) => e === "skip")).toBe(true);
  });

  it("the command carries op/terminal ids, expected session + bill revisions, table and operator token", async () => {
    await completePaymentOffline("s1", "sA", user, cash(), store, methods, due);
    const cmd = setDocs[0].data;
    expect(cmd).toMatchObject({
      schema: 1, kind: "checkout", storeId: "s1", sessionId: "sA", terminalId: "dev", createdByUid: "u1",
      operatorSessionToken: "signed.token",
      expected: { sessionRevision: 3, billingRevision: 5, tableId: "t1", totalCents: Math.round(due * 100) },
      payload: { receiptNumber: "S1-OL-X-0320-007", receiptSeq: 7, payments: [{ methodId: "cash", amount: due, reference: null, intentDocId: null, fromReservationPaymentId: null }] },
    });
    expect(cmd).toEqual(addToQueue.mock.calls[0][0].command);
  });

  it("does not take the sale when the queue item cannot be saved", async () => {
    addToQueue.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    await expect(completePaymentOffline("s1", "sA", user, cash(), store, methods, due)).rejects.toThrow(/payment was not taken/);
    expect(calls).not.toContain("posCommand");
  });

  it("a denied command-doc sync is not fatal (reconcile uses the queued copy)", async () => {
    setDocImpl = () => Promise.reject(new Error("permission-denied"));
    await expect(completePaymentOffline("s1", "sA", user, cash(), store, methods, due)).resolves.toMatchObject({ receiptId: "sA" });
    await Promise.resolve();
  });

  it("refuses a QR tender whose bridge isn't cached / linked", async () => {
    await expect(
      completePaymentOffline("s1", "sA", user, [{ id: "q", methodId: "qr", amount: due, reference: "pay_x", intentDocId: "b9" }], store, methods, due),
    ).rejects.toThrow(/could not be found/);
    expect(calls).toEqual([]);
  });
});
