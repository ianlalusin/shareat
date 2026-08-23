import { describe, it, expect } from "vitest";
import { decideCatalogWrite } from "@/lib/server/customer-catalog-sweep";

/**
 * The sweep runs unattended every night against every active store. The only
 * thing standing between a bad source read and every branch's menu going blank
 * at once is this decision, so it is tested on its own.
 */
describe("decideCatalogWrite", () => {
  it("writes when the rebuild produced items", () => {
    expect(decideCatalogWrite(10, 12).action).toBe("write");
    expect(decideCatalogWrite(0, 3).action).toBe("write");
  });

  it("writes when both are empty — refreshes shape and timestamp harmlessly", () => {
    expect(decideCatalogWrite(0, 0).action).toBe("write");
  });

  it("REFUSES to blank a store that currently has a live menu", () => {
    const d = decideCatalogWrite(12, 0);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/blank/i);
  });

  it("writes a reduction that is not a blanking", () => {
    // Malvar legitimately went 12 -> 10 when it caught up to the
    // family-aware builder. A shrink is not by itself a failure.
    expect(decideCatalogWrite(12, 10).action).toBe("write");
    expect(decideCatalogWrite(12, 1).action).toBe("write");
  });

  it("treats a missing current count as no current menu", () => {
    expect(decideCatalogWrite(undefined, 0).action).toBe("write");
    expect(decideCatalogWrite(undefined, 5).action).toBe("write");
  });
});
