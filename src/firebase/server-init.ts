
import { initializeApp, getApps, App } from 'firebase-admin/app';
import { credential } from 'firebase-admin';

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
  : null;

let adminApp: App;

export function initFirebaseAdmin() {
  if (!getApps().length) {
    if (serviceAccount) {
      adminApp = initializeApp({
        credential: credential.cert(serviceAccount),
      });
    } else {
      // Initialize without credentials for local/emulator development
      // or if service account is configured via GOOGLE_APPLICATION_CREDENTIALS
      adminApp = initializeApp();
    }
  } else {
    adminApp = getApps()[0];
  }
  return adminApp;
}
