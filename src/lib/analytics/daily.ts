

import { doc, type Firestore } from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import type { Receipt, ReceiptAnalyticsV2, KitchenTicket } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";

/**
 * Gets the start of the day (midnight) for a given timestamp in the 'Asia/Manila' timezone.
 *
 * @param ts The timestamp to convert.
 * @returns The millisecond epoch time for midnight.
 */
export function getDayStartMs(ts: Timestamp | Date | number): number {
    const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    
    // Create a new Date object representing midnight in the UTC of the *local* machine,
    // but with the date parts from the 'Asia/Manila' timezone.
    const midnightInManila = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    midnightInManila.setHours(0, 0, 0, 0);

    return midnightInManila.getTime();
}


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
    return formatter.format(date).replace(/-/g, '');
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
    dayStartMs: number;
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
export function getGuestCoversContribution(receipt: Receipt | null): GuestCoversContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, guestCountFinal: 0, billedPackageCovers: 0, packageName: null, isPackageSession: false };
    
    if (!receipt || receipt.sessionMode !== 'package_dinein' || !receipt.analytics?.guestCountSnapshot) {
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
        dayStartMs: getDayStartMs(createdAtMs),
        guestCountFinal: snapshot.finalGuestCount || 0,
        billedPackageCovers: snapshot.billedPackageCovers || 0,
        packageName: snapshot.packageName || null,
        isPackageSession: true,
    };
}

// --- Sales Contribution ---
type SalesContribution = {
    dayId: string;
    dayStartMs: number;
    packageAmountByName: Record<string, number>;
    packageQtyByName: Record<string, number>;
    addonAmountByCategory: Record<string, number>;
};

export function getSalesContribution(receipt: Receipt | null): SalesContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, packageAmountByName: {}, packageQtyByName: {}, addonAmountByCategory: {} };
    if (!receipt) return defaultReturn;
    
    const analytics = (receipt?.analytics ?? {}) as ReceiptAnalyticsV2;
    const createdAtMs = receipt.createdAtClientMs || receipt.createdAt?.toMillis();
    const dayId = createdAtMs ? getDayIdFromTimestamp(createdAtMs) : "";
    const dayStartMs = createdAtMs ? getDayStartMs(createdAtMs) : 0;

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
        dayStartMs,
        packageAmountByName,
        packageQtyByName,
        addonAmountByCategory,
    };
}

// --- Peak Hour Contribution ---
type PeakHourContribution = {
    dayId: string;
    dayStartMs: number;
    hourKey: string | null; // "0".."23"
    amount: number;
    count: number; // 1 if valid, 0 if not
};

export function getPeakHourContribution(receipt: Receipt | null): PeakHourContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, hourKey: null, amount: 0, count: 0 };
    if (!receipt) return defaultReturn;
    
    // Use session start time first, fallback to receipt creation time
    const primaryTs = receipt.analytics?.sessionStartedAt;
    const primaryMs = receipt.analytics?.sessionStartedAtClientMs;
    const fallbackTs = receipt.createdAt;
    
    const date = toJsDate(primaryTs) ?? (primaryMs ? new Date(primaryMs) : toJsDate(fallbackTs));

    if (!date) return defaultReturn;
    
    const dayId = getDayIdFromTimestamp(date);
    const dayStartMs = getDayStartMs(date);
    const hour = date.getHours(); // Local hour based on server's timezone, or Asia/Manila if consistent

    return {
        dayId: dayId,
        dayStartMs,
        hourKey: String(hour),
        amount: receipt.total ?? receipt.analytics?.grandTotal ?? 0,
        count: 1,
    };
}

// --- Kitchen Ticket Contribution ---
type KitchenTicketContribution = {
    dayId: string;
    dayStartMs: number;
    typeKey: string; // e.g., "package", "addon", "refill"
    servedCount: number;
    cancelledCount: number;
    durationMsSum: number;
    durationCount: number; // Count of tickets with a valid duration
};

/**
 * Extracts the contribution of a single kitchen ticket to daily kitchen analytics.
 * This should be called when a ticket reaches a final state (served or cancelled).
 * @param ticket The KitchenTicket object.
 * @returns An object with the ticket's contribution to daily metrics.
 */
export function getKitchenTicketContribution(ticket: KitchenTicket): KitchenTicketContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, typeKey: "unknown", servedCount: 0, cancelledCount: 0, durationMsSum: 0, durationCount: 0 };
    
    const timestamp = ticket.servedAt || ticket.cancelledAt || ticket.createdAt;
    if (!timestamp) return defaultReturn;
    
    const dayId = getDayIdFromTimestamp(toJsDate(timestamp)!);
    const dayStartMs = getDayStartMs(toJsDate(timestamp)!);
    const typeKey = ticket.type || "unknown";

    if (ticket.status === 'served') {
        let durationMs = ticket.durationMs ?? 0;
        if (durationMs <= 0) {
            const servedAtMs = ticket.servedAtClientMs || toJsDate(ticket.servedAt)?.getTime();
            const createdAtMs = toJsDate(ticket.createdAt)?.getTime();
            if (servedAtMs && createdAtMs) {
                durationMs = servedAtMs - createdAtMs;
            }
        }
        
        return {
            dayId,
            dayStartMs,
            typeKey,
            servedCount: 1,
            cancelledCount: 0,
            durationMsSum: durationMs > 0 ? durationMs : 0,
            durationCount: durationMs > 0 ? 1 : 0,
        };
    }
    
    if (ticket.status === 'cancelled') {
        return {
            dayId,
            dayStartMs,
            typeKey,
            servedCount: 0,
            cancelledCount: 1,
            durationMsSum: 0,
            durationCount: 0,
        };
    }
    
    return defaultReturn;
}


// --- Closed Sessions Contribution ---
type ClosedSessionsContribution = {
  dayId: string;
  dayStartMs: number;
  closedCount: number;
  totalPaid: number;
};

export function getClosedSessionsContribution(receipt: Receipt | null): ClosedSessionsContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, closedCount: 0, totalPaid: 0 };
    if (!receipt) return defaultReturn;

    const createdAtMs = receipt.createdAtClientMs || receipt.createdAt?.toMillis();
    if (!createdAtMs) return defaultReturn;

    return {
        dayId: getDayIdFromTimestamp(createdAtMs),
        dayStartMs: getDayStartMs(createdAtMs),
        closedCount: 1,
        totalPaid: receipt.total ?? 0,
    };
}
