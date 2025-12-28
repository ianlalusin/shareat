
"use client";

import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { firebaseConfig } from "@/firebase/config";

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

const auth = getAuth(app);
// Initialize with ignoreUndefinedProperties to prevent crashes.
const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
const storage = getStorage(app);

export async function uploadProductImage(productId: string, file: File): Promise<string> {
    if (!productId) {
        throw new Error("Product ID is required to upload an image.");
    }

    const storageRef = ref(storage, `Items/${productId}.webp`);
    
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    const productDocRef = doc(db, "products", productId);
    await updateDoc(productDocRef, {
        imageUrl: downloadURL,
        updatedAt: serverTimestamp(),
    });

    return downloadURL;
}

export async function uploadUserAvatar(userId: string, file: File): Promise<string> {
    if (!userId) {
        throw new Error("User ID is required to upload an avatar.");
    }
    const storageRef = ref(storage, `users/${userId}/avatar.jpg`);
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);
    const userDocRef = doc(db, "users", userId);
    await updateDoc(userDocRef, {
        photoURL: downloadURL,
        updatedAt: serverTimestamp(),
    });
    return downloadURL;
}


export { app, auth, db, storage };

    