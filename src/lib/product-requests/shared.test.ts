import { describe, expect, it } from "vitest";
import {
  buildNameKey,
  canCancel,
  canEnableAddon,
  statusBadgeVariant,
  STATUS_LABEL,
} from "@/lib/product-requests/shared";
import type { ProductRequestStatus } from "@/lib/types";

describe("buildNameKey", () => {
  it("collapses case, whitespace and punctuation to one key", () => {
    const expected = "coke-zero";
    expect(buildNameKey("Coke Zero")).toBe(expected);
    expect(buildNameKey("coke  zero")).toBe(expected);
    expect(buildNameKey("  Coke-Zero!  ")).toBe(expected);
    expect(buildNameKey("COKE ZERO")).toBe(expected);
  });

  it("folds the variant into the key so sizes stay distinct", () => {
    expect(buildNameKey("Coke Zero", "Large")).toBe("coke-zero-large");
    expect(buildNameKey("Coke Zero", "Small")).toBe("coke-zero-small");
    expect(buildNameKey("Coke Zero", "Large")).not.toBe(buildNameKey("Coke Zero"));
  });

  it("treats a missing, null or blank variant as no variant", () => {
    const bare = buildNameKey("Truffle Dip");
    expect(buildNameKey("Truffle Dip", null)).toBe(bare);
    expect(buildNameKey("Truffle Dip", undefined)).toBe(bare);
    expect(buildNameKey("Truffle Dip", "   ")).toBe(bare);
  });

  it("does not leave a trailing separator", () => {
    expect(buildNameKey("Extra Rice", "")).toBe("extra-rice");
    expect(buildNameKey("Extra Rice")).not.toMatch(/-$/);
  });
});

describe("statusBadgeVariant", () => {
  it("maps each status to a distinct-enough variant", () => {
    expect(statusBadgeVariant("pending")).toBe("default");
    expect(statusBadgeVariant("rejected")).toBe("destructive");
    expect(statusBadgeVariant("approved")).toBe("secondary");
    expect(statusBadgeVariant("cancelled")).toBe("outline");
  });

  it("labels every status", () => {
    const all: ProductRequestStatus[] = ["pending", "approved", "rejected", "cancelled"];
    for (const s of all) {
      expect(STATUS_LABEL[s]).toBeTruthy();
    }
  });
});

describe("canCancel", () => {
  const pending = { status: "pending" as const, requestedByUid: "manager-1" };

  it("lets the requester withdraw their own pending request", () => {
    expect(canCancel(pending, "manager-1", false)).toBe(true);
  });

  it("lets a platform admin withdraw anyone's pending request", () => {
    expect(canCancel(pending, "admin-9", true)).toBe(true);
  });

  it("blocks a different manager at the same store", () => {
    expect(canCancel(pending, "manager-2", false)).toBe(false);
  });

  it("blocks anonymous callers", () => {
    expect(canCancel(pending, null, false)).toBe(false);
    expect(canCancel(pending, undefined, false)).toBe(false);
  });

  it("blocks every non-pending status, even for the requester and admins", () => {
    const decided: ProductRequestStatus[] = ["approved", "rejected", "cancelled"];
    for (const status of decided) {
      expect(canCancel({ status, requestedByUid: "manager-1" }, "manager-1", false)).toBe(false);
      expect(canCancel({ status, requestedByUid: "manager-1" }, "admin-9", true)).toBe(false);
    }
  });
});

describe("canEnableAddon", () => {
  it("requires both a positive price and a kitchen station", () => {
    expect(canEnableAddon(75, "kitchen-1")).toBe(true);
    expect(canEnableAddon(0, "kitchen-1")).toBe(false);
    expect(canEnableAddon(-5, "kitchen-1")).toBe(false);
    expect(canEnableAddon(75, null)).toBe(false);
    expect(canEnableAddon(75, undefined)).toBe(false);
    expect(canEnableAddon(75, "")).toBe(false);
  });
});
