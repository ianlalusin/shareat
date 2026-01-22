'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { auth } from '@/lib/firebase/client';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It throws any received error to be caught by Next.js's global-error.tsx,
 * but intelligently suppresses errors that occur during the logout process.
 */
export function FirebaseErrorListener() {
  const [error, setError] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      // If there's no authenticated user, permission errors are expected,
      // especially during logout. We can suppress the error overlay in this case.
      if (auth.currentUser) {
        setError(error);
      } else {
        // Log a warning for debugging, but don't throw to the UI.
        console.warn("Suppressed Firestore permission error for unauthenticated user.", {
            message: error.message
        });
      }
    };

    errorEmitter.on('permission-error', handleError);

    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  // On re-render, if an error exists in state, throw it.
  if (error) {
    throw error;
  }

  // This component renders nothing.
  return null;
}
