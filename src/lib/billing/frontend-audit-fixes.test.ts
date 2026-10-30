import { beforeEach, describe, expect, it } from "vitest";
import { calculateBillTotals } from "@/lib/tax";
import type { LineAdjustment, SessionBillLine, Store } from "@/lib/types";
import { validateChargeValue, validateDiscountValue } from "./adjustment-validation";
import {
  buildLineEditCommand,
  lineEditUpdateFields,
  makeLineEditSchema,
  newLineEditOpIds,
  type LineEditFormValues,
} from "./line-edit";
import { mergeLocalAddedLine, overlayAddedLine } from "./bill-lines";
import { __clearOptionGroupsCache, loadOptionGroups } from "./option-groups-load";
import { receiptCorrectionTotals } from "./receipt-correction";

const NON_VAT = { id: "s", taxType: "NON_VAT", taxRatePct: 0 } as unknown as Store;
const line = (over: Partial<SessionBillLine> = {}): SessionBillLine =>
  ({ id: "l", type: "addon", itemId: "i", itemName: "Item", unitPrice: 100, qtyOrdered: 1, freeQty: 0, voidedQty: 0, ...over }) as SessionBillLine;

const baseForm = (over: Partial<LineEditFormValues> = {}): any => ({
  qtyOrdered: 1, unitPrice: 100,
  applyDiscount: true, discountId: "custom", discountType: "percent", discountValue: 10, discountQty: 1,
  applyCharge: false, chargeId: "custom", chargeType: "fixed", chargeValue: 0, chargeQty: 0,
  applyFree: false, freeQty: 0, applyVoid: false, voidQty: 0, note: "",
  ...over,
});

describe("F09 shared discount/charge validation", () => {
  const schema = makeLineEditSchema({ discountEligibleUnit: 100 });
  const errorPaths = (input: any) => {
    const r = schema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("rejects a 200% line discount on the value field (probe scenario)", () => {
    expect(errorPaths(baseForm({ discountValue: 200 }))).toEqual(["discountValue"]);
  });

  it("accepts exact boundaries 100% and fixed == unit price", () => {
    expect(errorPaths(baseForm({ discountValue: 100 }))).toEqual([]);
    expect(errorPaths(baseForm({ discountType: "fixed", discountValue: 100 }))).toEqual([]);
  });

  it("rejects 0, negative, blank, non-finite and excessive fixed values", () => {
    for (const v of [0, -5, "", "abc", Infinity, NaN] as any[]) {
      expect(errorPaths(baseForm({ discountValue: v }))).toContain("discountValue");
    }
    expect(errorPaths(baseForm({ discountType: "fixed", discountValue: 100.01 }))).toContain("discountValue");
    expect(errorPaths(baseForm({ discountValue: 10.123 }))).toContain("discountValue");
  });

  it("validates charges too (negative charge is a hidden discount)", () => {
    expect(errorPaths(baseForm({ applyDiscount: false, applyCharge: true, chargeValue: -10, chargeQty: 1 }))).toEqual(["chargeValue"]);
    expect(validateChargeValue("percent", 101)).toMatch(/100%/);
    expect(validateChargeValue("fixed", 25)).toBeNull();
  });

  it("bill-level validator caps fixed discount at the eligible amount", () => {
    expect(validateDiscountValue("fixed", 500, 300)).toMatch(/₱300\.00/);
    expect(validateDiscountValue("fixed", 300, 300)).toBeNull();
    expect(validateDiscountValue("percent", 150, 300)).toMatch(/100%/);
  });

  it("calculateBillTotals never goes negative from a bad stored discount", () => {
    const stored = line({ lineAdjustments: { a: { id: "a", kind: "discount", type: "percent", qty: 1, value: 200 } } } as any);
    expect(calculateBillTotals([stored], NON_VAT, null, []).grandTotal).toBe(0);
    const negBill = calculateBillTotals([line()], NON_VAT, { type: "fixed", value: -50 } as any, []);
    expect(negBill.grandTotal).toBe(100);
    const negCharge = calculateBillTotals([line()], NON_VAT, null, [{ id: "c", note: "x", amount: -30, type: "fixed" } as any]);
    expect(negCharge.grandTotal).toBe(100);
  });

  it("leaves valid VAT math unchanged", () => {
    const vat = { id: "s", taxType: "VAT_INCLUSIVE", taxRatePct: 12 } as unknown as Store;
    const t = calculateBillTotals([line({ unitPrice: 112 })], vat, { type: "percent", value: 10 } as any, []);
    expect(t.grandTotal).toBe(100.8);
    expect(t.taxTotal).toBe(10.8);
  });
});

describe("F25 line edit is one atomic, retry-safe command", () => {
  // Minimal fake of a Firestore doc applying dotted update paths atomically.
  function makeDoc() {
    const doc: any = { qtyOrdered: 1, unitPrice: 100, lineAdjustments: {} };
    let failNext = false;
    return {
      doc,
      failOnce() { failNext = true; },
      commit(fields: Record<string, unknown>) {
        if (failNext) { failNext = false; throw new Error("charge failed"); } // whole write rejected
        for (const [k, v] of Object.entries(fields)) {
          if (k.startsWith("lineAdjustments.")) doc.lineAdjustments[k.slice("lineAdjustments.".length)] = v;
          else doc[k] = v;
        }
      },
    };
  }

  const data = baseForm({
    discountType: "fixed", discountValue: 10, discountQty: 1,
    applyCharge: true, chargeType: "fixed", chargeValue: 5, chargeQty: 1,
  });
  const actor = { uid: "staff", name: "Mock" };

  it("a retry after a failed save yields exactly one discount and one charge", () => {
    const store = makeDoc();
    const opIds = newLineEditOpIds(1000); // created once per editing attempt
    const save = () => {
      const cmd = buildLineEditCommand({ line: line(), data, discounts: [], charges: [], actor, opIds });
      store.commit(lineEditUpdateFields(cmd.after, cmd.adjustments));
    };
    store.failOnce();
    expect(save).toThrow(/charge failed/);
    expect(Object.keys(store.doc.lineAdjustments)).toHaveLength(0); // nothing half-committed
    save();
    save(); // even a duplicate submit after success is idempotent
    const adjs = Object.values(store.doc.lineAdjustments) as LineAdjustment[];
    expect(adjs.filter((a) => a.kind === "discount")).toHaveLength(1);
    expect(adjs.filter((a) => a.kind === "charge")).toHaveLength(1);
    expect(calculateBillTotals([{ ...line(), ...store.doc }], NON_VAT, null, []).grandTotal).toBe(95);
  });

  it("op IDs are distinct per attempt", () => {
    const a = newLineEditOpIds(1);
    const b = newLineEditOpIds(1);
    expect(a.discountAdjId).not.toBe(b.discountAdjId);
    expect(a.discountAdjId).not.toBe(a.chargeAdjId);
  });
});

describe("F24 snapshot is the only committed source", () => {
  it("snapshot-before-callback does not double count", () => {
    const observed = [line({ qtyOrdered: 2 })];
    const after = overlayAddedLine(observed, line({ qtyOrdered: 1 }));
    expect(after).toBe(observed);
    expect(after[0].qtyOrdered).toBe(2);
  });

  it("callback-before-snapshot shows the new line once, keyed by bill-line id", () => {
    const added = line({ id: "addon_i_100" });
    const after = overlayAddedLine([], added);
    expect(after).toEqual([added]);
    expect(overlayAddedLine(after, added)).toHaveLength(1);
  });

  it("modifier variants with same product/base price stay separate", () => {
    const plain = line({ id: "addon_i_100" });
    const spicy = line({ id: "addon_i_100_spicy", modifiersTotal: 20 } as any);
    expect(overlayAddedLine([plain], spicy)).toHaveLength(2);
    const local = mergeLocalAddedLine([plain], spicy);
    expect(local).toHaveLength(2);
    expect(mergeLocalAddedLine(local, line({ id: "addon_i_100", qtyOrdered: 2 }))[0].qtyOrdered).toBe(3);
  });
});

describe("F08 option-group config must be confirmed before adding", () => {
  beforeEach(() => __clearOptionGroupsCache());
  const token = async () => "t";
  const resp = (ok: boolean, body: unknown, badJson = false) =>
    (async () => ({ ok, json: async () => { if (badJson) throw new Error("bad json"); return body; } })) as any;
  const group = { id: "g", name: "Spice", selectionMode: "single", required: true, values: [{ id: "v", name: "Hot", priceDelta: 20 }] };

  it.each([
    ["network error / offline", (async () => { throw new Error("offline"); }) as any, token],
    ["non-2xx", resp(false, { ok: false }), token],
    ["malformed JSON", resp(true, null, true), token],
    ["malformed body", resp(true, { ok: true, optionGroups: "nope" }), token],
    ["malformed group", resp(true, { ok: true, optionGroups: [{ id: 1 }] }), token],
    ["no auth token", resp(true, { ok: true, optionGroups: [] }), async () => null],
  ])("%s → unavailable (item not added)", async (_name, fetchImpl, getIdToken) => {
    const r = await loadOptionGroups({ storeId: "a", productId: "p", getIdToken, fetchImpl });
    expect(r.status).toBe("unavailable");
  });

  it("a successful empty list still allows a plain add", async () => {
    const r = await loadOptionGroups({ storeId: "a", productId: "p", getIdToken: token, fetchImpl: resp(true, { ok: true, optionGroups: [] }) });
    expect(r).toEqual({ status: "ok", groups: [], fromCache: false });
  });

  it("offline after a confirmed load reuses the cached schema (required groups kept)", async () => {
    await loadOptionGroups({ storeId: "a", productId: "p", getIdToken: token, fetchImpl: resp(true, { ok: true, optionGroups: [group] }) });
    const r = await loadOptionGroups({ storeId: "a", productId: "p", getIdToken: token, fetchImpl: (async () => { throw new Error("offline"); }) as any });
    expect(r.status).toBe("ok");
    if (r.status === "ok") { expect(r.fromCache).toBe(true); expect(r.groups[0].required).toBe(true); }
    const other = await loadOptionGroups({ storeId: "b", productId: "p", getIdToken: token, fetchImpl: (async () => { throw new Error("offline"); }) as any });
    expect(other.status).toBe("unavailable");
  });
});

describe("F10 receipt correction keeps existing loyalty redemptions", () => {
  it("an 80 settled bill with a 20 loyalty discount stays 80", () => {
    const receipt = { loyaltyRedemptions: [{ redemptionId: "r", rewardId: "w", rewardName: "₱20 off", type: "fixed", value: 20, pointsCost: 1, phone: "x" }] } as any;
    const t = receiptCorrectionTotals(receipt, [line()], NON_VAT, null, []);
    expect(t.grandTotal).toBe(80);
    expect(t.loyaltyDiscountTotal).toBe(20);
  });

  it("receipts without redemptions are unchanged", () => {
    expect(receiptCorrectionTotals({}, [line()], NON_VAT, null, []).grandTotal).toBe(100);
  });
});
