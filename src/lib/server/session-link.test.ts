import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

import {
  isSessionCashierLinked,
  linkCardToSession,
  readSessionLink,
  redeemGate,
  CASHIER_LINK_NO_REDEEM_ERROR,
  REDEEM_PHONE_MISMATCH_ERROR,
} from "./session-link";

const STORE = "storeA";
const SID = "sess1";
const PHONE = "+639171234567";
const ACTIVE = `stores/${STORE}/activeSessions/${SID}`;
const SESSION = `stores/${STORE}/sessions/${SID}`;
const CUSTOMER = `customers/${PHONE}`;

let docs: Record<string, any>;
let writes: Array<{ path: string; data: any }>;

function fakeDb() {
  const ref = (path: string) => ({
    path,
    get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
  });
  return {
    doc: ref,
    runTransaction: async (fn: (tx: any) => Promise<any>) =>
      fn({
        get: async (r: any) => ({ exists: docs[r.path] !== undefined, data: () => docs[r.path] }),
        update: (r: any, data: any) => {
          writes.push({ path: r.path, data });
          docs[r.path] = { ...docs[r.path], ...data };
        },
      }),
  } as any;
}

const args = { storeId: STORE, sessionId: SID, phone: PHONE, staffUid: "cashier_1" };

beforeEach(() => {
  writes = [];
  docs = {
    [ACTIVE]: { status: "active", isPaid: false },
    [SESSION]: { status: "active" },
    [CUSTOMER]: { name: "Maria Santos", pointsBalance: 120 },
  };
});

describe("linkCardToSession", () => {
  it("links an unlinked open session and writes both docs", async () => {
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toEqual({ ok: true, phone: PHONE, name: "Maria Santos", pointsBalance: 120, alreadyLinked: false });
    expect(writes.map((w) => w.path).sort()).toEqual([ACTIVE, SESSION].sort());
    for (const w of writes) {
      expect(w.data).toMatchObject({
        linkedCustomerPhone: PHONE,
        linkedCustomerName: "Maria Santos",
        linkedByParticipantId: null,
        linkedBy: "cashier",
        linkedByUid: "cashier_1",
      });
      expect(w.data.linkedAt).toEqual({ __sentinel: "serverTimestamp" });
    }
  });

  it("is idempotent for the same phone (no second write)", async () => {
    await linkCardToSession(fakeDb(), args);
    writes = [];
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toMatchObject({ ok: true, alreadyLinked: true });
    expect(writes).toHaveLength(0);
  });

  it("409 when already linked to a different card, and writes nothing", async () => {
    docs[ACTIVE].linkedCustomerPhone = "+639998887777";
    docs[ACTIVE].linkedCustomerName = "Jose Reyes";
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toEqual({ ok: false, status: 409, error: "Session already linked to Jose Reyes." });
    expect(writes).toHaveLength(0);
  });

  it("409 when the session is locked or paid", async () => {
    docs[ACTIVE].linkedCustomerLockedAt = { seconds: 1 };
    expect(await linkCardToSession(fakeDb(), args)).toMatchObject({ ok: false, status: 409 });
    docs[ACTIVE] = { isPaid: true };
    expect(await linkCardToSession(fakeDb(), args)).toMatchObject({ ok: false, status: 409 });
    expect(writes).toHaveLength(0);
  });

  it("404 when the session is gone (closed projection deleted)", async () => {
    delete docs[ACTIVE];
    expect(await linkCardToSession(fakeDb(), args)).toMatchObject({ ok: false, status: 404 });
    expect(writes).toHaveLength(0);
  });

  it("404 when no customer account exists for the phone", async () => {
    delete docs[CUSTOMER];
    expect(await linkCardToSession(fakeDb(), args)).toEqual({
      ok: false, status: 404, error: "No Sharelebrator account for that number.",
    });
    expect(writes).toHaveLength(0);
  });

  it("still links when the sessions doc is missing", async () => {
    delete docs[SESSION];
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toMatchObject({ ok: true });
    expect(writes.map((w) => w.path)).toEqual([ACTIVE]);
  });
});

describe("isSessionCashierLinked", () => {
  it("true when the activeSessions doc was linked by a cashier", async () => {
    await linkCardToSession(fakeDb(), args);
    expect(await isSessionCashierLinked(fakeDb(), STORE, SID)).toBe(true);
  });
  it("false for a customer-linked or unlinked session", async () => {
    expect(await isSessionCashierLinked(fakeDb(), STORE, SID)).toBe(false);
    docs[ACTIVE].linkedCustomerPhone = PHONE;
    docs[ACTIVE].linkedBy = "participant";
    expect(await isSessionCashierLinked(fakeDb(), STORE, SID)).toBe(false);
  });
  it("false when the session doc is gone", async () => {
    delete docs[ACTIVE];
    expect(await isSessionCashierLinked(fakeDb(), STORE, SID)).toBe(false);
  });
});

describe("readSessionLink", () => {
  it("reports a missing session as not existing", async () => {
    delete docs[ACTIVE];
    expect((await readSessionLink(fakeDb(), STORE, SID)).exists).toBe(false);
  });
  it("returns the linked phone and linkedBy from the activeSessions doc", async () => {
    docs[ACTIVE].linkedCustomerPhone = PHONE;
    docs[ACTIVE].linkedBy = "participant";
    expect(await readSessionLink(fakeDb(), STORE, SID)).toMatchObject({
      exists: true,
      linkedCustomerPhone: PHONE,
      linkedBy: "participant",
    });
  });
});

describe("redeemGate", () => {
  const diner = { exists: true, linkedCustomerPhone: PHONE, linkedBy: "participant" };

  it("404 when the session is missing or closed", () => {
    expect(redeemGate({ exists: false }, PHONE)).toEqual({
      ok: false, status: 404, error: "Session not found or already closed.",
    });
  });
  it("403 no-redeem when cashier-linked, even if the phone matches", () => {
    expect(redeemGate({ ...diner, linkedBy: "cashier" }, PHONE)).toEqual({
      ok: false, status: 403, error: CASHIER_LINK_NO_REDEEM_ERROR,
    });
  });
  it("ok when diner-linked and the phone is the same", () => {
    expect(redeemGate(diner, PHONE)).toEqual({ ok: true });
  });
  it("ok when the same phone arrives in a different format", () => {
    expect(redeemGate(diner, "09171234567")).toEqual({ ok: true });
    expect(redeemGate({ ...diner, linkedCustomerPhone: "09171234567" }, PHONE)).toEqual({ ok: true });
  });
  it("403 mismatch for a different customer's phone", () => {
    expect(redeemGate(diner, "+639998887777")).toEqual({
      ok: false, status: 403, error: REDEEM_PHONE_MISMATCH_ERROR,
    });
  });
  it("403 mismatch when the session has no linked phone", () => {
    expect(redeemGate({ exists: true }, PHONE)).toMatchObject({ ok: false, status: 403, error: REDEEM_PHONE_MISMATCH_ERROR });
    expect(redeemGate({ exists: true, linkedCustomerPhone: null }, PHONE)).toMatchObject({ ok: false, status: 403 });
    expect(redeemGate({ exists: true, linkedCustomerPhone: "" }, "")).toMatchObject({ ok: false, status: 403 });
  });
  it("403 mismatch for a garbage phone (null normalization never matches)", () => {
    expect(redeemGate(diner, "not-a-phone")).toMatchObject({ ok: false, status: 403, error: REDEEM_PHONE_MISMATCH_ERROR });
    // garbage on both sides must not "match" as null === null
    expect(redeemGate({ ...diner, linkedCustomerPhone: "garbage" }, "also-garbage")).toMatchObject({
      ok: false, status: 403, error: REDEEM_PHONE_MISMATCH_ERROR,
    });
  });
});
