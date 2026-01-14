

import { doc, type Firestore } from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import type { Receipt, ReceiptAnalyticsV2 } from "@/lib/types";

/**
 * Converts a Firestore Timestamp, JavaScript Date, or millisecond epoch time
 * into a `YYYYMMDD` string formatted for the 'Asia/Manila' timezone.
 *
 * @param ts The timestamp to convert.
 * @returns A string in `YYYYMMDD` format.
 */
export function getDayIdFromTimestamp(ts: Timestamp | Date | number): string {
    const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    
    const formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Manila',
    });

    // The 'en-CA' locale conveniently formats dates as YYYY-MM-DD
    const [year, month, day] = formatter.format(date).split('-');
    return `${year}${month}${day}`;
}


/**
 * Returns a DocumentReference to a daily analytics document for a specific store.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store.
 * @param dayId The day identifier string in `YYYYMMDD` format.
 * @returns A DocumentReference to the specified daily analytics document.
 */
export function dailyAnalyticsDocRef(db: Firestore, storeId: string, dayId: string) {
    return doc(db, "stores", storeId, "analytics", dayId);
}

// --- Guest & Package Count Contribution ---
type GuestCoversContribution = {
    dayId: string;
    guestCountFinal: number;
    billedPackageCovers: number;
    packageName: string | null;
    isPackageSession: boolean;
};

/**
 * Extracts the contribution of a single receipt to the daily guest/cover metrics.
 * @param receipt The receipt document data.
 * @returns An object with the receipt's contribution, or zeros if not applicable.
 */
export function getGuestCoversContribution(receipt: Receipt): GuestCoversContribution {
    const defaultReturn = { dayId: "", guestCountFinal: 0, billedPackageCovers: 0, packageName: null, isPackageSession: false };
    
    if (receipt.sessionMode !== 'package_dinein' || !receipt.analytics?.guestCountSnapshot) {
        return defaultReturn;
    }

    const snapshot = receipt.analytics.guestCountSnapshot;
    
    // Ensure createdAt is valid before generating dayId
    const createdAtMs = receipt.createdAtClientMs || receipt.createdAt?.toMillis();
    if (!createdAtMs) {
        return defaultReturn;
    }

    return {
        dayId: getDayIdFromTimestamp(createdAtMs),
        guestCountFinal: snapshot.finalGuestCount || 0,
        billedPackageCovers: snapshot.billedPackageCovers || 0,
        packageName: snapshot.packageName || null,
        isPackageSession: true,
    };
}

// --- Sales Contribution ---
type SalesContribution = {
    dayId: string;
    packageAmountByName: Record<string, number>;
    packageQtyByName: Record<string, number>;
    addonAmountByCategory: Record<string, number>;
};

export function getSalesContribution(receipt: Receipt): SalesContribution {
    const analytics = (receipt?.analytics ?? {}) as ReceiptAnalyticsV2;
    const createdAtMs = receipt.createdAtClientMs || receipt.createdAt?.toMillis();
    const dayId = createdAtMs ? getDayIdFromTimestamp(createdAtMs) : "";

    const packageAmountByName: Record<string, number> = {};
    const packageQtyByName: Record<string, number> = {};
    const addonAmountByCategory: Record<string, number> = {};

    if (analytics.v === 2) {
        // Aggregate packages from salesByItem
        if (analytics.salesByItem) {
            for (const [itemName, values] of Object.entries(analytics.salesByItem)) {
                // The rule for identifying a package is that it has no category or is 'Uncategorized'
                if (!values.categoryName || values.categoryName === "Uncategorized") {
                    packageAmountByName[itemName] = (packageAmountByName[itemName] || 0) + values.amount;
                    packageQtyByName[itemName] = (packageQtyByName[itemName] || 0) + values.qty;
                }
            }
        }
        // Aggregate addons from salesByCategory
        if (analytics.salesByCategory) {
            for (const [categoryName, values] of Object.entries(analytics.salesByCategory)) {
                addonAmountByCategory[categoryName] = (addonAmountByCategory[categoryName] || 0) + values.amount;
            }
        }
    }

    return {
        dayId,
        packageAmountByName,
        packageQtyByName,
        addonAmountByCategory,
    };
}
    

