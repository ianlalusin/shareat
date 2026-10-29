import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * B02 / B24 regression tests for the POS PayMongo routes and webhook.
 * Firestore is an in-memory double; PayMongo calls are mocked (no network).
 */

const STORE = "store_a";
const OTHER_STORE = "store_b";
const SESSION = "sess_1";
const METHOD = "mop_qr";

let docs: Record<string, any> = {};
let tokenUid = "uid_cashier";
let autoId = 0;

function makeDb() {
  const ref = (path: string) => ({
    path,
    id: path.split("/").pop() as string,
    get: async () => snap(path),
    set: async (data: any, opts?: { merge?: boolean }) => write(path, data, opts),
  });
  const snap = (path: string) => ({
    exists: docs[path] !== undefined,
    id: path.split("/").pop(),
    data: () => docs[path],
    get: (field: string) => docs[path]?.[field],
  });
  const write = (path: string, data: any, opts?: { merge?: boolean }) => {
    docs[path] = opts?.merge ? { ...(docs[path] ?? {}), ...data } : { ...data };
  };
  return {
    doc: (path: string) => ref(path),
    collection: (path: string) => ({ doc: (id?: string) => ref(`${path}/${id ?? `auto_${++autoId}`}`) }),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (r: any, data: any, opts?: { merge?: boolean }) => ops.push(() => write(r.path, data, opts)),
        commit: async () => ops.forEach((op) => op()),
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const ops: Array<() => void> = [];
      const tx = {
        get: async (r: any) => snap(r.path),
        set: (r: any, data: any, opts?: { merge?: boolean }) => ops.push(() => write(r.path, data, opts)),
      };
      const out = await fn(tx);
      ops.forEach((op) => op());
      return out;
    },
  };
}
const db = makeDb();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: tokenUid }) }),
}));

const createQr = vi.fn();
const getIntent = vi.fn();
vi.mock("@/lib/payments/paymongo/qrph.server", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paymongo/qrph.server")>();
  return {
    ...actual,
    createQrPaymentViaApi: (...a: any[]) => createQr(...a),
    getPaymentIntentViaApi: (...a: any[]) => getIntent(...a),
  };
});

const verifySig = vi.fn(() => true);
vi.mock("@/lib/payments/paymongo/qrph", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paymongo/qrph")>();
  return { ...actual, verifyWebhookSignature: () => verifySig() };
});

import { POST as createQrPOST } from "./create-qr/route";
import { POST as statusPOST } from "./status/route";
import { POST as webhookPOST } from "../../webhooks/paymongo/route";

function req(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}
const createBody = (over: Record<string, unknown> = {}) => ({ storeId: STORE, sessionId: SESSION, amount: 500, methodId: METHOD, ...over });

beforeEach(() => {
  autoId = 0;
  tokenUid = "uid_cashier";
  createQr.mockReset();
  getIntent.mockReset();
  let n = 0;
  createQr.mockImplementation(async () => ({
    paymongoIntentId: `pi_${++n}`,
    qrData: "qr",
    imageUrl: null,
    expiresAtFromApiMs: Date.now() + 10 * 60_000,
  }));
  docs = {
    "staff/uid_cashier": { role: "cashier", status: "active", assignedStoreIds: [STORE] },
    "staff/uid_kitchen": { role: "kitchen", status: "active", assignedStoreIds: [STORE] },
    "staff/uid_pending": { role: "cashier", status: "pending", assignedStoreIds: [STORE] },
    "staff/uid_other": { role: "cashier", status: "active", assignedStoreIds: [OTHER_STORE] },
    [`stores/${STORE}/sessions/${SESSION}`]: { status: "active" },
    [`stores/${STORE}/storeConfig/current`]: {
      modesOfPayment: [
        { id: METHOD, name: "QR Ph", gateway: "paymongo_qrph", isActive: true, isArchived: false },
        { id: "mop_cash", name: "Cash", gateway: null, isActive: true, isArchived: false },
      ],
    },
  };
});

describe("B02: create-qr authorization and validation", () => {
  it.each([
    ["customer / non-staff", "uid_customer"],
    ["kitchen role", "uid_kitchen"],
    ["pending staff", "uid_pending"],
    ["cashier of another store", "uid_other"],
  ])("403s for %s and never calls PayMongo", async (_label, uid) => {
    tokenUid = uid;
    const res = await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()));
    expect(res.status).toBe(403);
    expect(createQr).not.toHaveBeenCalled();
  });

  it("rejects ids that are not a single path segment", async () => {
    const res = await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody({ sessionId: "s/../x" })));
    expect(res.status).toBe(400);
    expect(createQr).not.toHaveBeenCalled();
  });

  it("rejects a method that is not an enabled PayMongo method of the store", async () => {
    const res = await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody({ methodId: "mop_cash" })));
    expect(res.status).toBe(400);
    expect(createQr).not.toHaveBeenCalled();
  });

  it("allows an assigned active cashier", async () => {
    const res = await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()));
    expect(res.status).toBe(200);
    expect(createQr).toHaveBeenCalledTimes(1);
  });
});

describe("B24: create-qr retry reuses the pending intent", () => {
  it("a second POST for the same store/session/method/amount returns the same intent", async () => {
    const r1 = await (await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()))).json();
    const r2 = await (await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()))).json();
    expect(createQr).toHaveBeenCalledTimes(1);
    expect(r2.intentDocId).toBe(r1.intentDocId);
    expect(r2.paymongoIntentId).toBe(r1.paymongoIntentId);
    expect(r2.reused).toBe(true);
  });

  it("a different amount creates a new intent", async () => {
    await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()));
    await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody({ amount: 300 })));
    expect(createQr).toHaveBeenCalledTimes(2);
  });

  it("a paid or expiring intent is not reused", async () => {
    const r1 = await (await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()))).json();
    docs[`stores/${STORE}/paymentIntents/${r1.intentDocId}`].status = "paid";
    const r2 = await (await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()))).json();
    expect(createQr).toHaveBeenCalledTimes(2);
    expect(r2.intentDocId).not.toBe(r1.intentDocId);
  });

  it("a failed provider call releases the claim so a retry can create", async () => {
    createQr.mockRejectedValueOnce(new Error("PayMongo: boom"));
    const r1 = await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()));
    expect(r1.status).toBe(502);
    const r2 = await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()));
    expect(r2.status).toBe(200);
    expect(createQr).toHaveBeenCalledTimes(2);
  });
});

describe("B02: status authorization and session binding", () => {
  async function seedIntent() {
    const r = await (await createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody()))).json();
    return r.intentDocId as string;
  }

  it("403s for a cashier of another store", async () => {
    const intentDocId = await seedIntent();
    tokenUid = "uid_other";
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: SESSION, intentDocId }));
    expect(res.status).toBe(403);
    expect(getIntent).not.toHaveBeenCalled();
  });

  it("403s for a non-staff identity", async () => {
    const intentDocId = await seedIntent();
    tokenUid = "uid_customer";
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: SESSION, intentDocId }));
    expect(res.status).toBe(403);
  });

  it("rejects a sessionId that does not match the bridge", async () => {
    const intentDocId = await seedIntent();
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: "other_session", intentDocId }));
    expect(res.status).toBe(404);
    expect(getIntent).not.toHaveBeenCalled();
  });

  it("polls for the matching session", async () => {
    const intentDocId = await seedIntent();
    getIntent.mockResolvedValue({ status: "succeeded", latestPaymentId: "pay_1", metadata: {} });
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: SESSION, intentDocId }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("paid");
  });
});

describe("B24: webhook does not drop an event whose index is missing", () => {
  const event = (pi: string) =>
    JSON.stringify({
      data: {
        id: "evt_1",
        attributes: { type: "payment.paid", data: { id: "pay_9", attributes: { payment_intent_id: pi, status: "paid" } } },
      },
    });
  const hook = (body: string) =>
    webhookPOST(new Request("http://x/api/webhooks/paymongo", { method: "POST", headers: { "paymongo-signature": "t=1,te=aa" }, body }) as any);

  beforeEach(() => {
    process.env.PAYMONGO_WEBHOOK_SECRET_POS = "whsec_test";
  });

  it("returns 503 (redeliver) for a POS intent whose bridge is not committed yet", async () => {
    getIntent.mockResolvedValue({ status: "succeeded", latestPaymentId: "pay_9", metadata: { kind: "pos_session", storeId: STORE, intentDocId: "pending_bridge" } });
    const res = await hook(event("pi_early"));
    expect(res.status).toBe(503);
  });

  it("repairs the index and applies the event when the bridge exists", async () => {
    docs[`stores/${STORE}/paymentIntents/b1`] = {
      id: "b1", storeId: STORE, sessionId: SESSION, paymongoIntentId: "pi_x", status: "awaiting_payment", processedEventIds: [],
    };
    getIntent.mockResolvedValue({ status: "succeeded", latestPaymentId: "pay_9", metadata: { kind: "pos_session", storeId: STORE, intentDocId: "b1" } });
    const res = await hook(event("pi_x"));
    expect(res.status).toBe(200);
    expect(docs["paymongoIntentIndex/pi_x"]).toMatchObject({ storeId: STORE, intentDocId: "b1" });
    expect(docs[`stores/${STORE}/paymentIntents/b1`].status).toBe("paid");
  });

  it("still acknowledges non-POS events", async () => {
    getIntent.mockResolvedValue({ status: "succeeded", latestPaymentId: "pay_9", metadata: {} });
    const res = await hook(event("pi_storefront"));
    expect(res.status).toBe(200);
  });

  it("returns 503 when PayMongo lookup fails", async () => {
    getIntent.mockRejectedValue(new Error("down"));
    const res = await hook(event("pi_unknown"));
    expect(res.status).toBe(503);
  });
});
