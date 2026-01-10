
'use client';

import { auth } from '@/lib/firebase/client';
import { 
    EmailAuthProvider, 
    reauthenticateWithCredential,
    updatePassword,
    GoogleAuthProvider,
    linkWithPopup,
    linkWithRedirect,
    sendPasswordResetEmail,
    type User
} from 'firebase/auth';

/**
 * Re-authenticates the user with their current password and then updates it.
 * @param currentPassword The user's current password.
 * @param newPassword The new password to set.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = auth.currentUser;
    if (!user || !user.email) {
        throw new Error("No authenticated user found.");
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    
    // Re-authenticate to prove identity
    await reauthenticateWithCredential(user, credential);

    // If re-authentication is successful, update the password
    await updatePassword(user, newPassword);
}

/**
 * Links the current user's account with a Google account.
 * Handles popup and redirect flows.
 * @param user The current Firebase user object.
 */
export async function linkWithGoogle(user: User): Promise<void> {
    const provider = new GoogleAuthProvider();
    try {
        await linkWithPopup(user, provider);
    } catch (error: any) {
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
            // Fallback to redirect if popup is blocked or closed by user
            await linkWithRedirect(user, provider);
        } else {
            // Re-throw other errors to be handled by the caller
            throw error;
        }
    }
}

/**
 * Sends a password reset email to the specified email address.
 * @param email The user's email address.
 */
export async function sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(auth, email);
}

