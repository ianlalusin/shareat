import { describe, expect, it } from "vitest";
import {
  hashPasscodeLegacy,
  hashPasscodeScrypt,
  isValidPasscode,
  verifyPasscode,
} from "@/lib/server/server-profile-secrets";

const STORE = "storeA";

describe("scrypt records", () => {
  it("verifies the passcode it was created from", () => {
    const rec = hashPasscodeScrypt("123456");
    expect(verifyPasscode(rec, STORE, "123456")).toEqual({ ok: true, needsUpgrade: false });
  });

  it("rejects a wrong passcode", () => {
    const rec = hashPasscodeScrypt("123456");
    expect(verifyPasscode(rec, STORE, "123457").ok).toBe(false);
    expect(verifyPasscode(rec, STORE, "").ok).toBe(false);
  });

  it("salts, so the same passcode never yields the same hash twice", () => {
    const a = hashPasscodeScrypt("123456");
    const b = hashPasscodeScrypt("123456");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify.
    expect(verifyPasscode(a, STORE, "123456").ok).toBe(true);
    expect(verifyPasscode(b, STORE, "123456").ok).toBe(true);
  });

  it("is not store-scoped, so a hash cannot be replayed by store id alone", () => {
    const rec = hashPasscodeScrypt("123456");
    expect(verifyPasscode(rec, "some-other-store", "123456").ok).toBe(true);
  });
});

describe("legacy sha256 records", () => {
  it("verifies an existing passcode and flags it for upgrade", () => {
    const rec = { algo: "sha256-legacy" as const, hash: hashPasscodeLegacy(STORE, "654321") };
    expect(verifyPasscode(rec, STORE, "654321")).toEqual({ ok: true, needsUpgrade: true });
  });

  it("rejects a wrong passcode without flagging an upgrade", () => {
    const rec = { algo: "sha256-legacy" as const, hash: hashPasscodeLegacy(STORE, "654321") };
    expect(verifyPasscode(rec, STORE, "111111")).toEqual({ ok: false, needsUpgrade: false });
  });

  it("is store-scoped, matching the original scheme", () => {
    const rec = { algo: "sha256-legacy" as const, hash: hashPasscodeLegacy(STORE, "654321") };
    expect(verifyPasscode(rec, "different-store", "654321").ok).toBe(false);
  });
});

describe("malformed records fail closed", () => {
  it("rejects null and undefined", () => {
    expect(verifyPasscode(null, STORE, "123456").ok).toBe(false);
    expect(verifyPasscode(undefined, STORE, "123456").ok).toBe(false);
  });

  it("rejects a scrypt record with no salt", () => {
    const rec = { algo: "scrypt" as const, hash: "deadbeef" };
    expect(verifyPasscode(rec, STORE, "123456").ok).toBe(false);
  });

  it("rejects an unknown algorithm", () => {
    const rec = { algo: "md5" as any, hash: hashPasscodeLegacy(STORE, "654321") };
    expect(verifyPasscode(rec, STORE, "654321").ok).toBe(false);
  });

  it("rejects a non-string hash without throwing", () => {
    expect(verifyPasscode({ algo: "scrypt", hash: 123 as any, salt: "aa" }, STORE, "1").ok).toBe(false);
  });

  it("rejects a hash of the wrong length without throwing", () => {
    const rec = hashPasscodeScrypt("123456");
    expect(verifyPasscode({ ...rec, hash: rec.hash.slice(0, 10) }, STORE, "123456").ok).toBe(false);
  });

  it("rejects non-hex garbage without throwing", () => {
    const rec = hashPasscodeScrypt("123456");
    expect(verifyPasscode({ ...rec, hash: "z".repeat(rec.hash.length) }, STORE, "123456").ok).toBe(false);
  });
});

describe("isValidPasscode", () => {
  it("accepts exactly 6 digits", () => {
    expect(isValidPasscode("000000")).toBe(true);
    expect(isValidPasscode("987654")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["12345", "1234567", "12345a", "", "  1234", null, undefined, 123456]) {
      expect(isValidPasscode(bad as any)).toBe(false);
    }
  });
});
