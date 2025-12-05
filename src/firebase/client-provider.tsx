'use client';

import React from 'react';
import { FirebaseProvider } from './provider';
import { initializeFirebase } from '.';

export const FirebaseClientProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const firebase = initializeFirebase();
  return (
    <FirebaseProvider
      value={{
        firebaseApp: firebase.firebaseApp,
        auth: firebase.auth,
        firestore: firebase.firestore,
        storage: firebase.storage,
      }}
    >
      {children}
    </FirebaseProvider>
  );
};
