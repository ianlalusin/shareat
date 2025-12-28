
"use client";

import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "./client";
import type { AppUser } from "@/context/auth-context";

type ActivityLog = {
    userId: string;
    storeId: string | null;
    action: string;
    description: string;
    metadata?: Record<string, any>;
    createdAt: any;
};

/**
 * Logs a user activity to the 'activityLogs' collection in Firestore.
 * @param user - The user performing the action.
 * @param action - A short code for the action (e.g., "login", "profile_update").
 * @param description - A human-readable description of the action.
 * @param metadata - Optional additional data about the event.
 */
export async function logActivity(
    user: AppUser,
    action: string,
    description: string,
    metadata?: Record<string, any>
) {
    if (!user) {
        console.error("Cannot log activity for a null user.");
        return;
    }

    try {
        const logData: ActivityLog = {
            userId: user.uid,
            storeId: user.storeId || null,
            action,
            description,
            createdAt: serverTimestamp(),
        };

        if (metadata) {
            logData.metadata = metadata;
        }

        await addDoc(collection(db, "activityLogs"), logData);

    } catch (error) {
        console.error("Failed to log user activity:", error);
    }
}

/**
 * Creates a real-time listener for a user's recent activities.
 * @param userId - The UID of the user whose activities to fetch.
 * @param callback - A function to call with the updated list of activities.
 * @param count - The number of recent activities to fetch.
 * @returns An unsubscribe function to stop listening for updates.
 */
export function subscribeToUserActivity(
    userId: string,
    callback: (activities: any[]) => void,
    count: number = 20
) {
    const activityRef = collection(db, "activityLogs");
    const q = query(
        activityRef,
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        limit(count)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const activities: any[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            activities.push({
                id: doc.id,
                ...data,
                // Convert Firestore Timestamp to JS Date if it exists
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
            });
        });
        callback(activities);
    }, (error) => {
        console.error("Error fetching user activity:", error);
        callback([]);
    });

    return unsubscribe;
}
