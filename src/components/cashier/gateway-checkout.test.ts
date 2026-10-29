import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the client Firestore SDK (same approach as
// refund-receipt.test.ts). Exercises the real completePaymentFromUnits
// transaction against fabricated / reused / mismatched PayMongo tenders (B03).
const state = new Map<string, any>();

const snap = (path: string) => ({
  id: path.split("/").pop(),
  exists: () => state.has(path),
  data: () => state.get(path),
});

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => {
    const path = parts.join("/");
    return { path, id: path.split("/").pop() };
  },
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  query: (c: any) => c,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  getDoc: async (ref: any) => snap(ref.path),
  getDocs: async (q: any) =>
    q.path.endsWith("sessionBillLines")
      ? { docs: [...state.entries()].filter(([k]) => k.startsWith(q.path + "/")).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }
      : { docs: [] },
  serverTimestamp: () => ({ __ts: true }),
  increment: (n: number) => ({ __inc: n }),
  updateDoc: async (ref: any, d: any) => state.set(ref.path, { ...(state.get(ref.path) || {}), ...d }),
  writeBatch: () => ({ set: () => {}, update: () => {}, commit: async () => {} }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<any>) => {
    const ops: (() => void)[] = [];
    let autoId = 0;
    const ret = await fn({
      get: async (ref: any) => snap(ref.path),
      set: (ref: any, d: any) => ops.push(() => state.set(ref.path ?? `auto${autoId++}`, d)),
      update: (ref: any, d: any) => ops.push(() => state.set(ref.path, { ...(state.get(ref.path) || {}), ...d })),
      delete: (ref: any) => ops.push(() => state.delete(ref.path)),
    });
    ops.forEach((f) => f());
    return ret;
  },
  Timestamp: class Timestamp {},
  deleteField: () => ({}), arrayUnion: () => ({}), arrayRemove: () => ({}), setDoc: async () => {},
}));
vi.mock("@/lib/firebase/client", () => ({ db: {}, auth: {} }));
vi.mock("@/lib/analytics/applyReceiptDeltaServerFirst", () => ({ applyReceiptDeltaServerFirst: async () => ({}) }));
vi.mock("@/lib/analytics/applyAnalyticsDeltaV2", () => ({ applyAnalyticsDeltaV2: async () => {} }));
vi.mock("@/lib/analytics/applyKdsTicketDelta", () => ({ applyKdsTicketDelta: async () => {} }));
vi.mock("@/lib/analytics/applyKdsDeltaServerFirst", () => ({ applyKdsDeltaServerFirst: async () => {} }));
vi.mock("@/lib/printing/kitchenBackupPrint", () => ({ printKitchenTicketBackup: async () => {} }));
vi.mock("@/lib/printing/kitchenBackupDeps", () => ({ makeKitchenBackupDeps: () => ({}) }));
vi.mock("@/components/cashier/activity-log", () => ({ writeActivityLog: async () => {} }));
vi.mock("@/lib/offline/kitchenTicketWrites", () => ({ selectTicketWriter: () => ({}) }));
vi.mock("@/lib/offline/commit", () => ({ commitLocalFirst: async () => {} }));
vi.mock("@/lib/offline/sessionOwnership", () => ({ sessionOwnershipFields: () => ({}) }));
vi.mock("@/lib/offline/browserDevice", () => ({ getBrowserDeviceId: () => "dev" }));
vi.mock("@/lib/server-profiles/activeLocalProfile", () => ({ getActiveLocalProfile: () => null }));
vi.mock("@/context/auth-context", () => ({}));

import { completePaymentFromUnits } from "./firestore";
import { calculateBillTotals } from "@/lib/tax";

const S = "stores/s1";
const store = { id: "s1", name: "S1" } as any;
const methods = [
  { id: "cash", name: "Cash", type: "cash" },
  { id: "qr", name: "QR Ph", gateway: "paymongo_qrph" },
] as any[];
const user = { uid: "u1", username: "cashier" } as any;
const line = { type: "addon", itemId: "i1", itemName: "Wings", category: "Food", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 300 };

let due = 0;
function seedSession(id: string) {
  state.set(`${S}/sessions/${id}`, { status: "active", tableId: "alacarte", sessionMode: "alacarte", billingRevision: 0 });
  state.set(`${S}/sessions/${id}/sessionBillLines/l1`, line);
}
function seedBridge(id: string, over: Record<string, any> = {}) {
  state.set(`${S}/paymentIntents/${id}`, {
    storeId: "s1", sessionId: "sessA", methodId: "qr", status: "paid",
    amount: due, amountCentavos: Math.round(due * 100), paymongoIntentId: `pi_${id}`, paymongoPaymentId: `pay_${id}`,
    ...over,
  });
}
const qr = (intentDocId: string | undefined, reference: string, amount = due) =>
  ({ id: "t1", methodId: "qr", amount, reference, ...(intentDocId ? { intentDocId } : {}) });

beforeEach(() => {
  state.clear();
  due = calculateBillTotals([line as any], store, null, [], []).grandTotal;
  seedSession("sessA");
  seedSession("sessB");
});

describe("completePaymentFromUnits gateway tenders (audit B03)", () => {
  it("settles a bill with a webhook-confirmed bridge for this session", async () => {
    seedBridge("b1");
    await completePaymentFromUnits("s1", "sessA", user, [qr("b1", "pay_b1")], store, methods, due);
    expect(state.get(`${S}/sessions/sessA`).status).toBe("closed");
    expect(state.get(`${S}/receipts/sessA`).status).toBe("final");
  });

  it("rejects a fabricated reference with no bridge link", async () => {
    await expect(completePaymentFromUnits("s1", "sessA", user, [qr(undefined, "pay_forged")], store, methods, due))
      .rejects.toThrow(/isn't linked/);
    expect(state.get(`${S}/sessions/sessA`).status).toBe("active");
    expect(state.has(`${S}/receipts/sessA`)).toBe(false);
  });

  it("rejects a bridge id that does not exist", async () => {
    await expect(completePaymentFromUnits("s1", "sessA", user, [qr("nope", "pay_nope")], store, methods, due))
      .rejects.toThrow(/could not be found/);
    expect(state.has(`${S}/receipts/sessA`)).toBe(false);
  });

  it("rejects reusing one paid QR on a second session", async () => {
    seedBridge("b1");
    await completePaymentFromUnits("s1", "sessA", user, [qr("b1", "pay_b1")], store, methods, due);
    await expect(completePaymentFromUnits("s1", "sessB", user, [qr("b1", "pay_b1")], store, methods, due))
      .rejects.toThrow(/another bill/);
    expect(state.get(`${S}/sessions/sessB`).status).toBe("active");
  });

  it("rejects an unpaid bridge", async () => {
    seedBridge("b1", { status: "awaiting_payment", paymongoPaymentId: null });
    await expect(completePaymentFromUnits("s1", "sessA", user, [qr("b1", "pi_b1")], store, methods, due))
      .rejects.toThrow(/not confirmed/);
  });

  it("rejects a partial QR payment passed off as the full amount", async () => {
    seedBridge("b1", { amount: 1, amountCentavos: 100 });
    await expect(completePaymentFromUnits("s1", "sessA", user, [qr("b1", "pay_b1")], store, methods, due))
      .rejects.toThrow(/amount does not match/);
  });

  it("still accepts a split tender: partial QR + cash", async () => {
    const qrPart = Math.round((due / 2) * 100) / 100;
    seedBridge("b1", { amount: qrPart, amountCentavos: Math.round(qrPart * 100) });
    const cash = { id: "c1", methodId: "cash", amount: Math.round((due - qrPart) * 100) / 100 };
    await completePaymentFromUnits("s1", "sessA", user, [qr("b1", "pay_b1", qrPart), cash], store, methods, due);
    expect(state.get(`${S}/receipts/sessA`).status).toBe("final");
  });

  it("rejects a negative cash tender", async () => {
    await expect(
      completePaymentFromUnits("s1", "sessA", user, [{ id: "c", methodId: "cash", amount: -5 }, { id: "c2", methodId: "cash", amount: due + 5 }], store, methods, due),
    ).rejects.toThrow(/positive number/);
  });
});
