import { describe, expect, it } from "vitest";
import type { DailySessionRow } from "@/lib/analytics/session-row";
import { buildSessionStages, buildServiceItems, collectAdjustments } from "./stages";
import type { SessionTrailSources } from "./types";

const T0 = 1_754_200_000_000; // arbitrary fixed epoch — nothing here reads the clock
const min = (n: number) => n * 60_000;

function makeRow(over: Partial<DailySessionRow> = {}): DailySessionRow {
  return {
    sessionId: "sess1",
    receiptId: "sess1",
    receiptNumber: "SELIP-000412",
    sessionMode: "package_dinein",
    tableNumber: "12",
    customerName: "Ana",
    pax: 6,
    packageName: "Unli Pork Belly",
    itemCount: 6,
    billDiscount: 0,
    chargesTotal: 0,
    totalDiscount: 0,
    total: 4280,
    startedAtMs: T0,
    closedAtMs: T0 + min(108),
    durationMs: min(108),
    ...over,
  };
}

function makeSources(over: Partial<SessionTrailSources> = {}): SessionTrailSources {
  return {
    sessionId: "sess1",
    receiptId: "sess1",
    session: null,
    receipt: null,
    billLines: [],
    tickets: [],
    activityLogs: [],
    flag: null,
    participants: [],
    ...over,
  };
}

const fullSession = {
  id: "sess1",
  sessionMode: "package_dinein",
  startedAtClientMs: T0,
  guestCountCashierInitial: 4,
  guestCountServerVerified: 6,
  guestCountFinal: 6,
  verifiedAt: new Date(T0 + min(3)),
  verifyDurationMs: min(3),
  verifiedByServerProfileName: "Ben",
  closedAtClientMs: T0 + min(108),
  closedByUsername: "Ana",
  packageSnapshot: { name: "Unli Pork Belly" },
  initialFlavorIds: ["f1", "f2"],
  tableNumber: "12",
} as any;

const kind = (stages: ReturnType<typeof buildSessionStages>) => stages.map((s) => s.kind);
const find = (stages: ReturnType<typeof buildSessionStages>, k: string) => stages.find((s) => s.kind === k)!;

describe("buildSessionStages — narrative order", () => {
  it("emits stages in story order, not time order", () => {
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession }) });
    expect(kind(stages)).toEqual(["start", "verify", "service", "billout", "closed"]);
  });

  it("omits the adjustments stage entirely when a session is clean", () => {
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession }) });
    expect(kind(stages)).not.toContain("adjustments");
  });

  it("skips verification for ala carte, which is never verified", () => {
    const stages = buildSessionStages({
      row: makeRow({ sessionMode: "alacarte", pax: null, packageName: null }),
      sources: makeSources({ session: { ...fullSession, sessionMode: "alacarte" } }),
    });
    expect(kind(stages)).not.toContain("verify");
  });

  it("flags a dine-in session that was never verified", () => {
    const stages = buildSessionStages({
      row: makeRow(),
      sources: makeSources({ session: { ...fullSession, verifiedAt: null, verifyDurationMs: null } }),
    });
    const verify = find(stages, "verify");
    expect(verify.tone).toBe("warn");
    expect(verify.empty).toBe(true);
    expect(verify.facts[0].value).toMatch(/never verified/i);
  });
});

describe("buildSessionStages — start", () => {
  it("resolves flavor ids to names", () => {
    const stages = buildSessionStages({
      row: makeRow(),
      sources: makeSources({ session: fullSession }),
      flavorNames: new Map([["f1", "Spicy Miso"], ["f2", "Shoyu"]]),
    });
    const flavors = find(stages, "start").facts.find((f) => f.label === "Flavors");
    expect(flavors?.value).toBe("Spicy Miso, Shoyu");
  });

  it("falls back to the raw id rather than inventing 'Unknown'", () => {
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession }) });
    expect(find(stages, "start").facts.find((f) => f.label === "Flavors")?.value).toBe("f1, f2");
  });

  it("labels an ala carte headcount as unbilled so it cannot be read as covers", () => {
    const stages = buildSessionStages({
      row: makeRow({ sessionMode: "alacarte", pax: null }),
      sources: makeSources({ session: { ...fullSession, sessionMode: "alacarte" } }),
    });
    const fact = find(stages, "start").facts.find((f) => f.label === "Party size");
    expect(fact?.value).toBe("6");
    expect(fact?.hint).toMatch(/not billed/i);
  });
});

describe("buildSessionStages — verification", () => {
  it("reuses the persisted verifyDurationMs rather than recomputing it", () => {
    const stages = buildSessionStages({
      row: makeRow(),
      // A verifiedAt that disagrees with verifyDurationMs: the persisted lapse wins.
      sources: makeSources({ session: { ...fullSession, verifiedAt: new Date(T0 + min(99)) } }),
    });
    expect(find(stages, "verify").lapseMs).toBe(min(3));
  });

  it("shows the pax change as initial → final", () => {
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession }) });
    expect(find(stages, "verify").facts.find((f) => f.label === "Pax")?.value).toBe("4 → 6");
  });
});

describe("buildServiceItems", () => {
  const ticket = (over: any) => ({
    id: over.id ?? "t1",
    type: "refill",
    itemName: "Iced Tea",
    qtyOrdered: 2,
    status: "served",
    createdAtClientMs: T0 + min(20),
    servedAtClientMs: T0 + min(23),
    durationMs: min(3),
    billLineId: null,
    ...over,
  });

  it("separates refills from add-ons on ticket type, not billLineId", () => {
    // The package ticket also has a null billLineId — using that to detect a
    // refill would misclassify it.
    const items = buildServiceItems(
      [ticket({ id: "t1" }), ticket({ id: "t2", type: "addon", billLineId: "l1" }), ticket({ id: "t3", type: "package" })] as any,
      [{ id: "l1", itemName: "Softdrinks", unitPrice: 150, qtyOrdered: 2 } as any],
      new Map()
    );
    expect(items.map((i) => i.kind)).toEqual(["refill", "addon"]);
  });

  it("reuses the persisted ticket durationMs", () => {
    const items = buildServiceItems([ticket({ servedAtClientMs: T0 + min(90) })] as any, [], new Map());
    expect(items[0].lapseMs).toBe(min(3));
  });

  it("computes the lapse only when durationMs is absent", () => {
    const items = buildServiceItems([ticket({ durationMs: undefined })] as any, [], new Map());
    expect(items[0].lapseMs).toBe(min(3));
  });

  it("marks a serve past the SLA as late, and double that as danger", () => {
    const late = buildServiceItems([ticket({ durationMs: min(12) })] as any, [], new Map());
    const veryLate = buildServiceItems([ticket({ durationMs: min(25) })] as any, [], new Map());
    expect(late[0].tone).toBe("warn");
    expect(veryLate[0].tone).toBe("danger");
  });

  it("treats an unknown lapse as on time rather than late", () => {
    const items = buildServiceItems(
      [ticket({ durationMs: undefined, servedAtClientMs: undefined })] as any, [], new Map()
    );
    expect(items[0].lapseMs).toBeNull();
    expect(items[0].tone).toBe("neutral");
  });

  it("reads batch quantities from serveLog.qty, the field actually written", () => {
    const items = buildServiceItems(
      [ticket({ serveLog: [{ qty: 3, servedAtClientMs: T0 + min(21) }, { qty: 5, servedAtClientMs: T0 + min(23) }] })] as any,
      [], new Map()
    );
    expect(items[0].batches.map((b) => b.qty)).toEqual([3, 5]);
  });

  it("excludes cancelled tickets — those belong to adjustments", () => {
    const items = buildServiceItems(
      [ticket({ id: "t1" }), ticket({ id: "t2", status: "cancelled", cancelledAt: new Date(T0) })] as any,
      [], new Map()
    );
    expect(items).toHaveLength(1);
  });

  it("prices add-ons off their bill line and comps refills", () => {
    const items = buildServiceItems(
      [ticket({ id: "t2", type: "addon", billLineId: "l1", qtyOrdered: 2 })] as any,
      [{ id: "l1", itemName: "Softdrinks", unitPrice: 150 } as any],
      new Map()
    );
    expect(items[0].free).toBe(false);
    expect(items[0].priceLabel).toContain("300");
    const refills = buildServiceItems([ticket({})] as any, [], new Map());
    expect(refills[0].free).toBe(true);
    expect(refills[0].priceLabel).toBeNull();
  });

  it("shows a partial serve as served/ordered", () => {
    const items = buildServiceItems([ticket({ qtyOrdered: 8, qtyServed: 3 })] as any, [], new Map());
    expect(items[0].qtyLabel).toBe("3/8");
  });
});

describe("collectAdjustments", () => {
  const log = (over: any) => ({
    id: over.id ?? "g1",
    action: "VOID_TICKETS",
    createdAt: new Date(T0 + min(40)),
    actorUid: "u1",
    actorName: "Ana",
    meta: { itemName: "Softdrinks", qty: 2, amount: 300 },
    ...over,
  });

  it("reads adjustments from activity logs", () => {
    const out = collectAdjustments([log({})] as any, [], []);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("void");
    expect(out[0].logId).toBe("g1");
  });

  it("ignores logs that are not adjustments", () => {
    expect(collectAdjustments([log({ action: "TICKET_SERVED" })] as any, [], [])).toHaveLength(0);
  });

  it("surfaces a lineAdjustment that has no matching log", () => {
    const lines = [{
      id: "l1", itemName: "Pork Belly",
      lineAdjustments: { a1: { id: "a1", kind: "discount", type: "fixed", value: 30, qty: 1, createdAtClientMs: T0 + min(70), createdByName: "Ben" } },
    }] as any;
    const out = collectAdjustments([], lines, []);
    expect(out).toHaveLength(1);
    expect(out[0].actorName).toBe("Ben");
    expect(out[0].logId).toBeNull();
  });

  it("does not double-count a lineAdjustment its log already covers", () => {
    const lines = [{
      id: "l1", itemName: "Pork Belly",
      lineAdjustments: { a1: { id: "a1", kind: "discount", type: "fixed", value: 300, qty: 1, createdAtClientMs: T0 + min(40) + 500 } },
    }] as any;
    const out = collectAdjustments([log({ action: "DISCOUNT_APPLIED" })] as any, lines, []);
    expect(out).toHaveLength(1);
    expect(out[0].logId).toBe("g1");
  });

  it("includes a kitchen cancel that produced no log", () => {
    const tickets = [{ id: "t9", itemName: "Softdrinks", status: "cancelled", cancelledAtClientMs: T0 + min(55), cancelReason: "Incorrect order" }] as any;
    const out = collectAdjustments([], [], tickets);
    expect(out[0].kind).toBe("void");
    expect(out[0].detail).toBe("Incorrect order");
  });

  it("returns adjustments in time order", () => {
    const out = collectAdjustments(
      [log({ id: "late", createdAt: new Date(T0 + min(80)) }), log({ id: "early", createdAt: new Date(T0 + min(10)) })] as any,
      [], []
    );
    expect(out.map((a) => a.logId)).toEqual(["early", "late"]);
  });
});

describe("buildSessionStages — bill out", () => {
  const receipt = {
    id: "sess1",
    receiptNumber: "SELIP-000412",
    total: 4280,
    totalPaid: 5000,
    change: 720,
    createdByUsername: "Ana",
    createdAtClientMs: T0 + min(108),
    analytics: {
      subtotal: 4000, discountsTotal: 200, chargesTotal: 50, taxAmount: 430,
      grandTotal: 4280, mop: { Cash: 5000 },
      guestCountSnapshot: { finalGuestCount: 6, billedPackageCovers: 6, discrepancy: 0 },
    },
  } as any;

  it("summarises the modes of payment", () => {
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession, receipt }) });
    expect(find(stages, "billout").summary).toContain("Cash");
  });

  it("warns when billed covers disagree with the headcount", () => {
    const short = { ...receipt, analytics: { ...receipt.analytics, guestCountSnapshot: { finalGuestCount: 6, billedPackageCovers: 4, discrepancy: -2 } } };
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession, receipt: short }) });
    expect(find(stages, "billout").facts.find((f) => f.label === "Cover check")?.tone).toBe("warn");
  });

  it("stays quiet about covers on a bundle, which is flat by definition", () => {
    const bundle = { ...receipt, analytics: { ...receipt.analytics, guestCountSnapshot: { finalGuestCount: 8, billedPackageCovers: 5, discrepancy: -3, isBundle: true } } };
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession, receipt: bundle }) });
    expect(find(stages, "billout").facts.find((f) => f.label === "Cover check")).toBeUndefined();
  });

  it("renders a refund row against its parent receipt", () => {
    const refundRow = makeRow({ receiptId: "refund-uuid", receiptNumber: "SELIP-000413", isRefund: true });
    const stages = buildSessionStages({
      row: refundRow,
      sources: makeSources({ session: fullSession, receipt: { ...receipt, id: "refund-uuid", isRefund: true, parentReceiptId: "sess1" } }),
      siblingRows: [makeRow()],
    });
    const billout = find(stages, "billout");
    expect(billout.label).toBe("Refund");
    expect(billout.tone).toBe("danger");
    expect(billout.facts.find((f) => f.label === "Refund of")?.value).toBe("SELIP-000412");
  });

  it("falls back to the projection row when receipt analytics are thin", () => {
    const stages = buildSessionStages({
      row: makeRow({ totalDiscount: 200, chargesTotal: 50, total: 4280 }),
      sources: makeSources({ session: fullSession, receipt: { id: "sess1", analytics: {} } as any }),
    });
    const facts = find(stages, "billout").facts;
    expect(facts.find((f) => f.label === "Discounts")?.value).toContain("200");
    expect(facts.find((f) => f.label === "Total")?.value).toContain("4,280");
  });
});

describe("buildSessionStages — receipt-only row", () => {
  it("still tells the story when no session doc is linked", () => {
    const stages = buildSessionStages({
      row: makeRow({ sessionId: null }),
      sources: makeSources({ sessionId: null, receipt: { id: "sess1", total: 4280, analytics: {} } as any }),
    });
    expect(kind(stages)).toEqual(["start", "service", "billout", "closed"]);
    expect(find(stages, "start").facts.find((f) => f.label === "Note")?.tone).toBe("warn");
  });
});

describe("buildSessionStages — close", () => {
  it("uses the already-clamped row duration", () => {
    const stages = buildSessionStages({ row: makeRow(), sources: makeSources({ session: fullSession }) });
    expect(find(stages, "closed").facts.find((f) => f.label === "Total session")?.value).toBe("1h 48m");
  });

  it("says 'closed at payment' rather than repeating the same clock twice", () => {
    const stages = buildSessionStages({
      row: makeRow(),
      sources: makeSources({ session: fullSession, receipt: { id: "sess1", createdAtClientMs: T0 + min(108) + 900, analytics: {} } as any }),
    });
    expect(find(stages, "closed").summary).toBe("Closed at payment");
  });

  it("falls back to the row's close time when the session update never synced", () => {
    const stages = buildSessionStages({
      row: makeRow(),
      sources: makeSources({ session: { ...fullSession, closedAtClientMs: null, closedAt: null } }),
    });
    expect(find(stages, "closed").atMs).toBe(T0 + min(108));
  });
});
