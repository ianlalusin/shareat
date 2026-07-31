import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Passcode hashing for local (device) server profiles.
 *
 * These passcodes are 6 digits — only 10^6 candidates — so the hash must never
 * be readable by clients. It lives in stores/{storeId}/serverProfileSecrets,
 * which firestore.rules excludes from the store catch-all's read grant, and is
 * only ever compared server-side by /api/server-profiles.
 *
 * The legacy scheme was unsalted SHA-256 of `${storeId}:${passcode}` stored on
 * the profile document itself, which every active staff member of the store
 * could read — a sub-second offline crack. Legacy hashes are still verifiable
 * here so nobody's passcode has to change, and each one is re-wrapped to scrypt
 * on its next successful sign-in.
 */

export type SecretRecord = {
  algo: "scrypt" | "sha256-legacy";
  hash: string;
  salt?: string;
};

const KEYLEN = 64;

export function hashPasscodeScrypt(passcode: string): SecretRecord {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(passcode, salt, KEYLEN).toString("hex");
  return { algo: "scrypt", hash, salt };
}

/** The pre-migration scheme. Kept only so existing passcodes keep working. */
export function hashPasscodeLegacy(storeId: string, passcode: string): string {
  return createHash("sha256").update(`${storeId}:${passcode}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  // timingSafeEqual throws on length mismatch, which would itself leak a bit;
  // compare lengths first and keep the constant-time path for equal lengths.
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verifies a passcode against a stored record.
 *
 * `needsUpgrade` is true when a legacy hash matched, signalling the caller to
 * re-wrap it with scrypt.
 */
export function verifyPasscode(
  record: SecretRecord | null | undefined,
  storeId: string,
  passcode: string
): { ok: boolean; needsUpgrade: boolean } {
  if (!record || typeof record.hash !== "string") return { ok: false, needsUpgrade: false };

  if (record.algo === "scrypt") {
    if (!record.salt) return { ok: false, needsUpgrade: false };
    const candidate = scryptSync(passcode, record.salt, KEYLEN).toString("hex");
    return { ok: safeEqualHex(candidate, record.hash), needsUpgrade: false };
  }

  if (record.algo === "sha256-legacy") {
    const ok = safeEqualHex(hashPasscodeLegacy(storeId, passcode), record.hash);
    return { ok, needsUpgrade: ok };
  }

  return { ok: false, needsUpgrade: false };
}

/** Passcodes are entered on a numeric keypad; keep the server in agreement. */
export function isValidPasscode(passcode: unknown): passcode is string {
  return typeof passcode === "string" && /^\d{6}$/.test(passcode);
}
