import admin from "firebase-admin";
import { readFileSync } from "fs";

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(".secrets/serviceAccountKey.json", "utf8"))
  ),
});

const uid = process.argv[2];
if (!uid) {
  console.error("Usage: node scripts/set-platform-admin.mjs <UID>");
  process.exit(1);
}

await admin.auth().setCustomUserClaims(uid, { platformAdmin: true });

const user = await admin.auth().getUser(uid);
console.log("✅ Updated claims:", user.customClaims);
console.log("✅ UID:", uid);
process.exit(0);
