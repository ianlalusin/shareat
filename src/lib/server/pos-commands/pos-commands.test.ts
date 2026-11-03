import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", async () => (await import("../analytics/testing/fakeFirestore")).firestoreModule);
vi.mock("server-only", () => ({}));

import { FakeFirestore } from "../analytics/testing/fakeFirestore";
import { runCheckout, parseCheckoutInput, type CheckoutInput } from "./checkout";
import { runVoidSession } from "./void-session";
import { resolveOperator, type Operator } from "./operator";
import { processEffects, queueEffectsInTx } from "./effects";
import { reconcileCommand, sweepStore, type OfflineCommand } from "./reconcile";
import { runReceiptEdit, runReceiptVoid, runRefund } from "./receipt-commands";
import { PosCommandError } from "./errors";
import { issueProfileSession } from "../server-profile-session";

/**
 * Server transaction tests for the P1 financial commands (audit B01, B03, B16,
 * B17, NOV-RECEIPTS). FakeFirestore runs optimistic transactions (reads are
 * re-validated at commit and the attempt re-runs on conflict), so concurrent
 * commands race the way they do against real Firestore.
 */

const S = "storeA";
const KEY = Buffer.from("k".repeat(32));
const CASHIER: Operator = { uid: "u_cashier", username: "Ana", profileId: "p_ana", verified: true };
const NOW = 1_800_000_000_000;

let db: FakeFirestore;
const D = () => db as any;

function seedSession(sessionId = "s1", tableId: string | null = "t1", extra: Record<string, unknown> = {}) {
  db.seed(`stores/${S}/sessions/${sessionId}`, {
    status: "active", tableId: tableId ?? "alacarte", tableNumber: "1", sessionMode: tableId ? "package_dinein" : "alacarte",
    billingRevision: 3, revision: 1, startedAtClientMs: NOW - 3600_000, ...extra,
  });
  db.seed(`stores/${S}/sessions/${sessionId}/sessionBillLines/package_pk1`, {
    type: "package", itemId: "pk1", itemName: "Unli", qtyOrdered: 2, unitPrice: 500, createdAt: 1,
  });
  db.seed(`stores/${S}/sessions/${sessionId}/sessionBillLines/addon_coke_60.5`, {
    type: "addon", itemId: "coke", itemName: "Coke", qtyOrdered: 1, unitPrice: 60.5, createdAt: 2,
  });
  db.seed(`stores/${S}/activeSessions/${sessionId}`, { status: "active", customerPin: "123456", tableId });
  db.seed(`stores/${S}/sessions/${sessionId}/kitchentickets/k1`, { status: "preparing", kitchenLocationId: "hot", qtyOrdered: 1, createdAtClientMs: NOW - 60_000 });
  if (tableId) {
    db.seed(`stores/${S}/tables/${tableId}`, { status: "occupied", currentSessionId: sessionId });
    db.seed(`stores/${S}/storeConfig/current/tables/${tableId}`, { status: "occupied", currentSessionId: sessionId });
  }
}

beforeEach(() => {
  db = new FakeFirestore();
  db.seed(`stores/${S}`, { name: "A", code: "SHT" });
  db.seed(`stores/${S}/storeConfig/current`, {
    modesOfPayment: [
      { id: "cash", name: "Cash", type: "cash", isActive: true },
      { id: "gcash", name: "GCash", type: "ewallet", isActive: true },
      { id: "qr", name: "QR Ph", type: "ewallet", isActive: true, gateway: "paymongo_qrph" },
    ],
    packages: [{ packageId: "pk1", packageName: "Unli", pricePerHead: 500 }],
  });
  db.seed(`stores/${S}/inventory/coke`, { displayName: "Coke", sellingPrice: 60.5 });
  db.seed(`stores/${S}/inventory/inv_wings`, { displayName: "Wings", productId: "prod_wings", sellingPrice: 200 });
  db.seed(`staff/u_server`, { role: "server", status: "active", assignedStoreIds: [S], name: "srv" });
  db.seed(`stores/${S}/receiptSettings/main`, { receiptNoFormat: "SHT-######" });
  db.seed(`stores/${S}/counters/receipts`, { seq: 41 });
  db.seed(`staff/u_cashier`, { role: "cashier", status: "active", assignedStoreIds: [S], name: "tablet" });
  db.seed(`staff/u_manager`, { role: "manager", status: "active", assignedStoreIds: [S], name: "Mgr" });
  db.seed(`stores/${S}/serverProfiles/p_ana`, { name: "Ana" });
  seedSession();
});

const input = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  storeId: S, sessionId: "s1", opId: "op1", billingRevision: 3, expectedTotalCents: 106050,
  payments: [{ methodId: "cash", amount: 1100 }], ...over,
});

const bridge = (over: Record<string, unknown> = {}) => ({
  storeId: S, sessionId: "s1", provider: "paymongo_qrph", status: "paid", methodId: "qr",
  amountCentavos: 50000, amount: 500, paymongoIntentId: "pi_1", paymongoPaymentId: "pay_1", ...over,
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: any) => e instanceof PosCommandError && e.code === code);
}

describe("online checkout (B01)", () => {
  it("recomputes the total server-side and writes the canonical receipt, close, release, effects", async () => {
    const out = await runCheckout(D(), input(), CASHIER, NOW);
    expect(out).toMatchObject({ status: "accepted", replay: false, receiptNumber: "SHT-000042", totalCents: 106050, tableReleased: true });
    const r = db.data(`stores/${S}/receipts/s1`);
    expect(r).toMatchObject({ total: 1060.5, totalPaid: 1100, change: 39.5, status: "final", commandId: "op1", createdByUsername: "Ana", operatorProfileId: "p_ana", operatorVerified: true, analyticsApplied: false });
    expect(r.analytics.mop).toEqual({ Cash: 1060.5 });
    expect(r.analytics.salesByItem.Unli).toEqual({ qty: 2, amount: 1000, categoryName: "Uncategorized" });
    expect(db.data(`stores/${S}/counters/receipts`).seq).toBe(42);
    expect(db.data(`stores/${S}/sessions/s1`)).toMatchObject({ status: "closed", isPaid: true, revision: 2, closedByCommandId: "op1" });
    expect(db.data(`stores/${S}/tables/t1`)).toMatchObject({ status: "available", currentSessionId: null });
    expect(db.data(`stores/${S}/activeSessions/s1`)).toBeUndefined();
    expect(db.data(`stores/${S}/sessions/s1/kitchentickets/k1`).status).toBe("served");
    expect(db.data(`stores/${S}/posEffects/s1__pinFinalize`)).toMatchObject({ status: "pending", payload: { pin: "123456", reason: "payment_closed" } });
    expect(db.data(`stores/${S}/posEffects/s1__analytics`)).toMatchObject({ status: "pending", payload: { op: "payment", receiptId: "s1" } });
    expect(db.data(`stores/${S}/posCommandResults/op1`)).toMatchObject({ status: "accepted", receiptNumber: "SHT-000042" });
  });

  it("refuses a client total that does not match the bill (forged / stale total)", async () => {
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100 }), CASHIER, NOW), "total_mismatch");
    expect(db.data(`stores/${S}/receipts/s1`)).toBeUndefined();
  });

  it("refuses a stale bill revision", async () => {
    await expectCode(runCheckout(D(), input({ billingRevision: 2 }), CASHIER, NOW), "bill_changed");
  });

  it("refuses non-finite, fractional-centavo, string and negative tenders", () => {
    for (const amount of [NaN, Infinity, 0.001, 10.005, "100", -5, 0]) {
      expect(() => parseCheckoutInput({ ...input(), payments: [{ methodId: "cash", amount }] })).toThrow(PosCommandError);
    }
    expect(parseCheckoutInput({ ...input(), payments: [{ methodId: "cash", amount: 0.1 + 0.2 }] }).payments[0].amount).toBe(0.3);
  });

  it("refuses underpayment and change without cash", async () => {
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "cash", amount: 1000 }] }), CASHIER, NOW), "tender_invalid");
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "gcash", amount: 1100, reference: "x" }] }), CASHIER, NOW), "tender_invalid");
  });

  it("retry with the same opId replays the outcome without a second receipt number", async () => {
    const a = await runCheckout(D(), input(), CASHIER, NOW);
    const b = await runCheckout(D(), input(), CASHIER, NOW + 5);
    expect(b).toMatchObject({ replay: true, receiptNumber: a.receiptNumber });
    expect(db.data(`stores/${S}/counters/receipts`).seq).toBe(42);
  });

  it("two terminals settling one session concurrently: exactly one receipt", async () => {
    const results = await Promise.allSettled([
      runCheckout(D(), input({ opId: "tillA" }), CASHIER, NOW),
      runCheckout(D(), input({ opId: "tillB", payments: [{ methodId: "cash", amount: 1060.5 }] }), CASHIER, NOW),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as PosCommandError).code).toBe("already_settled");
    expect(db.data(`stores/${S}/counters/receipts`).seq).toBe(42);
    expect(Object.keys(db.snapshot((p) => !p.includes("/sessions/s1/payments/")))).toBeTruthy();
    const payments = Object.keys(db.snapshot()).filter((p) => p.includes("/sessions/s1/payments/"));
    expect(payments).toHaveLength(1);
  });
});

describe("gateway tenders (B03)", () => {
  const split = (over: Record<string, unknown> = {}) =>
    input({ payments: [{ methodId: "qr", amount: 500, reference: "pay_1", intentDocId: "b1", ...over }, { methodId: "cash", amount: 600 }] });

  it("split tender: verifies the paid bridge and consumes it for this receipt", async () => {
    db.seed(`stores/${S}/paymentIntents/b1`, bridge());
    const out = await runCheckout(D(), split(), CASHIER, NOW);
    expect(out.status).toBe("accepted");
    expect(db.data(`stores/${S}/paymentIntents/b1`)).toMatchObject({ consumedByReceiptId: "s1", consumedByCommandId: "op1", consumedAtMs: NOW });
    expect(db.data(`stores/${S}/receipts/s1`).analytics.mop).toEqual({ "QR Ph": 500, Cash: 560.5 });
  });

  it("forged tender with no bridge doc fails", async () => {
    await expectCode(runCheckout(D(), split(), CASHIER, NOW), "gateway_invalid");
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "qr", amount: 1060.5, reference: "pay_x" }] }), CASHIER, NOW), "gateway_invalid");
  });

  it.each([
    ["unpaid", { status: "awaiting_payment" }],
    ["wrong store", { storeId: "storeB" }],
    ["wrong session", { sessionId: "s2" }],
    ["wrong amount", { amountCentavos: 40000 }],
    ["wrong provider", { provider: "stripe" }],
    ["wrong currency", { currency: "USD" }],
    ["wrong bill revision", { billingRevision: 2 }],
    ["wrong reference", { paymongoPaymentId: "pay_other" }],
  ])("%s bridge fails", async (_label, over) => {
    db.seed(`stores/${S}/paymentIntents/b1`, bridge(over));
    await expectCode(runCheckout(D(), split(), CASHIER, NOW), "gateway_invalid");
    expect(db.data(`stores/${S}/receipts/s1`)).toBeUndefined();
  });

  it("a bridge consumed by another receipt cannot be reused", async () => {
    db.seed(`stores/${S}/paymentIntents/b1`, bridge({ consumedByReceiptId: "s_other", consumedByCommandId: "op_other" }));
    await expectCode(runCheckout(D(), split(), CASHIER, NOW), "gateway_consumed");
  });

  it("one paid QR cannot settle a second session", async () => {
    db.seed(`stores/${S}/paymentIntents/b1`, bridge());
    await runCheckout(D(), split(), CASHIER, NOW);
    seedSession("s2", "t2");
    db.seed(`stores/${S}/paymentIntents/b1`, { ...db.data(`stores/${S}/paymentIntents/b1`), sessionId: "s2" }); // even if relinked
    await expectCode(
      runCheckout(D(), input({ sessionId: "s2", opId: "op2", payments: [{ methodId: "qr", amount: 500, reference: "pay_1", intentDocId: "b1" }, { methodId: "cash", amount: 600 }] }), CASHIER, NOW),
      "gateway_consumed",
    );
  });
});

describe("operator attribution (P1 + F02)", () => {
  const token = (iat: number) => issueProfileSession({ uid: "u_cashier", storeId: S, profileId: "p_ana" }, { now: iat, key: KEY })!.token;
  const ctx = { uid: "u_cashier", role: "cashier", isPlatformAdmin: false, storeId: S, key: KEY, now: NOW };

  it("verified token -> profile name; missing/forged token -> refused for cashier", async () => {
    await expect(resolveOperator(D(), { ...ctx, token: token(NOW - 1000) })).resolves.toMatchObject({ username: "Ana", profileId: "p_ana", verified: true });
    await expectCode(resolveOperator(D(), { ...ctx, token: null }), "operator_session_required");
    await expectCode(resolveOperator(D(), { ...ctx, token: token(NOW).replace(/.$/, "x") }), "operator_session_required");
  });

  it("manager without a token falls back to the account (not a client-supplied name)", async () => {
    await expect(resolveOperator(D(), { ...ctx, uid: "u_manager", role: "manager", token: null })).resolves.toMatchObject({ username: "Mgr", verified: false, profileId: null });
  });

  it("offline rule: expired-now token accepted when the command was recorded while it was valid", async () => {
    const t = token(NOW - 20 * 3600_000); // 16h TTL -> expired now
    await expectCode(resolveOperator(D(), { ...ctx, token: t }), "operator_session_required");
    await expect(resolveOperator(D(), { ...ctx, token: t, commandAtMs: NOW - 19 * 3600_000 })).resolves.toMatchObject({ verified: true });
    await expectCode(resolveOperator(D(), { ...ctx, token: t, commandAtMs: NOW - 21 * 3600_000 }), "operator_session_invalid");
    await expectCode(resolveOperator(D(), { ...ctx, token: t, commandAtMs: NOW + 3600_000 }), "operator_session_invalid");
  });
});

function offlineCommand(over: Partial<OfflineCommand> = {}, iat = NOW - 600_000): OfflineCommand {
  return {
    schema: 1, opId: "off1", kind: "checkout", storeId: S, sessionId: "s1", terminalId: "dev1", resolved: false,
    createdByUid: "u_cashier", clientCreatedAtMs: NOW - 300_000,
    operatorSessionToken: issueProfileSession({ uid: "u_cashier", storeId: S, profileId: "p_ana" }, { now: iat, key: KEY })!.token,
    expected: { sessionRevision: 1, billingRevision: 3, tableId: "t1", totalCents: 106050 },
    payload: { payments: [{ methodId: "cash", amount: 1100 }], receiptNumber: "SHT-OL-AB12-0320-001", receiptSeq: 1 },
    ...over,
  };
}
const staffCaller = { type: "staff" as const, uid: "u_cashier", role: "cashier", isPlatformAdmin: false };
const managerCaller = { type: "staff" as const, uid: "u_manager", role: "manager", isPlatformAdmin: false };

describe("offline commands (B16)", () => {
  it("accepted on reconnect: canonical receipt keeps the printed OL number", async () => {
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand());
    const r = await reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY });
    expect(r).toMatchObject({ status: "accepted", receiptNumber: "SHT-OL-AB12-0320-001", tableReleased: true });
    expect(db.data(`stores/${S}/receipts/s1`)).toMatchObject({ offlineOrigin: true, offlineCommandId: "off1", receiptNoFormatUsed: "OL", createdByUsername: "Ana" });
    expect(db.data(`stores/${S}/counters/receipts`).seq).toBe(41); // OL numbers never consume the online sequence
  });

  it("an old session reconnecting after the table was reseated never clears the new seating", async () => {
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand());
    db.seed(`stores/${S}/tables/t1`, { status: "occupied", currentSessionId: "s_new" });
    db.seed(`stores/${S}/storeConfig/current/tables/t1`, { status: "occupied", currentSessionId: "s_new" });
    const r = await reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY });
    expect(r).toMatchObject({ status: "accepted", tableReleased: false });
    expect(db.data(`stores/${S}/tables/t1`)).toMatchObject({ status: "occupied", currentSessionId: "s_new" });
    expect(db.data(`stores/${S}/storeConfig/current/tables/t1`)).toMatchObject({ currentSessionId: "s_new" });
  });

  it("session settled on another terminal during the outage -> rejected, recoverable, visible", async () => {
    await runCheckout(D(), input({ opId: "online1" }), CASHIER, NOW - 100_000);
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand());
    const r = await reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY });
    expect(r).toMatchObject({ status: "rejected", code: "already_settled" });
    expect(db.data(`stores/${S}/posCommandResults/off1`)).toMatchObject({ status: "rejected", code: "already_settled", attempts: 1 });
    expect(db.data(`stores/${S}/receipts/s1`).commandId).toBe("online1");
    // Recoverable: stays rejected until a manager explicitly retries or dismisses.
    await expect(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY })).resolves.toMatchObject({ status: "rejected" });
    await expectCode(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller, action: "dismiss", note: "x" }, { now: NOW, key: KEY }), "forbidden");
    await expect(
      reconcileCommand(D(), { storeId: S, opId: "off1", caller: managerCaller, action: "dismiss", note: "Refunded customer" }, { now: NOW, key: KEY }),
    ).resolves.toMatchObject({ status: "dismissed" });
    expect(db.data(`stores/${S}/posCommandResults/off1`).previous.code).toBe("already_settled");
  });

  it("bill edited on another till while offline -> rejected (session_changed / bill_changed)", async () => {
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand({ expected: { sessionRevision: 1, billingRevision: 2, tableId: "t1", totalCents: 106050 } }));
    await expect(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY })).resolves.toMatchObject({ code: "bill_changed" });
  });

  it("sync denial / never synced: the till's localStorage copy is persisted and applied once", async () => {
    const cmd = offlineCommand();
    const r = await reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller, bodyCommand: cmd }, { now: NOW, key: KEY });
    expect(r.status).toBe("accepted");
    expect(db.data(`stores/${S}/posCommands/off1`)).toMatchObject({ opId: "off1", persistedBy: "reconcile" });
    const again = await reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller, bodyCommand: cmd }, { now: NOW + 1, key: KEY });
    expect(again).toMatchObject({ status: "accepted", replay: true });
  });

  it("another account cannot submit someone else's command body", async () => {
    await expectCode(
      reconcileCommand(D(), { storeId: S, opId: "off1", caller: { ...staffCaller, uid: "u_other" }, bodyCommand: offlineCommand() }, { now: NOW, key: KEY }),
      "forbidden",
    );
  });

  it("a command whose operator token was forged is rejected", async () => {
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand({ operatorSessionToken: "abc.def" }));
    await expect(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY })).resolves.toMatchObject({
      status: "rejected", code: "operator_session_required",
    });
  });

  it("crash before the till submitted: the cron sweep applies the command after the grace period", async () => {
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand());
    const runner = vi.fn(async () => {});
    const out = await sweepStore(D(), S, runner, { now: NOW, key: KEY });
    expect(out.accepted).toBe(1);
    expect(db.data(`stores/${S}/receipts/s1`).offlineCommandId).toBe("off1");
    expect(runner).toHaveBeenCalled();
    expect(db.data(`stores/${S}/posEffects/s1__analytics`).status).toBe("done");
  });

  it("offline void after the bill was paid elsewhere is rejected; open session voids", async () => {
    db.seed(`stores/${S}/posCommands/v1`, offlineCommand({ opId: "v1", kind: "voidSession", payload: { reason: "walkout" } }));
    const ok = await reconcileCommand(D(), { storeId: S, opId: "v1", caller: staffCaller }, { now: NOW, key: KEY });
    expect(ok).toMatchObject({ status: "accepted", tableReleased: true });
    expect(db.data(`stores/${S}/sessions/s1`)).toMatchObject({ status: "voided", voidedByCommandId: "v1", offlineOrigin: true });
    expect(db.data(`stores/${S}/posEffects/void_s1__pinFinalize`)).toMatchObject({ status: "pending", payload: { reason: "session_voided" } });

    seedSession("s2", "t2");
    await runCheckout(D(), input({ sessionId: "s2", opId: "pay2" }), CASHIER, NOW);
    db.seed(`stores/${S}/posCommands/v2`, offlineCommand({ opId: "v2", kind: "voidSession", sessionId: "s2", payload: { reason: "x" } }));
    await expect(reconcileCommand(D(), { storeId: S, opId: "v2", caller: staffCaller }, { now: NOW, key: KEY })).resolves.toMatchObject({ code: "already_settled" });
  });
});

describe("deferred effects outbox (B17)", () => {
  it("an effect failure leaves it pending with attempts; a later run completes it", async () => {
    const out = await runCheckout(D(), input(), CASHIER, NOW);
    let fail = true;
    const runner = vi.fn(async () => { if (fail) throw new Error("loyalty api down"); });
    const first = await processEffects(D(), S, out.effectIds, runner, NOW);
    expect(first.done).toBe(0);
    expect(db.data(`stores/${S}/posEffects/s1__loyaltyFinalize`)).toMatchObject({ status: "pending", attempts: 1, lastError: "loyalty api down" });
    fail = false;
    const second = await processEffects(D(), S, out.effectIds, runner, NOW + 1);
    expect(second.done).toBe(out.effectIds.length);
    // Done effects never re-run.
    runner.mockClear();
    await processEffects(D(), S, out.effectIds, runner, NOW + 2);
    expect(runner).not.toHaveBeenCalled();
  });

  it("effects arriving before acceptance (no committed receipt) are never marked done", async () => {
    await D().runTransaction(async (tx: any) =>
      queueEffectsInTx(D(), tx, S, { type: "receipt", receiptId: "ghost", commandId: "opX" }, [{ effect: "loyaltyEarn", payload: {} }], NOW),
    );
    const runner = vi.fn(async () => {});
    const r = await processEffects(D(), S, ["ghost__loyaltyEarn"], runner, NOW);
    expect(r).toMatchObject({ done: 0, pending: 1 });
    expect(runner).not.toHaveBeenCalled();
    expect(db.data(`stores/${S}/posEffects/ghost__loyaltyEarn`).status).toBe("pending");
  });

  it("a receipt from a different command does not finalize another command's effects", async () => {
    await runCheckout(D(), input({ opId: "real" }), CASHIER, NOW);
    await D().runTransaction(async (tx: any) =>
      queueEffectsInTx(D(), tx, S, { type: "receipt", receiptId: "s1", commandId: "stale" }, [{ effect: "loyaltyEarn", payload: {} }], NOW),
    );
    const runner = vi.fn(async () => {});
    await processEffects(D(), S, ["s1__loyaltyEarn"], runner, NOW);
    expect(runner).not.toHaveBeenCalled();
  });

  it("gives up after 10 attempts and marks the effect failed for a person", async () => {
    const out = await runCheckout(D(), input(), CASHIER, NOW);
    const runner = vi.fn(async () => { throw new Error("down"); });
    for (let i = 0; i < 10; i++) await processEffects(D(), S, ["s1__analytics"], runner, NOW + i);
    expect(db.data(`stores/${S}/posEffects/s1__analytics`)).toMatchObject({ status: "failed", attempts: 10 });
    expect(out.effectIds).toContain("s1__analytics");
  });
});

describe("void session (B01)", () => {
  it("voids an open session once and refuses a paid one", async () => {
    const a = await runVoidSession(D(), { storeId: S, sessionId: "s1", opId: "vo1", reason: "walkout" }, CASHIER, NOW);
    expect(a).toMatchObject({ replay: false, tableReleased: true });
    const b = await runVoidSession(D(), { storeId: S, sessionId: "s1", opId: "vo1", reason: "walkout" }, CASHIER, NOW);
    expect(b.replay).toBe(true);
    await expectCode(runVoidSession(D(), { storeId: S, sessionId: "s1", opId: "vo2", reason: "x" }, CASHIER, NOW), "session_voided");
    seedSession("s2", "t2");
    await runCheckout(D(), input({ sessionId: "s2", opId: "p2" }), CASHIER, NOW);
    await expectCode(runVoidSession(D(), { storeId: S, sessionId: "s2", opId: "vo3", reason: "x" }, CASHIER, NOW), "already_settled");
  });
});

describe("receipt commands (B01)", () => {
  beforeEach(async () => {
    await runCheckout(D(), input(), CASHIER, NOW);
  });

  it("void derives cash paid/retained from the receipt and is idempotent", async () => {
    const r1 = await runReceiptVoid(D(), { storeId: S, receiptId: "s1", reason: "wrong table", disposition: "partial", refundedCents: 6050 }, CASHIER, NOW);
    expect(r1.alreadyVoided).toBe(false);
    expect(db.data(`stores/${S}/receipts/s1`)).toMatchObject({ status: "voided", voidCashPaid: 1060.5, voidCashRefunded: 60.5, voidCashRetained: 1000, analyticsReversed: false });
    expect(db.data(`stores/${S}/posEffects/s1__analytics__void`).payload.op).toBe("void");
    const r2 = await runReceiptVoid(D(), { storeId: S, receiptId: "s1", reason: "again", disposition: "refunded", refundedCents: null }, CASHIER, NOW);
    expect(r2.alreadyVoided).toBe(true);
  });

  it("correction snapshots the SERVER copy and recomputes the total", async () => {
    const lines = db.data(`stores/${S}/receipts/s1`).lines.map((l: any) => (l.id === "addon_coke_60.5" ? { ...l, qtyOrdered: 0 } : l));
    const ensure = vi.fn(async () => {});
    const out = await runReceiptEdit(D(), {
      storeId: S, receiptId: "s1", expectedEditVersion: 0, reason: "remove coke", lines,
      billDiscount: null, customAdjustments: [], customerName: null, customerTin: null, customerAddress: null,
      payments: [{ methodId: "cash", amount: 1060.5 }],
    }, CASHIER, ensure, NOW);
    expect(ensure).toHaveBeenCalledOnce(); // payment analytics still pending -> applied first
    expect(out).toMatchObject({ editVersion: 1, total: 1000, refund: 60.5 });
    const rev = db.data(`stores/${S}/receipts/s1/revisions/${out.revisionId}`);
    expect(rev.snapshot.total).toBe(1060.5);
    expect(db.data(`stores/${S}/receipts/s1`)).toMatchObject({ total: 1000, totalPaid: 1000, editVersion: 1, editedByUsername: "Ana" });
    await expectCode(runReceiptEdit(D(), {
      storeId: S, receiptId: "s1", expectedEditVersion: 0, reason: "x", lines, billDiscount: null, customAdjustments: [],
      customerName: null, customerTin: null, customerAddress: null, payments: [{ methodId: "cash", amount: 1000 }],
    }, CASHIER, ensure, NOW), "receipt_changed");
  });

  it("refund keeps fractional quantities (e29b7e71) and is idempotent on requestId", async () => {
    const a = await runRefund(D(), { storeId: S, parentReceiptId: "s1", refundId: "rf1", refundQtys: { package_pk1: 0.5 }, reason: "half" }, CASHIER, NOW);
    expect(a.created).toBe(true);
    expect(db.data(`stores/${S}/receipts/s1`).refundedQtys).toEqual({ package_pk1: 0.5 });
    const b = await runRefund(D(), { storeId: S, parentReceiptId: "s1", refundId: "rf1", refundQtys: { package_pk1: 0.5 }, reason: "half" }, CASHIER, NOW);
    expect(b.created).toBe(false);
    expect(db.data(`stores/${S}/receipts/rf1`)).toMatchObject({ isRefund: true, createdByUsername: "Ana" });
  });
});

describe("bill-line prices are not trusted (B01 follow-up)", () => {
  const LINE = `stores/${S}/sessions/s1/sessionBillLines/addon_coke_60.5`;

  it("a server/kitchen-forged lower price is rejected at checkout", async () => {
    db.seed(LINE, { ...db.data(LINE), unitPrice: 1 });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100001 }), CASHIER, NOW), "line_price_invalid");
    expect(db.data(`stores/${S}/receipts/s1`)).toBeUndefined();
  });

  it("a forged package price and a negative modifier total are rejected", async () => {
    const PKG = `stores/${S}/sessions/s1/sessionBillLines/package_pk1`;
    db.seed(PKG, { ...db.data(PKG), unitPrice: 10 });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 8050 }), CASHIER, NOW), "line_price_invalid");
    db.seed(PKG, { ...db.data(PKG), unitPrice: 500 });
    db.seed(LINE, { ...db.data(LINE), modifiersTotal: -60.5 });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100000 }), CASHIER, NOW), "line_price_invalid");
  });

  it("an override 'signed' with a server account's uid is rejected", async () => {
    db.seed(LINE, { ...db.data(LINE), unitPrice: 1, priceOverride: { unitPrice: 1, byUid: "u_server" } });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100001 }), CASHIER, NOW), "line_price_invalid");
  });

  it("a legitimate cashier price override still settles", async () => {
    db.seed(LINE, { ...db.data(LINE), unitPrice: 50, priceOverride: { unitPrice: 50, byUid: "u_cashier", atMs: NOW } });
    const out = await runCheckout(D(), input({ expectedTotalCents: 105000 }), CASHIER, NOW);
    expect(out).toMatchObject({ status: "accepted", totalCents: 105000 });
  });

  it("an override for a different price than the line carries does not count", async () => {
    db.seed(LINE, { ...db.data(LINE), unitPrice: 1, priceOverride: { unitPrice: 50, byUid: "u_cashier" } });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100001 }), CASHIER, NOW), "line_price_invalid");
  });

  it("customer-app lines priced by product id resolve through inventory.productId; fully voided lines are skipped", async () => {
    db.seed(`stores/${S}/sessions/s1/sessionBillLines/addon_prod_wings_200`, {
      type: "addon", itemId: "prod_wings", itemName: "Wings", qtyOrdered: 1, unitPrice: 200, createdAt: 3,
    });
    db.seed(`stores/${S}/sessions/s1/sessionBillLines/addon_ghost_5`, {
      type: "addon", itemId: "ghost", itemName: "Ghost", qtyOrdered: 1, voidedQty: 1, unitPrice: 5, createdAt: 4,
    });
    const out = await runCheckout(D(), input({ expectedTotalCents: 126050, payments: [{ methodId: "cash", amount: 1300 }] }), CASHIER, NOW);
    expect(out.status).toBe("accepted");
  });

  it("offline reconcile applies the same price check (rejected, recoverable)", async () => {
    db.seed(LINE, { ...db.data(LINE), unitPrice: 1 });
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand({ expected: { sessionRevision: 1, billingRevision: 3, tableId: "t1", totalCents: 100001 } }));
    await expect(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY })).resolves.toMatchObject({
      status: "rejected", code: "line_price_invalid",
    });
  });
});

describe("review fixes (audit P1 review 2026-11-03)", () => {
  const LINE = `stores/${S}/sessions/s1/sessionBillLines/addon_coke_60.5`;
  const sess = () => db.data(`stores/${S}/sessions/s1`);

  it("#1 loyalty: a forged session redemption is refused; the server record's value is used", async () => {
    db.seed(`stores/${S}/sessions/s1`, { ...sess(), loyaltyRedemptions: [{ redemptionId: "fake", type: "percent", value: 100 }] });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 0 }), CASHIER, NOW), "loyalty_invalid");
    db.seed(`loyaltyRedemptions/red1`, { status: "applied", appliedStoreId: S, appliedSessionId: "s1", type: "fixed", value: 60.5, rewardName: "Free Coke" });
    db.seed(`stores/${S}/sessions/s1`, { ...sess(), loyaltyRedemptions: [{ redemptionId: "red1", type: "percent", value: 100 }] });
    const out = await runCheckout(D(), input({ expectedTotalCents: 100000 }), CASHIER, NOW);
    expect(out.totalCents).toBe(100000);
    expect(db.data(`stores/${S}/receipts/s1`).loyaltyRedemptions[0]).toMatchObject({ redemptionId: "red1", type: "fixed", value: 60.5 });
  });

  it("#1 loyalty: a redemption applied to another bill is refused", async () => {
    db.seed(`loyaltyRedemptions/red2`, { status: "applied", appliedStoreId: S, appliedSessionId: "s_other", type: "fixed", value: 60.5 });
    db.seed(`stores/${S}/sessions/s1`, { ...sess(), loyaltyRedemptions: [{ redemptionId: "red2", type: "fixed", value: 60.5 }] });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100000 }), CASHIER, NOW), "loyalty_invalid");
  });

  it("#2 reservation: scan-to-pay deposit rows are refused; manual deposits are deduped and consumed once", async () => {
    db.seed(`stores/${S}/reservations/res1`, { payments: [{ id: "rp1", methodId: "gcash", amount: 500, reference: "g1" }, { id: "rq1", methodId: "qr", amount: 500, reference: "x" }] });
    db.seed(`stores/${S}/sessions/s1`, { ...sess(), reservationId: "res1" });
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "qr", amount: 500, reference: "x", fromReservationPaymentId: "rq1" }, { methodId: "cash", amount: 600 }] }), CASHIER, NOW), "gateway_invalid");
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "gcash", amount: 500, reference: "g1", fromReservationPaymentId: "rp1" }, { methodId: "gcash", amount: 500, reference: "g1", fromReservationPaymentId: "rp1" }, { methodId: "cash", amount: 100 }] }), CASHIER, NOW), "gateway_invalid");
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "gcash", amount: 500, reference: "g1", fromReservationPaymentId: "nope" }, { methodId: "cash", amount: 600 }] }), CASHIER, NOW), "tender_invalid");
    await runCheckout(D(), input({ payments: [{ methodId: "gcash", amount: 500, reference: "g1", fromReservationPaymentId: "rp1" }, { methodId: "cash", amount: 600 }] }), CASHIER, NOW);
    expect(db.data(`stores/${S}/tenderConsumptions/res_res1__rp1`)).toMatchObject({ receiptId: "s1" });
    // A client clears paymentsAppliedToSessionId and links the reservation to a second bill.
    seedSession("s2", "t2");
    db.seed(`stores/${S}/reservations/res1`, { ...db.data(`stores/${S}/reservations/res1`), paymentsAppliedToSessionId: null });
    db.seed(`stores/${S}/sessions/s2`, { ...db.data(`stores/${S}/sessions/s2`), reservationId: "res1" });
    await expectCode(runCheckout(D(), input({ sessionId: "s2", opId: "op2", payments: [{ methodId: "gcash", amount: 500, reference: "g1", fromReservationPaymentId: "rp1" }, { methodId: "cash", amount: 600 }] }), CASHIER, NOW), "tender_invalid");
  });

  it("#3 kitchen voids must be backed by cancelled kitchen tickets", async () => {
    db.seed(LINE, { ...db.data(LINE), voidedQty: 1, kitchenVoidedQty: 1 });
    await expectCode(runCheckout(D(), input({ expectedTotalCents: 100000 }), CASHIER, NOW), "line_void_invalid");
    db.seed(`stores/${S}/sessions/s1/kitchentickets/kc`, { status: "cancelled", billLineId: "addon_coke_60.5", qty: 1 });
    await expect(runCheckout(D(), input({ expectedTotalCents: 100000 }), CASHIER, NOW)).resolves.toMatchObject({ status: "accepted" });
  });

  it("#4 the receipt shows the catalog name, not a client-chosen one", async () => {
    db.seed(LINE, { ...db.data(LINE), itemName: "Premium Wagyu" });
    await runCheckout(D(), input(), CASHIER, NOW);
    const line = db.data(`stores/${S}/receipts/s1`).lines.find((l: any) => l.id === "addon_coke_60.5");
    expect(line).toMatchObject({ itemName: "Coke", orderedItemName: "Premium Wagyu" });
    expect(db.data(`stores/${S}/receipts/s1`).analytics.salesByItem["Premium Wagyu"]).toBeUndefined();
  });

  it("#5 void reverses only redemptions the server applied to THIS bill", async () => {
    db.seed(`loyaltyRedemptions/mine`, { status: "applied", appliedStoreId: S, appliedSessionId: "s1", type: "fixed", value: 10 });
    db.seed(`loyaltyRedemptions/theirs`, { status: "applied", appliedStoreId: S, appliedSessionId: "s9", type: "fixed", value: 10 });
    db.seed(`stores/${S}/sessions/s1`, { ...sess(), loyaltyRedemptions: [{ redemptionId: "mine" }, { redemptionId: "theirs" }] });
    await runVoidSession(D(), { storeId: S, sessionId: "s1", opId: "vx", reason: "x" }, CASHIER, NOW);
    expect(db.data(`stores/${S}/posEffects/void_s1__loyaltyReverse`).payload.redemptionIds).toEqual(["mine"]);
  });

  it("#6 a rejected offline sale can be accepted as recorded by a manager only", async () => {
    await runCheckout(D(), input({ opId: "online1" }), CASHIER, NOW - 100_000);
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand({ payload: { payments: [{ methodId: "cash", amount: 1100 }], receiptNumber: "SHT-OL-AB12-0320-001", receiptSeq: 1, lines: [{ id: "x", type: "addon", itemName: "Coke", qtyOrdered: 1, unitPrice: 1060.5 }] } }));
    await reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY });
    await expectCode(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller, action: "accept-recorded", note: "x" }, { now: NOW, key: KEY }), "forbidden");
    const r = await reconcileCommand(D(), { storeId: S, opId: "off1", caller: managerCaller, action: "accept-recorded", note: "cash was taken" }, { now: NOW, key: KEY });
    expect(r).toMatchObject({ status: "accepted", receiptId: "offline_off1", receiptNumber: "SHT-OL-AB12-0320-001" });
    expect(db.data(`stores/${S}/receipts/offline_off1`)).toMatchObject({ total: 1060.5, offlineOrigin: true, acceptedAsRecorded: { byUid: "u_manager", note: "cash was taken" } });
    expect(db.data(`stores/${S}/receipts/s1`).commandId).toBe("online1"); // the online receipt is untouched
    expect(db.data(`stores/${S}/posCommands/off1`).resolved).toBe(true);
  });

  it("#7 sweep queries unresolved commands only (resolved ones never blind it)", async () => {
    for (let i = 0; i < 305; i++) db.seed(`stores/${S}/posCommands/done${i}`, { resolved: true, clientCreatedAtMs: NOW });
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand({ clientCreatedAtMs: 1 })); // wildly skewed clock
    db.seed(`stores/${S}/sessions/s1`, { ...sess(), startedAtClientMs: 0 });
    const out = await sweepStore(D(), S, vi.fn(async () => {}), { now: NOW, key: KEY });
    expect(out.accepted + out.rejected).toBe(1);
    expect(db.data(`stores/${S}/posCommands/off1`).resolved).toBe(true);
  });

  it("#8 an offline command dated before the bill opened is refused", async () => {
    db.seed(`stores/${S}/posCommands/off1`, offlineCommand({ clientCreatedAtMs: NOW - 2 * 3600_000 }, NOW - 3 * 3600_000));
    await expect(reconcileCommand(D(), { storeId: S, opId: "off1", caller: staffCaller }, { now: NOW, key: KEY })).resolves.toMatchObject({ code: "command_time_invalid" });
  });

  it("#9 voiding after a partial cash refund records only the cash still held", async () => {
    await runCheckout(D(), input(), CASHIER, NOW);
    db.seed(`stores/${S}/receipts/s1`, { ...db.data(`stores/${S}/receipts/s1`), refundedMop: { Cash: 60.5 } });
    await runReceiptVoid(D(), { storeId: S, receiptId: "s1", reason: "x", disposition: "refunded", refundedCents: null }, CASHIER, NOW);
    expect(db.data(`stores/${S}/receipts/s1`)).toMatchObject({ voidCashPaid: 1000, voidCashRefunded: 1000, voidCashRetained: 0 });
  });

  it("#10 an opId reused for another bill or other tenders is a conflict, not a replay", async () => {
    await runCheckout(D(), input(), CASHIER, NOW);
    seedSession("s2", "t2");
    await expectCode(runCheckout(D(), input({ sessionId: "s2" }), CASHIER, NOW), "command_conflict");
    await expectCode(runCheckout(D(), input({ payments: [{ methodId: "cash", amount: 1200 }] }), CASHIER, NOW), "command_conflict");
    await expectCode(runVoidSession(D(), { storeId: S, sessionId: "s2", opId: "op1", reason: "x" }, CASHIER, NOW), "command_conflict");
  });

  it("#11 inline + cron running the same effects concurrently run each effect once", async () => {
    const out = await runCheckout(D(), input(), CASHIER, NOW);
    const calls: string[] = [];
    const runner = vi.fn(async ({ effectDocId }: any) => { calls.push(effectDocId); await new Promise((r) => setTimeout(r, 5)); });
    await Promise.all([processEffects(D(), S, out.effectIds, runner, NOW), processEffects(D(), S, out.effectIds, runner, NOW)]);
    expect(calls.sort()).toEqual([...out.effectIds].sort());
    for (const id of out.effectIds) expect(db.data(`stores/${S}/posEffects/${id}`).status).toBe("done");
  });
});
