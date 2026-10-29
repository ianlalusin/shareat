import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

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

// ---------------------------------------------------------------------------
// Atomic verify + lockout (audit B21, 2026-10-29)
// ---------------------------------------------------------------------------

/** Throttle: brute-forcing 10^6 passcodes online should be hopeless. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;

export type VerifyOutcome =
  | { kind: "ok"; name: string }
  | { kind: "wrong" }
  | { kind: "locked"; minutes: number }
  | { kind: "not-found" }
  | { kind: "no-secret" };

/**
 * Checks a local profile's passcode and does the lockout bookkeeping in ONE
 * Firestore transaction.
 *
 * It used to read failedAttempts outside any transaction and then write
 * old+1, so N concurrent wrong guesses all saw the same count and recorded a
 * single failure — the 5-try lockout could be bypassed by firing guesses in
 * parallel. Inside a transaction the Admin SDK locks the secret doc, so
 * concurrent attempts serialize: each sees the previous one's count, and the
 * lockout check happens in the same step that records the attempt. The same
 * transaction also means a successful verify cannot overwrite a manager's
 * concurrent reset (the read secret changed → the transaction retries).
 *
 * A passcode that is not six digits can never be right, so it is rejected
 * before any hashing and is not counted.
 */
/**
 * Fail-closed switch for the legacy fallback (audit B20, 2026-10-29).
 *
 * While OFF (the default), a profile with no serverProfileSecrets doc may still
 * sign in with the legacy `passcodeHash` on its own (client-readable) profile
 * doc. Turn it ON — SERVER_PROFILE_REQUIRE_SECRET_DOC=true — only AFTER
 * scripts/migrate-server-profile-secrets.ts --commit has moved every legacy
 * hash; from then on a profile without a secret doc can never authenticate,
 * whatever its profile doc says.
 */
export function secretDocRequired(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.SERVER_PROFILE_REQUIRE_SECRET_DOC ?? "").trim().toLowerCase() === "true";
}

export async function verifyProfilePasscodeAtomic(
  db: Firestore,
  storeId: string,
  profileId: string,
  passcode: string,
  now: number = Date.now(),
  requireSecretDoc: boolean = secretDocRequired()
): Promise<VerifyOutcome> {
  if (!profileId || profileId.includes("/")) return { kind: "not-found" };
  if (!isValidPasscode(passcode)) return { kind: "wrong" };

  const pRef = db.doc(`stores/${storeId}/serverProfiles/${profileId}`);
  const sRef = db.doc(`stores/${storeId}/serverProfileSecrets/${profileId}`);

  return db.runTransaction(async (tx) => {
    const pSnap = await tx.get(pRef);
    const sSnap = await tx.get(sRef);
    if (!pSnap.exists) return { kind: "not-found" } as const;
    const profile = (pSnap.data() ?? {}) as Record<string, unknown>;
    const secret = sSnap.exists ? ((sSnap.data() ?? {}) as Record<string, unknown>) : null;

    const lockedUntil = Number(secret?.lockedUntilMs ?? 0);
    if (lockedUntil > now) {
      return { kind: "locked", minutes: Math.ceil((lockedUntil - now) / 60000) } as const;
    }

    // Backwards compatibility during migration: a profile whose hash has not
    // been moved yet still carries the legacy field on its own doc. Clients can
    // no longer write that field (firestore.rules, audit B20). Once the
    // migration has run, requireSecretDoc disables this path entirely.
    const record: SecretRecord | null = secret
      ? { algo: secret.algo as SecretRecord["algo"], hash: secret.hash as string, salt: secret.salt as string | undefined }
      : !requireSecretDoc && typeof profile.passcodeHash === "string"
        ? { algo: "sha256-legacy", hash: profile.passcodeHash }
        : null;
    if (!record) return { kind: "no-secret" } as const;

    const { ok, needsUpgrade } = verifyPasscode(record, storeId, passcode);

    if (!ok) {
      const failed = Number(secret?.failedAttempts ?? 0) + 1;
      tx.set(
        sRef,
        {
          profileId,
          // Preserve whatever we verified against so a failure cannot wipe the
          // secret for a not-yet-migrated profile.
          ...(secret ? {} : { algo: record.algo, hash: record.hash, ...(record.salt ? { salt: record.salt } : {}) }),
          failedAttempts: failed,
          lockedUntilMs: failed >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { kind: "wrong" } as const;
    }

    // Correct passcode. Re-wrap a legacy hash with scrypt so the fleet
    // upgrades itself as people sign in.
    const upgrade = needsUpgrade ? hashPasscodeScrypt(passcode) : null;
    tx.set(
      sRef,
      {
        profileId,
        ...(upgrade ?? {}),
        ...(secret || upgrade ? {} : { algo: record.algo, hash: record.hash }),
        failedAttempts: 0,
        lockedUntilMs: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const patch: Record<string, unknown> = { lastLoginAt: FieldValue.serverTimestamp() };
    // Once the secret is safely stored elsewhere, drop the readable copy.
    if (upgrade && typeof profile.passcodeHash === "string") {
      patch.passcodeHash = FieldValue.delete();
    }
    tx.update(pRef, patch);

    return { kind: "ok", name: String(profile.name ?? "") } as const;
  });
}
