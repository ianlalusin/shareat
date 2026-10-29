import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import { customerSecretPath } from "@/lib/server/customer-secrets";

/**
 * Moves Sharelebrator password hashes from customers/{phone}.passwordHash to
 * customers/{phone}/secrets/auth (audit B05, 2026-10-29). Driven by
 * scripts/migrate-customer-secrets.ts.
 *
 * Two phases, because the CUSTOMER app still reads the legacy field to log
 * people in:
 *   copy  (default)        copy each legacy hash into the secret doc, leave the
 *                          legacy field in place. Safe to run any time, and
 *                          safe to re-run: while dual-writing, the legacy field
 *                          is the source of truth, so a differing secret is
 *                          overwritten with it.
 *   strip (removeLegacy)   ONLY after CUSTOMER reads/writes the secret doc:
 *                          delete the legacy field. A missing secret is copied
 *                          first; a secret that DIFFERS from the legacy field is
 *                          left alone and reported as a conflict (one side was
 *                          changed by a writer that did not dual-write), never
 *                          guessed at.
 */

export type CustomerSecretAction = "copy" | "in-sync" | "strip" | "copy-and-strip" | "conflict" | "no-hash";

export type CustomerSecretReport = {
  scanned: number;
  counts: Record<CustomerSecretAction, number>;
  conflicts: string[];
};

function plan(
  legacy: string | null,
  secretHash: string | null,
  removeLegacy: boolean
): CustomerSecretAction {
  if (!legacy) return "no-hash";
  if (!removeLegacy) return secretHash === legacy ? "in-sync" : "copy";
  if (!secretHash) return "copy-and-strip";
  return secretHash === legacy ? "strip" : "conflict";
}

const PAGE = 300;

export async function migrateCustomerSecrets(
  db: Firestore,
  opts: { commit: boolean; removeLegacy: boolean }
): Promise<CustomerSecretReport> {
  const report: CustomerSecretReport = {
    scanned: 0,
    counts: { copy: 0, "in-sync": 0, strip: 0, "copy-and-strip": 0, conflict: 0, "no-hash": 0 },
    conflicts: [],
  };

  let lastId: string | null = null;
  for (;;) {
    let q = db.collection("customers").orderBy(FieldPath.documentId()).limit(PAGE);
    if (lastId) q = q.startAfter(lastId);
    const page = await q.get();
    if (page.empty) break;

    for (const d of page.docs) {
      report.scanned += 1;
      const phone = d.id;
      const cRef = db.doc(`customers/${phone}`);
      const sRef = db.doc(customerSecretPath(phone));

      const decide = (c: Record<string, unknown> | undefined, s: Record<string, unknown> | undefined) => {
        const legacy = typeof c?.passwordHash === "string" && c.passwordHash ? (c.passwordHash as string) : null;
        const secretHash = typeof s?.passwordHash === "string" && s.passwordHash ? (s.passwordHash as string) : null;
        return { legacy, action: plan(legacy, secretHash, opts.removeLegacy) };
      };

      let action: CustomerSecretAction;
      if (!opts.commit) {
        if (typeof d.data()?.passwordHash !== "string") {
          action = "no-hash";
        } else {
          const sSnap = await sRef.get();
          action = decide(d.data(), sSnap.exists ? sSnap.data() : undefined).action;
        }
      } else {
        action = await db.runTransaction(async (tx) => {
          const cSnap = await tx.get(cRef);
          const sSnap = await tx.get(sRef);
          if (!cSnap.exists) return "no-hash" as const;
          const { legacy, action: a } = decide(cSnap.data(), sSnap.exists ? sSnap.data() : undefined);
          if (a === "copy" || a === "copy-and-strip") {
            tx.set(
              sRef,
              { passwordHash: legacy, migratedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }
          if (a === "strip" || a === "copy-and-strip") {
            tx.update(cRef, { passwordHash: FieldValue.delete() });
          }
          return a;
        });
      }
      report.counts[action] += 1;
      if (action === "conflict") report.conflicts.push(phone);
    }

    lastId = page.docs[page.docs.length - 1].id;
    if (page.size < PAGE) break;
  }
  return report;
}
