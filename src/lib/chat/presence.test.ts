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

  // A handover writes signout+signin in one go, so both halves routinely carry
  // the IDENTICAL atClientMs and Firestore may hand them back in either order.
  // The comparator — not the input order — must decide the outcome.
  it("resolves a same-millisecond handover identically whichever order the events arrive in", () => {
    const signout = ev("p1", "signout", 300);
    const signin = ev("p2", "signin", 300);
    const inOrder = [ev("p1", "signin", 100), signout, signin];
    const reversedTie = [ev("p1", "signin", 100), signin, signout];
    expect(resolveOnDutyAt(reversedTie, 400)).toEqual(resolveOnDutyAt(inOrder, 400));
    expect(resolveOnDutyAt(reversedTie, 400)).toEqual({ profileId: "p2", profileName: "p2" });
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

  // Same tie as above, from the incoming cashier's side: their own on-duty
  // start must be the signin, never null, regardless of array order.
  it("clocks a same-millisecond handover identically whichever order the events arrive in", () => {
    const signout = ev("p1", "signout", 300);
    const signin = ev("p2", "signin", 300);
    const inOrder = [ev("p1", "signin", 100), signout, signin];
    const reversedTie = [ev("p1", "signin", 100), signin, signout];
    expect(resolveOnDutySince(reversedTie, "p2", 400)).toBe(resolveOnDutySince(inOrder, "p2", 400));
    expect(resolveOnDutySince(reversedTie, "p2", 400)).toBe(300);
    // ...and the outgoing cashier is off duty either way.
    expect(resolveOnDutySince(reversedTie, "p1", 400)).toBe(resolveOnDutySince(inOrder, "p1", 400));
    expect(resolveOnDutySince(reversedTie, "p1", 400)).toBeNull();
  });

  // resolveOnDutySince filters to ONE profile, so the tie it actually has to
  // survive is a same-profile signout+signin at the same instant (a re-sign-in).
  // Signout-first is what keeps them on duty; the reverse reading would drop
  // them to null and silently discard a real wait.
  it("keeps a same-profile, same-millisecond re-signin on duty in either array order", () => {
    const signout = ev("p1", "signout", 300);
    const signin = ev("p1", "signin", 300);
    const inOrder = [ev("p1", "signin", 100), signout, signin];
    const reversedTie = [ev("p1", "signin", 100), signin, signout];
    expect(resolveOnDutySince(reversedTie, "p1", 400)).toBe(resolveOnDutySince(inOrder, "p1", 400));
    expect(resolveOnDutySince(reversedTie, "p1", 400)).toBe(300);
  });
});
