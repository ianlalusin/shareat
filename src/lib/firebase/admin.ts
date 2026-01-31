'use server';

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Initializes the Firebase Admin SDK if it hasn't been already.
 * This function is designed to be called at runtime, not at the module level.
 * It safely handles environment variables for different deployment scenarios.
 */
function initializeAdminApp(): App {
  // If an app is already initialized, return it.
  if (getApps().length) {
    return getApps()[0];
  }

  // Try to use individual environment variables for service account credentials.
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Environment variables might escape newlines, so we need to replace them back.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    try {
      return initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } catch (e) {
      console.error("Firebase Admin SDK initialization failed with explicit credentials:", e);
      // Fall through to default initialization if explicit fails, which might work in some environments.
    }
  }

  // Fallback for environments like Google Cloud Functions, Cloud Run, or Firebase App Hosting
  // where Application Default Credentials (ADC) are available.
  // This will throw a descriptive error at runtime if no credentials can be found at all.
  return initializeApp();
}

/**
 * Gets the singleton Firebase Admin App instance, initializing it if necessary.
 * @returns The initialized Firebase Admin App.
 */
export function getAdminApp(): App {
  return initializeAdminApp();
}

/**
 * Gets the Firebase Admin Auth service.
 * @returns The Firebase Admin Auth service instance.
 */
export function getAdminAuth() {
  return getAuth(getAdminApp());
}

/**
 * Gets the Firebase Admin Firestore service.
 * @returns The Firebase Admin Firestore service instance.
 */
export function getAdminDb() {
  return getFirestore(getAdminApp());
}
