import { describe, expect, it } from "vitest";
import { resolveStoredProfile } from "./profile-session";

// Regression for audit F02 / NOV-PROFILE (2026-11-03): the offline and the
// "unreachable" (5 s check-session timeout) rehydrate paths used to accept a
// stored profile after reading its claims only, so `body.fake-signature`
// restored any operator. Ported from
// shareat-audits/OPEN/pos-v1/sev5-advanced-reproductions-2026-11-03.test.ts.

describe("fabricated local-profile grant", () => {
  it("is rejected offline and when check-session is unreachable", async () => {
    const now = 1_800_000_000_000;
    const token =
      Buffer.from(
        JSON.stringify({ v: 1, uid: "shared-cashier", sid: "s1", pid: "other-operator", iat: now, exp: now + 86_400_000 })
      ).toString("base64url") + ".fake-signature";
    const raw = JSON.stringify({ profileId: "other-operator", name: "Impersonated", token, expiresAt: now + 86_400_000 });
    for (const online of [false, true]) {
      const res = await resolveStoredProfile({
        raw,
        uid: "shared-cashier",
        storeId: "s1",
        now,
        online,
        verifyRemote: async () => ({ kind: "unreachable" }),
      });
      expect(res.profile, `online=${online}`).toBeNull();
    }
  });

  it("rejects a fabricated three-part ES256-shaped grant offline and on timeout", async () => {
    const now = 1_800_000_000_000;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const header = b64({ alg: "ES256", typ: "SPG", kid: "spg-20261103" });
    const body = b64({
      v: 2,
      iss: "shareat-pos:server-profile-grant",
      uid: "shared-cashier",
      sid: "s1",
      pid: "other-operator",
      nm: "Impersonated",
      iat: now,
      exp: now + 3_600_000,
    });
    const token = `${header}.${body}.${Buffer.alloc(64, 7).toString("base64url")}`;
    const raw = JSON.stringify({ profileId: "other-operator", name: "Impersonated", token, expiresAt: now + 3_600_000 });
    for (const online of [false, true]) {
      const res = await resolveStoredProfile({
        raw,
        uid: "shared-cashier",
        storeId: "s1",
        now,
        online,
        verifyRemote: async () => ({ kind: "unreachable" }),
      });
      expect(res.profile, `online=${online}`).toBeNull();
    }
  });
});
