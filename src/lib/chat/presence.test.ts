import { describe, it, expect } from "vitest";
import { resolveOnDutyAt, resolveOnDutySince, type PresenceEvent } from "./presence";

const ev = (profileId: string, event: "signin" | "signout", atClientMs: number, profileName = profileId): PresenceEvent =>
  ({ profileId, profileName, event, atClientMs });

describe("resolveOnDutyAt", () => {
  it("returns null when nobody has signed in yet", () => {
    expect(resolveOnDutyAt([], 1000)).toBeNull();
  });

  it("returns the signed-in profile at the query time", () => {
    const events = [ev("p1", "signin", 100)];
    expect(resolveOnDutyAt(events, 500)).toEqual({ profileId: "p1", profileName: "p1" });
  });

  it("returns null after a signout", () => {
    const events = [ev("p1", "signin", 100), ev("p1", "signout", 200)];
    expect(resolveOnDutyAt(events, 500)).toBeNull();
  });

  it("reflects a handover to a second profile", () => {
    const events = [
      ev("p1", "signin", 100),
      ev("p1", "signout", 300),
      ev("p2", "signin", 300),
    ];
    expect(resolveOnDutyAt(events, 250)).toEqual({ profileId: "p1", profileName: "p1" });
    expect(resolveOnDutyAt(events, 400)).toEqual({ profileId: "p2", profileName: "p2" });
  });

  it("ignores events after the query time", () => {
    const events = [ev("p1", "signin", 100), ev("p2", "signin", 900)];
    expect(resolveOnDutyAt(events, 500)).toEqual({ profileId: "p1", profileName: "p1" });
  });
});

describe("resolveOnDutySince", () => {
  it("returns null when the profile was never signed in by atMs", () => {
    expect(resolveOnDutySince([ev("p1", "signin", 900)], "p1", 500)).toBeNull();
  });

  it("returns the signin timestamp of the current stretch", () => {
    const events = [ev("p1", "signin", 100), ev("p1", "signout", 200), ev("p1", "signin", 300)];
    expect(resolveOnDutySince(events, "p1", 500)).toBe(300);
  });

  it("returns null once that profile has signed out", () => {
    const events = [ev("p1", "signin", 100), ev("p1", "signout", 200)];
    expect(resolveOnDutySince(events, "p1", 500)).toBeNull();
  });
});
