
"use client";

import { doc, getDoc, onSnapshot, type DocumentData, type Firestore } from "firebase/firestore";
import type { ReceiptSettings } from "@/lib/types";

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
    businessName: "Your Business",
    branchName: "",
    address: "Your Address",
    contact: "Your Contact Info",
    tin: "",
    vatType: "NON_VAT",
    logoUrl: null,
    showLogo: true,
    logoWidthPct: 80,
    footerText: "",
    showCashierName: true,
    showTableOrCustomer: true,
    showItemNotes: true,
    showDiscountBreakdown: true,
    showChargeBreakdown: true,
    paperWidth: "80mm",
    receiptNoFormat: "OR-######",
    autoPrintAfterPayment: false,
    fontSize: 12,
    fontFamily: "'Courier New', Courier, monospace",
};

/**
 * Merges fetched settings with defaults to ensure a complete object.
 */
export function mergeReceiptSettings(fetchedSettings: Partial<ReceiptSettings> | null | undefined): ReceiptSettings {
    return {
        ...DEFAULT_RECEIPT_SETTINGS,
        ...(fetchedSettings || {}),
    };
}

/**
 * Subscribes to real-time updates for a store's receipt settings.
 */
export function subscribeReceiptSettings(
    db: Firestore,
    storeId: string,
    callback: (settings: ReceiptSettings) => void,
    onError: (error: Error) => void
): () => void {
    const settingsRef = doc(db, `stores/${storeId}/receiptSettings`, "main");
    return onSnapshot(settingsRef, (docSnap) => {
        const fetched = docSnap.exists() ? (docSnap.data() as Partial<ReceiptSettings>) : {};
        callback(mergeReceiptSettings(fetched));
    }, onError);
}

/**
 * Fetches the current receipt settings for a store in a one-shot read.
 */
export async function getReceiptSettings(db: Firestore, storeId: string): Promise<ReceiptSettings> {
    const settingsRef = doc(db, `stores/${storeId}/receiptSettings`, "main");
    const docSnap = await getDoc(settingsRef);
    const fetched = docSnap.exists() ? (docSnap.data() as Partial<ReceiptSettings>) : {};
    return mergeReceiptSettings(fetched);
}

    