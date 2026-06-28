import { describe, it, expect } from "vitest";
import {
  netByMethod,
  activeConversionCount,
  groupConversionsByDay,
} from "@/lib/analytics/paymentConversionSummary";
import type { PaymentConversion } from "@/lib/analytics/applyPaymentConversion";

function conv(p: Partial<PaymentConversion>): PaymentConversion {
  return {
    id: p.id ?? "x",
    storeId: "s",
    dayId: p.dayId ?? "20260628",
    dayStartMs: 0,
    amount: p.amount ?? 0,
    fromMethod: p.fromMethod ?? "cash",
    toMethod: p.toMethod ?? "gcash",
    note: p.note ?? null,
    status: p.status ?? "active",
    createdBy: { uid: "u", name: "n" },
    createdAt: null,
    createdAtClientMs: p.createdAtClientMs ?? 0,
  };
}

describe("netByMethod", () => {
  it("sums signed amounts: from is negative, to is positive", () => {
    const net = netByMethod([
      conv({ fromMethod: "cash", toMethod: "gcash", amount: 5000 }),
      conv({ fromMethod: "cash", toMethod: "gcash", amount: 1500 }),
    ]);
    expect(net.cash).toBe(-6500);
    expect(net.gcash).toBe(6500);
  });

  it("skips voided conversions", () => {
    const net = netByMethod([
      conv({ fromMethod: "cash", toMethod: "gcash", amount: 5000 }),
      conv({ fromMethod: "cash", toMethod: "gcash", amount: 9999, status: "voided" }),
    ]);
    expect(net.cash).toBe(-5000);
    expect(net.gcash).toBe(5000);
  });

  it("nets opposing conversions on the same method to zero", () => {
    const net = netByMethod([
      conv({ fromMethod: "cash", toMethod: "gcash", amount: 3000 }),
      conv({ fromMethod: "gcash", toMethod: "cash", amount: 3000 }),
    ]);
    expect(net.cash).toBe(0);
    expect(net.gcash).toBe(0);
  });
});

describe("activeConversionCount", () => {
  it("counts only active (non-voided) conversions", () => {
    expect(
      activeConversionCount([
        conv({}),
        conv({ status: "voided" }),
        conv({}),
      ]),
    ).toBe(2);
  });
});

describe("groupConversionsByDay", () => {
  it("groups by dayId, newest day first, with a per-day net", () => {
    const groups = groupConversionsByDay([
      conv({ id: "a", dayId: "20260627", amount: 1000, createdAtClientMs: 100 }),
      conv({ id: "b", dayId: "20260628", amount: 5000, createdAtClientMs: 200 }),
      conv({ id: "c", dayId: "20260628", amount: 2000, createdAtClientMs: 300 }),
    ]);
    expect(groups.map((g) => g.dayId)).toEqual(["20260628", "20260627"]);
    // newest day's entries ordered by createdAtClientMs desc (c before b)
    expect(groups[0].entries.map((e) => e.id)).toEqual(["c", "b"]);
    expect(groups[0].net.cash).toBe(-7000);
    expect(groups[0].net.gcash).toBe(7000);
    expect(groups[1].net.cash).toBe(-1000);
  });
});
