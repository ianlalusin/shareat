import { describe, it, expect } from "vitest";
import { computeChatResponseDeltas } from "./applyChatResponseServer";
import type { PresenceEvent } from "@/lib/chat/presence";

describe("computeChatResponseDeltas", () => {
  it("credits the responder's timeliness and their own on-duty efficiency in the normal case", () => {
    const presence: PresenceEvent[] = [{ profileId: "p1", profileName: "Cashier One", event: "signin", atClientMs: 0 }];
    const { stamps, dayAggs } = computeChatResponseDeltas(
      [{ id: "m1", createdAtClientMs: 1000 }],
      presence, "p1", "Cashier One", 1000 + 30_000,
    );
    expect(stamps.get("m1")).toEqual({ responseMs: 30_000, onDutyProfileIdAtArrival: "p1" });
    const day = [...dayAggs.values()][0];
    expect(day.responseCount.p1).toBe(1);
    expect(day.within2Min.p1).toBe(1);
    expect(day.receivedWhileOnDuty.p1).toBe(1);
    expect(day.answeredWhileOnDuty.p1).toBe(1);
  });

  it("does not credit efficiency to a rescuing cashier, and does not add to their receivedWhileOnDuty", () => {
    const presence: PresenceEvent[] = [
      { profileId: "p1", profileName: "Cashier One", event: "signin", atClientMs: 0 },
      { profileId: "p1", profileName: "Cashier One", event: "signout", atClientMs: 600_000 },
      { profileId: "p2", profileName: "Cashier Two", event: "signin", atClientMs: 600_000 },
    ];
    // Message arrived at t=0 (on cashier1's watch), answered by cashier2 at t=600_030 (30s after cashier2 signed in)
    const { stamps, dayAggs } = computeChatResponseDeltas(
      [{ id: "m1", createdAtClientMs: 0 }],
      presence, "p2", "Cashier Two", 600_030,
    );
    // cashier2's fair time is only 30s (clocked from their own on-duty start), not 600_030ms
    expect(stamps.get("m1")?.responseMs).toBe(30);
    expect(stamps.get("m1")?.onDutyProfileIdAtArrival).toBe("p1");
    const day = [...dayAggs.values()][0];
    expect(day.responseCount.p2).toBe(1); // cashier2 gets timeliness credit for answering
    expect(day.within2Min.p2).toBe(1);
    expect(day.receivedWhileOnDuty.p1).toBe(1); // charged to cashier1 (arrival), not cashier2
    expect(day.receivedWhileOnDuty.p2).toBeUndefined();
    expect(day.answeredWhileOnDuty.p1).toBeUndefined(); // cashier1 never answered it
  });

  it("skips efficiency attribution entirely when nobody was on duty at arrival", () => {
    const { dayAggs } = computeChatResponseDeltas(
      [{ id: "m1", createdAtClientMs: 0 }], [], "p1", "Cashier One", 30_000,
    );
    const day = [...dayAggs.values()][0];
    expect(day.receivedWhileOnDuty).toEqual({});
    expect(day.responseCount.p1).toBe(1); // responder still gets timeliness credit
  });
});
