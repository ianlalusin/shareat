import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * B24 recovery tests for the PayMongo QR lifecycle (audit P4).
 *
 * Unlike paymongo-routes.test.ts, the provider client is NOT mocked here: the
 * real qrph.server code runs against a fake PayMongo behind a mocked global
 * fetch. The fake honours the documented Idempotency-Key contract
 * (https://docs.paymongo.com/reference/idempotent-requests): a creation POST
 * replayed with the same key returns the first stored result. Faults are
 * injected before/after each provider call and on Firestore writes.
 */

const STORE = "store_a";
const SESSION = "sess_1";
const METHOD = "mop_qr";
const ATTEMPT = `stores/${STORE}/paymentIntentAttempts/${SESSION}__${METHOD}__50000`;

// ---------- in-memory Firestore (Admin SDK shape) with write-fault hook ----------
let docs: Record<string, any> = {};
let autoId = 0;
/** Throw from a write to `path` (simulates a crash / Firestore outage at that step). */
let failWrite: ((path: string, data: any) => boolean) | null = null;

function makeDb() {
  const ref = (path: string): any => ({
    path,
    id: path.split("/").pop() as string,
    get: async () => snap(path),
    set: async (data: any, opts?: { merge?: boolean }) => write(path, data, opts),
    collection: (sub: string) => coll(`${path}/${sub}`),
  });
  const coll = (path: string) => ({ doc: (id?: string) => ref(`${path}/${id ?? `auto_${++autoId}`}`) });
  const snap = (path: string) => ({
    exists: docs[path] !== undefined,
    id: path.split("/").pop(),
    data: () => (docs[path] === undefined ? undefined : structuredClone(docs[path])),
    get: (field: string) => docs[path]?.[field],
  });
  const write = (path: string, data: any, opts?: { merge?: boolean }) => {
    if (failWrite?.(path, data)) throw new Error(`injected write failure at ${path}`);
    docs[path] = opts?.merge ? { ...(docs[path] ?? {}), ...data } : { ...data };
  };
  return {
    doc: (path: string) => ref(path),
    collection: coll,
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (r: any, data: any, opts?: { merge?: boolean }) => ops.push(() => write(r.path, data, opts)),
        commit: async () => ops.forEach((op) => op()),
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const ops: Array<[string, any, any]> = [];
      const tx = {
        get: async (r: any) => snap(r.path),
        set: (r: any, data: any, opts?: { merge?: boolean }) => ops.push([r.path, data, opts]),
      };
      const out = await fn(tx);
      // All-or-nothing like a real commit: check every fault first.
      for (const [p, d] of ops) if (failWrite?.(p, d)) throw new Error(`injected commit failure at ${p}`);
      const saved = failWrite;
      failWrite = null;
      ops.forEach(([p, d, o]) => write(p, d, o));
      failWrite = saved;
      return out;
    },
  };
}
const db = makeDb();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "uid_cashier" }) }),
}));
const verifySig = vi.fn(() => true);
vi.mock("@/lib/payments/paymongo/qrph", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paymongo/qrph")>();
  return { ...actual, verifyWebhookSignature: () => verifySig() };
});

import { POST as createQrPOST } from "./create-qr/route";
import { POST as statusPOST } from "./status/route";
import { POST as webhookPOST } from "../../webhooks/paymongo/route";

// ---------- fake PayMongo behind global fetch ----------
type Fault = { op: "create_intent" | "create_method" | "attach" | "get_intent"; when: "before" | "after"; times?: number };
let pm: {
  intents: Map<string, any>;
  methods: Map<string, any>;
  idem: Map<string, any>;
  idemBodies: Map<string, string>;
  seq: number;
  calls: string[];
  faults: Fault[];
};

function intentJson(pi: any) {
  return {
    data: {
      id: pi.id,
      type: "payment_intent",
      attributes: {
        amount: pi.amount,
        currency: pi.currency,
        status: pi.status,
        metadata: pi.metadata,
        payments: pi.payments,
        next_action: pi.code ? { type: "consume_qr", code: pi.code } : null,
      },
    },
  };
}

function takeFault(op: Fault["op"], when: Fault["when"]) {
  const f = pm.faults.find((x) => x.op === op && x.when === when);
  if (!f) return false;
  f.times = (f.times ?? 1) - 1;
  if (f.times <= 0) pm.faults.splice(pm.faults.indexOf(f), 1);
  return true;
}

async function fakeFetch(url: string, init: any = {}) {
  const path = new URL(url).pathname;
  const method = (init.method ?? "GET").toUpperCase();
  const key = init.headers?.["Idempotency-Key"] as string | undefined;
  const body = init.body ? JSON.parse(init.body) : null;
  const ok = (json: any) => ({ ok: true, status: 200, json: async () => json });
  const net = () => { throw new TypeError("fetch failed (injected)"); };

  const op: Fault["op"] | null =
    method === "POST" && path === "/v1/payment_intents" ? "create_intent"
    : method === "POST" && path === "/v1/payment_methods" ? "create_method"
    : method === "POST" && /\/attach$/.test(path) ? "attach"
    : method === "GET" && path.startsWith("/v1/payment_intents/") ? "get_intent"
    : null;
  if (!op) throw new Error(`unexpected PayMongo call ${method} ${path}`);
  pm.calls.push(op);
  if (takeFault(op, "before")) net();

  const idemKey = key ? `${method} ${path} ${key}` : null;
  let json: any;
  if (idemKey && pm.idem.has(idemKey)) {
    // Documented: differing parameters under a reused key are rejected.
    if (pm.idemBodies.get(idemKey) !== init.body) {
      return { ok: false, status: 400, json: async () => ({ errors: [{ detail: "idempotency key reused with different parameters" }] }) };
    }
    json = pm.idem.get(idemKey);
  } else if (op === "create_intent") {
    const a = body.data.attributes;
    const pi = { id: `pi_${++pm.seq}`, amount: a.amount, currency: a.currency, status: "awaiting_payment_method", metadata: a.metadata, payments: [], code: null };
    pm.intents.set(pi.id, pi);
    json = intentJson(pi);
  } else if (op === "create_method") {
    const id = `pm_${++pm.seq}`;
    pm.methods.set(id, body);
    json = { data: { id, attributes: body.data.attributes } };
  } else if (op === "attach") {
    const pi = pm.intents.get(path.split("/")[3]);
    pi.status = "awaiting_next_action";
    pi.code = { data: `qr-for-${body.data.attributes.payment_method}`, image_url: null, expires_at: Math.floor(Date.now() / 1000) + 1800 };
    json = intentJson(pi);
  } else {
    const pi = pm.intents.get(path.split("/")[3]);
    if (!pi) return { ok: false, status: 404, json: async () => ({ errors: [{ detail: "not found" }] }) };
    json = intentJson(pi);
  }
  if (idemKey && !pm.idem.has(idemKey)) {
    pm.idem.set(idemKey, json);
    pm.idemBodies.set(idemKey, init.body);
  }
  if (takeFault(op, "after")) net(); // provider did the work; the response is lost
  return ok(structuredClone(json));
}

// ---------- helpers ----------
function req(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}
const createBody = (over: Record<string, unknown> = {}) => ({
  storeId: STORE, sessionId: SESSION, amount: 500, methodId: METHOD, tenderRequestId: "tr_1", ...over,
});
const create = (over: Record<string, unknown> = {}) => createQrPOST(req("http://x/api/pos/paymongo/create-qr", createBody(over)));
const intentCount = () => pm.intents.size;
const payable = () => [...pm.intents.values()].filter((p) => p.status === "awaiting_next_action");

function paidEvent(pi: string, over: { amount?: number | null; currency?: string | null; eventId?: string } = {}) {
  const attrs: Record<string, unknown> = { payment_intent_id: pi, status: "paid" };
  if (over.amount !== null) attrs.amount = over.amount ?? 50000;
  if (over.currency !== null) attrs.currency = over.currency ?? "PHP";
  return JSON.stringify({
    data: { id: over.eventId ?? "evt_1", attributes: { type: "payment.paid", data: { id: "pay_9", attributes: attrs } } },
  });
}
const hook = (body: string) =>
  webhookPOST(new Request("http://x/api/webhooks/paymongo", { method: "POST", headers: { "paymongo-signature": "t=1,te=aa" }, body }) as any);

beforeEach(() => {
  vi.useRealTimers();
  autoId = 0;
  failWrite = null;
  pm = { intents: new Map(), methods: new Map(), idem: new Map(), idemBodies: new Map(), seq: 0, calls: [], faults: [] };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  process.env.PAYMONGO_SECRET_KEY = "sk_test_fake";
  process.env.PAYMONGO_WEBHOOK_SECRET_POS = "whsec_test";
  docs = {
    "staff/uid_cashier": { role: "cashier", status: "active", assignedStoreIds: [STORE] },
    [`stores/${STORE}/sessions/${SESSION}`]: { status: "active", billingRevision: 3 },
    [`stores/${STORE}/storeConfig/current`]: {
      modesOfPayment: [{ id: METHOD, name: "QR Ph", gateway: "paymongo_qrph", isActive: true, isArchived: false }],
    },
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("B24: one logical attempt per tender", () => {
  it("binds the attempt to the operation id and billing revision and persists correlation before the provider call", async () => {
    let attemptAtCreate: any = null;
    pm.faults = [];
    const realFetch = fakeFetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      if (new URL(url).pathname === "/v1/payment_intents" && init?.method === "POST") attemptAtCreate = structuredClone(docs[ATTEMPT]);
      return realFetch(url, init);
    }));
    const res = await create();
    expect(res.status).toBe(200);
    expect(attemptAtCreate).toMatchObject({ state: "creating", operationId: "tr_1", billingRevision: 3 });
    expect(attemptAtCreate.idempotencyKey).toEqual(expect.any(String));
    const intent = [...pm.intents.values()][0];
    expect(intent.metadata).toMatchObject({ attemptId: `${SESSION}__${METHOD}__50000`, operationId: "tr_1", billingRevision: "3" });
    const body = await res.json();
    expect(docs[`stores/${STORE}/paymentIntents/${body.intentDocId}`]).toMatchObject({ billingRevision: 3, operationId: "tr_1", paymongoIntentId: intent.id });
  });

  it("repeated POST / lost response returns the same intent and never creates a second one", async () => {
    const r1 = await (await create()).json(); // response "lost" by the till
    const r2 = await (await create()).json();
    const r3 = await (await create({ tenderRequestId: "tr_2" })).json(); // re-mounted view, new op id
    expect(intentCount()).toBe(1);
    expect(r2).toMatchObject({ intentDocId: r1.intentDocId, paymongoIntentId: r1.paymongoIntentId, reused: true });
    expect(r3.intentDocId).toBe(r1.intentDocId);
  });

  it("rejects a client billing revision that no longer matches the session", async () => {
    const res = await create({ billingRevision: 2 });
    expect(res.status).toBe(409);
    expect(intentCount()).toBe(0);
  });
});

describe("B24: injected failures recover without orphaning an intent", () => {
  it("failure BEFORE provider create: retry creates exactly one intent", async () => {
    pm.faults = [{ op: "create_intent", when: "before" }];
    expect((await create()).status).toBe(502);
    expect(intentCount()).toBe(0);
    const r = await create();
    expect(r.status).toBe(200);
    expect(intentCount()).toBe(1);
  });

  it("lost response AFTER provider create: retry replays the same idempotency key and gets the same intent", async () => {
    pm.faults = [{ op: "create_intent", when: "after" }];
    expect((await create()).status).toBe(502);
    expect(intentCount()).toBe(1); // created at PayMongo, id never seen by us
    const r = await (await create()).json();
    expect(intentCount()).toBe(1);
    expect(r.paymongoIntentId).toBe("pi_1");
    expect(payable()).toHaveLength(1);
  });

  it("crash after create with the 'failed' mark also lost: stale creating lease is recovered after expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    pm.faults = [{ op: "create_method", when: "before" }];
    failWrite = (p, d) => p === ATTEMPT && d.state === "failed"; // process "dies" before releasing the lease
    expect((await create()).status).toBe(502);
    failWrite = null;
    expect(docs[ATTEMPT]).toMatchObject({ state: "creating", paymongoIntentId: "pi_1" });
    // Past the 45s lease: the next request takes over the SAME generation.
    vi.setSystemTime(1_800_000_000_000 + 60_000);
    const r = await create();
    expect(r.status).toBe(200);
    expect((await r.json()).paymongoIntentId).toBe("pi_1");
    expect(intentCount()).toBe(1);
  });

  it("failure persisting the provider id after create: retry still converges on the same intent", async () => {
    failWrite = (p, d) => p === ATTEMPT && !!d.paymongoIntentId && d.state !== "ready";
    expect((await create()).status).toBe(502);
    failWrite = null;
    const r = await (await create()).json();
    expect(r.paymongoIntentId).toBe("pi_1");
    expect(intentCount()).toBe(1);
  });

  it("lost response AFTER attach is reconciled in the same request via retrieve", async () => {
    pm.faults = [{ op: "attach", when: "after" }];
    const r = await create();
    expect(r.status).toBe(200);
    expect((await r.json()).qrData).toMatch(/^qr-for-pm_/);
    expect(pm.calls.filter((c) => c === "attach")).toHaveLength(1);
    expect(intentCount()).toBe(1);
  });

  it("lost response AFTER attach with retrieve also down: retry reconciles and does not attach again", async () => {
    pm.faults = [{ op: "attach", when: "after" }, { op: "get_intent", when: "before" }];
    expect((await create()).status).toBe(502);
    const attachesBefore = pm.calls.filter((c) => c === "attach").length;
    const r = await (await create()).json();
    expect(r.paymongoIntentId).toBe("pi_1");
    expect(r.qrData).toMatch(/^qr-for-pm_/);
    expect(pm.calls.filter((c) => c === "attach").length).toBe(attachesBefore);
    expect(intentCount()).toBe(1);
  });

  it("failure on the bridge/index commit: retry resumes the saved intent and commits once", async () => {
    failWrite = (p) => p.startsWith("paymongoIntentIndex/");
    expect((await create()).status).toBe(503);
    failWrite = null;
    expect(Object.keys(docs).some((p) => p.startsWith(`stores/${STORE}/paymentIntents/`))).toBe(false); // atomic: no bridge either
    const r = await (await create()).json();
    expect(r.paymongoIntentId).toBe("pi_1");
    expect(docs[`paymongoIntentIndex/pi_1`]).toMatchObject({ storeId: STORE, intentDocId: r.intentDocId });
    expect(intentCount()).toBe(1);
  });

  it("lost response after the bridge/index commit: retry reuses the committed bridge", async () => {
    const r1 = await (await create()).json();
    const calls = pm.calls.length;
    const r2 = await (await create()).json();
    expect(r2).toMatchObject({ intentDocId: r1.intentDocId, reused: true });
    expect(pm.calls.length).toBe(calls); // no provider traffic at all
  });

  it("ignores a forged attempt doc pointing at a foreign intent", async () => {
    // A foreign (e.g. another store's) intent exists at PayMongo.
    pm.intents.set("pi_foreign", { id: "pi_foreign", amount: 50000, currency: "PHP", status: "succeeded", metadata: { kind: "pos_session", storeId: "store_b", intentDocId: "x" }, payments: [], code: null });
    docs[ATTEMPT] = { state: "failed", failureKind: "ambiguous", intentDocId: "forged", startedAtMs: Date.now(), generationStartedAtMs: Date.now(), sessionId: SESSION, methodId: METHOD, amountCentavos: 50000, generation: 1, idempotencyKey: "k", paymongoIntentId: "pi_foreign", attachNo: 0 };
    const res = await create();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymongoIntentId).not.toBe("pi_foreign");
    expect(docs[`paymongoIntentIndex/pi_foreign`]).toBeUndefined();
  });
});

describe("B24 review: an intent already being paid never gets a second QR", () => {
  /** First tap: intent created, method step fails; customer somehow pays → PayMongo says succeeded/processing. */
  async function qrLessBridge(status: "succeeded" | "processing") {
    pm.faults = [{ op: "create_method", when: "before" }];
    expect((await create()).status).toBe(502);
    pm.intents.get("pi_1").status = status;
    const res = await create();
    expect(res.status).toBe(409);
    return (await res.json()).intentDocId as string;
  }

  it.each(["succeeded", "processing"] as const)("next tap after a %s intent is refused, not a new generation", async (status) => {
    const intentDocId = await qrLessBridge(status);
    for (let i = 0; i < 2; i++) {
      const again = await create();
      expect(again.status).toBe(409);
      expect((await again.json()).intentDocId).toBe(intentDocId);
    }
    expect(intentCount()).toBe(1);
    expect(pm.calls.filter((c) => c === "create_intent")).toHaveLength(1);
  });

  it("a QR-less bridge whose intent now carries a QR is re-checked and handed out", async () => {
    const intentDocId = await qrLessBridge("processing");
    const pi = pm.intents.get("pi_1");
    pi.status = "awaiting_next_action";
    pi.code = { data: "qr-recovered", image_url: null, expires_at: Math.floor(Date.now() / 1000) + 1800 };
    const res = await create();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ intentDocId, qrData: "qr-recovered", paymongoIntentId: "pi_1" });
    expect(intentCount()).toBe(1);
  });

  it("a QR-less bridge is refused (409) when PayMongo cannot be reached", async () => {
    await qrLessBridge("processing");
    pm.faults = [{ op: "get_intent", when: "before" }];
    expect((await create()).status).toBe(409);
    expect(intentCount()).toBe(1);
  });

  it("a QR-less bridge whose intent was cancelled lets a fresh attempt start", async () => {
    const intentDocId = await qrLessBridge("processing");
    pm.intents.get("pi_1").status = "cancelled";
    const res = await create();
    expect(res.status).toBe(200);
    expect(docs[`stores/${STORE}/paymentIntents/${intentDocId}`].status).toBe("canceled");
    expect(intentCount()).toBe(2);
  });
});

describe("B24 review: idempotency key survives a deleted attempt doc", () => {
  it("a recreated attempt (generation counter restarted) does not reuse the old key", async () => {
    expect((await create()).status).toBe(200);
    delete docs[ATTEMPT];
    for (const p of Object.keys(docs)) if (p.startsWith(`stores/${STORE}/paymentIntents/`)) delete docs[p];
    const res = await create();
    expect(res.status).toBe(200); // same key + new intentDocId would be rejected (400 → 502)
    expect(docs[ATTEMPT].nonce).toEqual(expect.any(String));
  });
});

describe("B24: webhook validates and never loses a paid event", () => {
  it("early webhook (intent created, bridge not yet committed) is redelivered, then settles once", async () => {
    pm.faults = [{ op: "create_method", when: "before" }];
    expect((await create()).status).toBe(502);
    expect((await hook(paidEvent("pi_1"))).status).toBe(503); // not acknowledged
    const r = await (await create()).json();
    expect((await hook(paidEvent("pi_1"))).status).toBe(200);
    const bridgePath = `stores/${STORE}/paymentIntents/${r.intentDocId}`;
    expect(docs[bridgePath]).toMatchObject({ status: "paid", paymongoPaymentId: "pay_9", processedEventIds: ["evt_1"] });
    const before = structuredClone(docs[bridgePath]);
    expect((await hook(paidEvent("pi_1"))).status).toBe(200); // redelivery: no second transition
    expect(docs[bridgePath]).toEqual(before);
  });

  it.each([
    ["wrong amount", { amount: 100 }],
    ["missing amount", { amount: null }],
    ["wrong currency", { currency: "USD" }],
    ["missing currency", { currency: null }],
  ] as const)("%s does not settle and is retained for review/retry", async (_l, over) => {
    const r = await (await create()).json();
    const res = await hook(paidEvent("pi_1", over as any));
    expect(res.status).toBe(503);
    const bridgePath = `stores/${STORE}/paymentIntents/${r.intentDocId}`;
    expect(docs[bridgePath].status).toBe("awaiting_payment");
    expect(docs[bridgePath].processedEventIds).toEqual([]);
    expect(docs[`${bridgePath}/webhookReviews/evt_1`]).toMatchObject({ eventId: "evt_1", paymongoIntentId: "pi_1", expectedAmountCentavos: 50000 });
  });

  it("correct event settles exactly once", async () => {
    const r = await (await create()).json();
    expect((await hook(paidEvent("pi_1"))).status).toBe(200);
    expect((await hook(paidEvent("pi_1", { eventId: "evt_2" }))).status).toBe(200);
    const bridge = docs[`stores/${STORE}/paymentIntents/${r.intentDocId}`];
    expect(bridge.status).toBe("paid");
    expect(bridge.processedEventIds).toEqual(["evt_1"]);
  });

  it("an index whose bridge is missing asks for redelivery instead of acknowledging", async () => {
    docs["paymongoIntentIndex/pi_ghost"] = { storeId: STORE, intentDocId: "nope", sessionId: SESSION };
    expect((await hook(paidEvent("pi_ghost"))).status).toBe(503);
  });

  it("status poll settles conditionally: a bridge changed meanwhile is not overwritten", async () => {
    const r = await (await create()).json();
    const bridgePath = `stores/${STORE}/paymentIntents/${r.intentDocId}`;
    pm.intents.get("pi_1").status = "succeeded";
    // The bridge is cancelled between the route's first read and its write.
    const realFetch = fakeFetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      docs[bridgePath] = { ...docs[bridgePath], status: "canceled" };
      return realFetch(url, init);
    }));
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: SESSION, intentDocId: r.intentDocId }));
    expect((await res.json()).status).toBe("canceled");
    expect(docs[bridgePath].status).toBe("canceled");
  });

  it("status poll settles a matching intent once", async () => {
    const r = await (await create()).json();
    pm.intents.get("pi_1").status = "succeeded";
    pm.intents.get("pi_1").payments = [{ id: "pay_poll" }];
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: SESSION, intentDocId: r.intentDocId }));
    expect((await res.json()).status).toBe("paid");
    expect(docs[`stores/${STORE}/paymentIntents/${r.intentDocId}`]).toMatchObject({ status: "paid", paymongoPaymentId: "pay_poll", qrData: expect.any(String) });
  });

  it("status poll does not settle when the provider amount differs from the bridge", async () => {
    const r = await (await create()).json();
    const pi = pm.intents.get("pi_1");
    pi.status = "succeeded";
    pi.amount = 100;
    const res = await statusPOST(req("http://x/api/pos/paymongo/status", { storeId: STORE, sessionId: SESSION, intentDocId: r.intentDocId }));
    expect((await res.json()).status).toBe("awaiting_payment");
    expect(docs[`stores/${STORE}/paymentIntents/${r.intentDocId}`].status).toBe("awaiting_payment");
  });
});
