
'use client';

import { clearStoreDataFlow } from '@/ai/flows/clear-store-data-flow';

/**
 * Deletes all documents and their specified subcollections for a given store
 * by calling a server-side Genkit flow.
 * @param storeId The ID of the store to clear.
 * @param resetCounter Whether to reset the receipt counter.
 * @param onProgress Callback for progress updates.
 */
export async function clearStoreData(
    storeId: string, 
    resetCounter: boolean,
    onProgress: (message: string) => void
) {
    if (!storeId) {
        throw new Error("Store ID is required.");
    }
    
    onProgress("Starting data cleanup flow on the server...");

    try {
        // The flow itself will handle the logic. We just need to call it.
        // We can pass the onProgress callback if the flow supports streaming updates,
        // but for now, we'll keep it simple.
        const result = await clearStoreDataFlow({ storeId, resetCounter });
        
        // This part depends on the flow's return value.
        // Let's assume it returns a success message or throws an error.
        onProgress(result.message);
        onProgress("Cleanup complete.");

    } catch (error: any) {
        console.error("Error calling clearStoreDataFlow:", error);
        onProgress(`Error: ${error.message || 'An unknown error occurred.'}`);
        throw error; // Re-throw to be caught by the UI
    }
}
