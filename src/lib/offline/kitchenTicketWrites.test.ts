import { describe, it, expect } from "vitest";
import { selectTicketWriter } from "@/lib/offline/kitchenTicketWrites";

describe("selectTicketWriter", () => {
  it("returns the transaction when opts has tx", () => {
    const tx = { set() {}, update() {} };
    expect(selectTicketWriter({ tx })).toBe(tx);
  });
  it("returns the batch when opts has batch", () => {
    const batch = { set() {}, update() {} };
    expect(selectTicketWriter({ batch })).toBe(batch);
  });
  it("prefers batch shape only when tx is absent (explicit branch)", () => {
    const batch = { set() {}, update() {} };
    const w = selectTicketWriter({ batch });
    expect(w).toBe(batch);
  });
});
