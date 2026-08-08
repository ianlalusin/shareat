import { describe, expect, it } from "vitest";
import { generateTempPassword } from "@/lib/server/temp-password";

const AMBIGUOUS = ["0", "O", "o", "1", "l", "I", "5", "S", "s", "8", "B"];

describe("generateTempPassword", () => {
  it("meets Firebase's minimum length with margin", () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(12);
  });

  it("omits characters that get misread when transcribed by hand", () => {
    // 200 samples: any ambiguous character in the alphabet would show up well
    // before this with 14 draws each.
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      for (const ch of AMBIGUOUS) {
        expect(pw).not.toContain(ch);
      }
    }
  });

  it("uses only alphanumerics, so it survives being read aloud or pasted", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateTempPassword());
    expect(seen.size).toBe(500);
  });

  it("draws across the whole alphabet rather than a narrow slice", () => {
    // Guards against the modulo-bias failure mode of randomBytes[i] % len,
    // which would starve the tail of the alphabet.
    const chars = new Set<string>();
    for (let i = 0; i < 300; i++) {
      for (const ch of generateTempPassword()) chars.add(ch);
    }
    // 47-character alphabet; 4200 draws should cover essentially all of it.
    expect(chars.size).toBeGreaterThanOrEqual(44);
  });
});
