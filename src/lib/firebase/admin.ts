import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { ServiceAccount } from "firebase-admin";

export function getFirebaseAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];

  const saJson = process.env.FIREBASE_ADMIN_SA;
  if (!saJson) throw new Error("FIREBASE_ADMIN_SA is not set.");

  const serviceAccount = JSON.parse(saJson) as ServiceAccount;

  return initializeApp({
    credential: cert(serviceAccount),
  });
}
