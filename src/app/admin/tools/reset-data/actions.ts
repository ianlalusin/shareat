
'use server';

import { clearStoreDataFlow } from '@/ai/flows/clear-store-data-flow';

type ClearDataResult = {
  success: boolean;
  message: string;
};

export async function clearStoreData(
    { storeId, resetCounter }: { storeId: string, resetCounter: boolean }
): Promise<ClearDataResult> {
    
    if (!storeId) {
        return { success: false, message: "Store ID is required." };
    }

    try {
        const result = await clearStoreDataFlow({ storeId, resetCounter });
        return { success: true, message: result.message };
    } catch (error: any) {
        console.error("Error in clearStoreData server action:", error);
        return { success: false, message: error.message || "An unknown server error occurred." };
    }
}
