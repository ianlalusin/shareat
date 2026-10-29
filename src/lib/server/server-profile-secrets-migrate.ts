import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Moves legacy local-profile passcode hashes off the client-readable profile
 * doc (audit B20, 2026-10-29). Driven by scripts/migrate-server-profile-secrets.ts.
 *
 * Per profile, in one transaction:
 *   - legacy `passcodeHash` + no secret doc → write it to
 *     stores/{storeId}/serverProfileSecrets/{id} as algo "sha256-legacy"
 *     (verifyPasscode still accepts it and re-wraps it with scrypt on the next
 *     sign-in), then delete the readable field;
 *   - legacy field + secret doc that already has a hash → the secret doc wins
 *     (it is what the verifier already uses); just delete the readable field;
 *   - no legacy field and no secret → reported as "no-secret": that profile
 *     cannot sign in once SERVER_PROFILE_REQUIRE_SECRET_DOC is on and needs a
 *     manager passcode reset.
 *
 * Idempotent: a second run finds nothing to move.
 */

export type ProfileMigrationAction = "copy-and-strip" | "strip-only" | "already-migrated" | "no-secret";

export type StoreMigrationReport = {
  storeId: string;
  scanned: number;
  actions: Record<ProfileMigrationAction, string[]>;
};

function classify(profile: Record<string, unknown>, secret: Record<string, unknown> | null): ProfileMigrationAction {
  const legacy = typeof profile.passcodeHash === "string" && profile.passcodeHash.length > 0;
  const secretHasHash = !!secret && typeof secret.hash === "string" && secret.hash.length > 0;
  if (legacy && !secretHasHash) return "copy-and-strip";
  if (legacy && secretHasHash) return "strip-only";
  if (!legacy && secretHasHash) return "already-migrated";
  return "no-secret";
}

export async function migrateServerProfileSecretsForStore(
  db: Firestore,
  storeId: string,
  opts: { commit: boolean }
): Promise<StoreMigrationReport> {
  const report: StoreMigrationReport = {
    storeId,
    scanned: 0,
    actions: { "copy-and-strip": [], "strip-only": [], "already-migrated": [], "no-secret": [] },
  };

  const profiles = await db.collection(`stores/${storeId}/serverProfiles`).get();
  for (const p of profiles.docs) {
    report.scanned += 1;
    const pRef = db.doc(`stores/${storeId}/serverProfiles/${p.id}`);
    const sRef = db.doc(`stores/${storeId}/serverProfileSecrets/${p.id}`);

    if (!opts.commit) {
      const sSnap = await sRef.get();
      const action = classify((p.data() ?? {}) as Record<string, unknown>, sSnap.exists ? ((sSnap.data() ?? {}) as Record<string, unknown>) : null);
      report.actions[action].push(p.id);
      continue;
    }

    // Re-read both inside a transaction so a concurrent sign-in upgrade or
    // manager reset between the scan and the write is never clobbered.
    const action = await db.runTransaction(async (tx) => {
      const pSnap = await tx.get(pRef);
      const sSnap = await tx.get(sRef);
      if (!pSnap.exists) return "already-migrated" as const;
      const profile = (pSnap.data() ?? {}) as Record<string, unknown>;
      const secret = sSnap.exists ? ((sSnap.data() ?? {}) as Record<string, unknown>) : null;
      const a = classify(profile, secret);
      if (a === "copy-and-strip") {
        tx.set(
          sRef,
          {
            profileId: p.id,
            algo: "sha256-legacy",
            hash: profile.passcodeHash,
            failedAttempts: Number(secret?.failedAttempts ?? 0) || 0,
            lockedUntilMs: Number(secret?.lockedUntilMs ?? 0) || 0,
            migratedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      if (a === "copy-and-strip" || a === "strip-only") {
        tx.update(pRef, { passcodeHash: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      }
      return a;
    });
    report.actions[action].push(p.id);
  }
  return report;
}
