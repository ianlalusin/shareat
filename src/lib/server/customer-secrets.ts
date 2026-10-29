import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Where a Sharelebrator customer's password hash lives (audit B05, 2026-10-29).
 *
 * It used to sit on customers/{phone} itself, next to name/points, so anything
 * allowed to read the profile could also take the bcrypt verifier offline.
 * The secret now lives at customers/{phone}/secrets/auth. No rule grants any
 * client read or write there: firestore.rules has an explicit `if false`
 * block for it inside the customers match, and both root read fallbacks
 * already exclude the whole `customers` tree. Only the Admin SDK reaches it.
 *
 * (A subcollection rather than a new top-level `customerSecrets` collection so
 * the root fallbacks need no new exclusion — a top-level collection would have
 * been readable by every active staffer until someone remembered to add it.)
 *
 * Transition: until the CUSTOMER app's login/signup/link-session/update-profile
 * routes read and write this location, the legacy `passwordHash` field on the
 * profile doc stays the source of truth and POS dual-writes both. Set
 * CUSTOMER_SECRETS_LEGACY_FIELD=off once CUSTOMER has shipped the change and
 * scripts/migrate-customer-secrets.ts --remove-legacy has run; POS then writes
 * only the secret doc and deletes any leftover legacy field.
 */

export const CUSTOMER_SECRET_DOC_ID = "auth";

export function customerSecretPath(phone: string): string {
  return `customers/${phone}/secrets/${CUSTOMER_SECRET_DOC_ID}`;
}

/** Default ON (dual-write). Only the literal "off" stops writing the legacy field. */
export function legacyPasswordFieldEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CUSTOMER_SECRETS_LEGACY_FIELD ?? "").trim().toLowerCase() !== "off";
}

/**
 * Writes a new password hash to the secret doc and (while dual-writing) to the
 * legacy profile field, in one batch so the two can never disagree.
 * `profilePatch` is merged into the profile update (reset metadata etc.).
 */
export async function writeCustomerPasswordHash(
  db: Firestore,
  phone: string,
  passwordHash: string,
  profilePatch: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  const batch = db.batch();
  batch.set(
    db.doc(customerSecretPath(phone)),
    { passwordHash, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  batch.update(db.doc(`customers/${phone}`), {
    ...profilePatch,
    passwordHash: legacyPasswordFieldEnabled(env) ? passwordHash : FieldValue.delete(),
  });
  await batch.commit();
}
