/**
 * Break-glass: grant the `platformAdmin` custom claim to a UID.
 *
 * This is the ONLY door back in when the staff-doc branch of isAdmin() cannot
 * let anyone through — e.g. every admin's staff doc is missing or not
 * status == 'active', which would otherwise lock admins out of /admin/users
 * itself. firestore.rules keeps the claim deliberately un-status-gated for
 * exactly this reason, so this script has to work on the worst day.
 *
 * Credential resolution, in order:
 *   1. FIREBASE_ADMIN_SA_PATH        (env, or .env.local — how this repo is set up)
 *   2. GOOGLE_APPLICATION_CREDENTIALS (env)
 *   3. .secrets/serviceAccountKey.json (legacy default)
 *
 * It previously hardcoded (3) only, which does not exist on the dev machine —
 * the escape hatch was unrunnable. Prints the resolved project before writing,
 * because the same repo has neighbours in other Firebase projects and granting
 * admin on the wrong one is not something you want to discover later.
 *
 *   node scripts/set-platform-admin.mjs <UID>
 *   node scripts/set-platform-admin.mjs <UID> --revoke
 */
import admin from "firebase-admin";
import { existsSync, readFileSync } from "fs";

/** Minimal .env.local reader — no dotenv dependency, so this runs from a bare checkout. */
function fromEnvFile(key) {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function resolveServiceAccountPath() {
  const candidates = [
    process.env.FIREBASE_ADMIN_SA_PATH,
    fromEnvFile("FIREBASE_ADMIN_SA_PATH"),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    ".secrets/serviceAccountKey.json",
  ].filter(Boolean);

  for (const p of candidates) if (existsSync(p)) return p;

  console.error(
    "No service account found. Tried:\n" +
      candidates.map((c) => `  - ${c}`).join("\n") +
      "\n\nSet FIREBASE_ADMIN_SA_PATH in .env.local to a service-account JSON with the\n" +
      "Firebase Authentication Admin role on the POS project."
  );
  process.exit(1);
}

const uid = process.argv[2];
const revoke = process.argv.includes("--revoke");
if (!uid || uid.startsWith("--")) {
  console.error("Usage: node scripts/set-platform-admin.mjs <UID> [--revoke]");
  process.exit(1);
}

const saPath = resolveServiceAccountPath();
const sa = JSON.parse(readFileSync(saPath, "utf8"));

// Surfaced before the write: this repo's .firebaserc default has pointed at a
// stale project before, and a per-directory `firebase use` can silently retarget
// the CLI. Confirm this is the POS project you meant.
console.log("Service account:", saPath);
console.log("Project:        ", sa.project_id);

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });

// Fail loudly on an unknown uid rather than writing a claim into the void —
// setCustomUserClaims on a non-existent uid throws, but the message is opaque.
let target;
try {
  target = await admin.auth().getUser(uid);
} catch {
  console.error(`No Firebase Auth user with uid ${uid} in ${sa.project_id}.`);
  process.exit(1);
}

// Merge rather than replace: setCustomUserClaims overwrites the whole claims
// object, so a blind write would silently drop any other claim the user carries.
const existing = target.customClaims ?? {};
const next = { ...existing };
if (revoke) delete next.platformAdmin;
else next.platformAdmin = true;

await admin.auth().setCustomUserClaims(uid, next);

const after = await admin.auth().getUser(uid);
console.log(revoke ? "Revoked platformAdmin" : "Granted platformAdmin", "for", target.email ?? uid);
console.log("Claims now:     ", after.customClaims ?? {});
console.log(
  "\nThe claim rides in the ID token, so it takes effect on the user's next token\n" +
    "refresh — sign out and back in to pick it up immediately."
);
process.exit(0);
