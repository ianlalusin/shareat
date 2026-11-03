import { describe, it, expect, beforeEach, vi } from "vitest";

// Since audit P1 the client only PROPOSES tenders: completePaymentFromUnits
// posts to /api/pos/commands/checkout and the server verifies + consumes
// gateway payments (forged / reused / wrong-store / wrong-revision cases live
// in src/lib/server/pos-commands/pos-commands.test.ts). This pins the client
// contract: what is sent, and what is rejected before any network call.
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

const posted: any[] = [];
vi.mock("@/lib/pos-commands/client", () => ({
  postPosCommand: async (path: string, storeId: string, body: any) => {
    posted.push({ path, storeId, body });
    return { receiptId: body.sessionId, receiptNumber: "X-1", totalCents: body.expectedTotalCents, replay: false };
  },
}));

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

beforeEach(() => {
  state.clear();
  posted.length = 0;
  due = calculateBillTotals([line as any], store, null, [], []).grandTotal;
  state.set(`${S}/sessions/sessA`, { status: "active", tableId: "alacarte", sessionMode: "alacarte", billingRevision: 7 });
  state.set(`${S}/sessions/sessA/sessionBillLines/l1`, line);
});

describe("completePaymentFromUnits client contract (audit P1 / B03)", () => {
  it("posts only tenders, bill revision, expected centavos and a stable opId", async () => {
    const id = await completePaymentFromUnits("s1", "sessA", user, [{ id: "t1", methodId: "qr", amount: due, reference: "pay_b1", intentDocId: "b1" } as any], store, methods, due, "op-1");
    expect(id).toBe("sessA");
    expect(posted).toHaveLength(1);
    expect(posted[0].path).toBe("checkout");
    expect(posted[0].body).toEqual({
      sessionId: "sessA", opId: "op-1", billingRevision: 7, expectedTotalCents: Math.round(due * 100),
      payments: [{ methodId: "qr", amount: due, reference: "pay_b1", intentDocId: "b1", fromReservationPaymentId: null }],
    });
    // Nothing canonical is written by the client.
    expect([...state.keys()].some((k) => k.includes("/receipts/"))).toBe(false);
  });

  it("rejects a fabricated QR reference with no bridge link before calling the server", async () => {
    await expect(completePaymentFromUnits("s1", "sessA", user, [{ id: "t", methodId: "qr", amount: due, reference: "pay_forged" } as any], store, methods, due))
      .rejects.toThrow(/isn't linked/);
    expect(posted).toHaveLength(0);
  });

  it("rejects a negative cash tender before calling the server", async () => {
    await expect(
      completePaymentFromUnits("s1", "sessA", user, [{ id: "c", methodId: "cash", amount: -5 }, { id: "c2", methodId: "cash", amount: due + 5 }] as any, store, methods, due),
    ).rejects.toThrow(/positive number/);
    expect(posted).toHaveLength(0);
  });

  it("refuses when the bill total moved since the cashier set up tenders", async () => {
    await expect(completePaymentFromUnits("s1", "sessA", user, [{ id: "c", methodId: "cash", amount: 999 } as any], store, methods, due + 1))
      .rejects.toThrow(/Bill changed/);
    expect(posted).toHaveLength(0);
  });
});
