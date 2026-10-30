import { describe, expect, it } from "vitest";
import type { ModeOfPayment } from "@/lib/types";
import {
  buildInitialTenders,
  dueChangeNotice,
  fillMissingMethods,
  recoverPriorPayments,
  runCheckout,
  tenderInitKey,
  withTimeout,
} from "./payment-modal-logic";

const cash = { id: "cash", name: "Cash", type: "cash", isActive: true } as unknown as ModeOfPayment;
const gcash = { id: "gcash", name: "GCash", type: "ewallet", isActive: true } as unknown as ModeOfPayment;

describe("F03 runCheckout — committed sale never reported as failed", () => {
  it("settings read failure after commit → committed with a print warning (probe F03)", async () => {
    let commits = 0;
    const out = await runCheckout({
      commit: async () => { commits++; return "committed-receipt"; },
      readAutoPrint: async () => { throw new Error("settings unavailable"); },
    });
    expect(commits).toBe(1);
    expect(out.phase).toBe("committed");
    if (out.phase !== "committed") return;
    expect(out.receiptId).toBe("committed-receipt");
    expect(out.redirect).toBe("/receipt?id=committed-receipt");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/print/i);
  });

  it("offline-style commit followed by failing follow-up steps stays committed", async () => {
    const out = await runCheckout({
      commit: async () => "local-receipt",
      readAutoPrint: async () => true,
      afterCommit: [{ label: "Marking the reservation deposit as used", run: async () => { throw new Error("denied"); } }],
    });
    expect(out.phase).toBe("committed");
    if (out.phase !== "committed") return;
    expect(out.redirect).toBe("/receipt?id=local-receipt&autoprint=1");
    expect(out.warnings.join(" ")).toMatch(/reservation deposit/);
  });

  it("only a commit failure yields failed, and later steps do not run", async () => {
    let ranAfter = false;
    const out = await runCheckout({
      commit: async () => { throw new Error("Bill changed"); },
      readAutoPrint: async () => { ranAfter = true; return false; },
    });
    expect(out).toEqual({ phase: "failed", error: "Bill changed" });
    expect(ranAfter).toBe(false);
  });

  it("an empty receipt id is treated as not committed", async () => {
    const out = await runCheckout({ commit: async () => "", readAutoPrint: async () => false });
    expect(out.phase).toBe("failed");
  });

  it("withTimeout rejects a hung settings read so the print fallback kicks in", async () => {
    const out = await runCheckout({
      commit: async () => "r1",
      readAutoPrint: () => withTimeout(new Promise<boolean>(() => {}), 10, "Receipt settings"),
    });
    expect(out.phase).toBe("committed");
    if (out.phase === "committed") expect(out.warnings).toHaveLength(1);
  });
});

describe("F04 init once per open; snapshots never wipe tenders", () => {
  it("equivalent payment-method refresh does not change the init key (probe F04)", () => {
    const k1 = tenderInitKey(true, "a", "s", null);
    const k2 = tenderInitKey(true, "a", "s", null);
    expect(k1).toBe(k2);
    expect(tenderInitKey(false, "a", "s", null)).toBeNull();
    expect(tenderInitKey(true, "a", "s2", null)).not.toBe(k1);
  });

  it("fillMissingMethods keeps an entered amount and identity when methods refresh", () => {
    const entered = [{ id: "p1", methodId: "cash", amount: 5, reference: "" }];
    expect(fillMissingMethods(entered, [cash])).toBe(entered);
    expect(fillMissingMethods(entered, [...[cash]])[0].amount).toBe(5);
  });

  it("fillMissingMethods only fills rows seeded before methods loaded", () => {
    const rows = [{ id: "p1", methodId: "", amount: 42, reference: "" }];
    const out = fillMissingMethods(rows, [gcash, cash]);
    expect(out[0]).toEqual({ id: "p1", methodId: "cash", amount: 42, reference: "" });
  });

  it("dueChangeNotice flags a bill total change for staff and clears on ack", () => {
    expect(dueChangeNotice(10000, 10000)).toBeNull();
    expect(dueChangeNotice(null, 12000)).toBeNull();
    expect(dueChangeNotice(10000, 12000)).toEqual({ fromCents: 10000, toCents: 12000 });
  });

  it("buildInitialTenders seeds prior payments then a cash row for the balance", () => {
    const prepaid = [{ id: "rp-1", methodId: "gcash", amount: 30, reference: "R1", fromReservationPaymentId: "1" }];
    expect(buildInitialTenders(prepaid, 100, [gcash, cash], "new")).toEqual([
      prepaid[0],
      { id: "new", methodId: "cash", amount: 70, reference: "" },
    ]);
    expect(buildInitialTenders([], 100, [cash], "new")).toEqual([{ id: "new", methodId: "cash", amount: 100, reference: "" }]);
    expect(buildInitialTenders(prepaid, 30, [cash], "new")).toEqual(prepaid);
  });
});

describe("F05 prior-payment recovery has a failed state", () => {
  it("paid-QR lookup failure is failed, not an empty list (probe F05)", async () => {
    const r = await recoverPriorPayments("s", {
      loadSessionIntents: async () => { throw new Error("recovery unavailable"); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/QR Ph payments \(recovery unavailable\)/);
  });

  it("reservation lookup failure (permission) is failed", async () => {
    const r = await recoverPriorPayments("s", {
      loadReservation: async () => { throw new Error("Missing or insufficient permissions."); },
      loadSessionIntents: async () => [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/reservation deposits/);
  });

  it("malformed paid intent is failed rather than skipped", async () => {
    const r = await recoverPriorPayments("s", {
      loadSessionIntents: async () => [{ id: "i1", status: "paid", methodId: "", amount: 50, paymongoIntentId: "" }],
    });
    expect(r.ok).toBe(false);
  });

  it("success recovers reservation deposits and paid QR intents, de-duplicated", async () => {
    const r = await recoverPriorPayments("s", {
      loadReservation: async () => ({
        payments: [
          { id: "d1", methodId: "gcash", amount: "30", reference: "pay_1" },
          { id: "d2", methodId: "cash", amount: 10, voidedAt: 123 },
        ],
      }),
      loadSessionIntents: async () => [
        { id: "i1", status: "paid", methodId: "qr", amount: 30, paymongoPaymentId: "pay_1", paymongoIntentId: "pi_1" },
        { id: "i2", status: "paid", methodId: "qr", amount: 20, paymongoPaymentId: null, paymongoIntentId: "pi_2" },
        { id: "i3", status: "awaiting_payment", methodId: "qr", amount: 99, paymongoIntentId: "pi_3" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prepaidLines.map(p => p.id)).toEqual(["rp-d1", "qr-i2"]);
    expect(r.prepaidLines[1]).toMatchObject({ reference: "pi_2", intentDocId: "i2", amount: 20 });
  });

  it("reservation already applied to this session seeds nothing from it", async () => {
    const r = await recoverPriorPayments("s", {
      loadReservation: async () => ({ paymentsAppliedToSessionId: "s", payments: [{ id: "d1", methodId: "cash", amount: 30 }] }),
      loadSessionIntents: async () => [],
    });
    expect(r).toEqual({ ok: true, prepaidLines: [], reservationApplied: true });
  });
});
