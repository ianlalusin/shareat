

'use client';

import { doc, type Firestore } from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import type { Receipt, ReceiptAnalyticsV2, KitchenTicket } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";

/**
 * Checks if a receipt object is null or represents a voided transaction.
 * @param r The receipt object to check.
 * @returns `true` if the receipt is considered void.
 */
function isVoidReceipt(r: any): boolean {
  return !r || r.status === "voided" || r.isVoided === true;
}

/**
 * Gets the start of the day (midnight) for a given timestamp in the 'Asia/Manila' timezone.
 *
 * @param ts The timestamp to convert.
 * @returns The millisecond epoch time for midnight.
 */
export function getDayStartMs(ts: Timestamp | Date | number): number {
    const date = toJsDate(ts);
    if (!date) {
        // Fallback to current time if timestamp is invalid to avoid crashing.
        const now = new Date();
        now.setHours(0,0,0,0);
        return now.getTime();
    };
    
    // Create a new Date object representing midnight in the UTC of the *local* machine,
    // but with the date parts from the 'Asia/Manila' timezone.
    const dateInManila = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const midnightInManila = new Date(dateInManila);
    midnightInManila.setHours(0, 0, 0, 0);

    return midnightInManila.getTime();
}


/**
 * Converts a Firestore Timestamp, JavaScript Date, or millisecond epoch time
 * into a `YYYYMMDD` string formatted for the 'Asia/Manila' timezone.
 *
 * @param ts The timestamp to convert.
 * @returns A string in `YYYYMMDD` format, or today's date string as a fallback.
 */
export function getDayIdFromTimestamp(ts: Timestamp | Date | number | null | undefined): string {
    const date = toJsDate(ts);

    // If date is invalid or null, fallback to today's date in Asia/Manila.
    if (!date || isNaN(date.getTime())) {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: 'Asia/Manila',
        });
        return formatter.format(now).replace(/-/g, '');
    }
    
    const formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Manila',
    });

    const dayId = formatter.format(date).replace(/-/g, '');

    // Final safety check to prevent the "1970" bug from invalid timestamps.
    if (dayId.startsWith('1970') || dayId.startsWith('1969')) {
        const now = new Date();
        return formatter.format(now).replace(/-/g, '');
    }

    return dayId;
}


/**
 * Returns a DocumentReference to a daily analytics document for a specific store.
 * The canonical path is stores/{storeId}/analytics/{YYYYMMDD}.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store.
 * @param dayId The day identifier string in `YYYYMMDD` format.
 * @returns A DocumentReference to the specified daily analytics document.
 */
export function dailyAnalyticsDocRef(db: Firestore, storeId: string, dayId: string) {
    return doc(db, "stores", storeId, "analytics", dayId);
}

// --- Payment Contribution ---
type PaymentContribution = {
  dayId: string;
  dayStartMs: number;
  totalGross: number;
  txCount: number;
  byMethod: Record<string, number>;
  discountsTotal: number;
  chargesTotal: number;
};

export function getPaymentContribution(receipt: Receipt | null): PaymentContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, totalGross: 0, txCount: 0, byMethod: {}, discountsTotal: 0, chargesTotal: 0 };
    if (isVoidReceipt(receipt)) return defaultReturn;
    
    const eventMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime();
    if (!eventMs) return defaultReturn;

    const analytics = (receipt.analytics || {}) as ReceiptAnalyticsV2;
    const gross = Number(receipt.total ?? analytics?.grandTotal ?? 0);

    return {
        dayId: getDayIdFromTimestamp(eventMs),
        dayStartMs: getDayStartMs(eventMs),
        totalGross: gross,
        txCount: 1,
        byMethod: analytics?.mop ?? {},
        discountsTotal: analytics?.discountsTotal ?? 0,
        chargesTotal: analytics?.chargesTotal ?? 0,
    };
}


// --- Guest & Package Count Contribution ---
type GuestCoversContribution = {
    dayId: string;
    dayStartMs: number;
    isPackageSession: boolean;
    guestCountFinal: number;
    billedPackageCovers: number;
    packageName: string | null;
    packageSessionsCount: number;
    guestCountFinalByPackageName: Record<string, number>;
    packageCoversBilledByPackageName: Record<string, number>;
};

export function getGuestCoversContribution(receipt: Receipt | null): GuestCoversContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, isPackageSession: false, guestCountFinal: 0, billedPackageCovers: 0, packageName: null, packageSessionsCount: 0, guestCountFinalByPackageName: {}, packageCoversBilledByPackageName: {} };
    
    if (isVoidReceipt(receipt) || receipt.sessionMode !== 'package_dinein' || receipt.analytics?.v !== 2) {
        return defaultReturn;
    }

    const snapshot = receipt.analytics.guestCountSnapshot;
    if (!snapshot) return defaultReturn;
    
    const eventMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime();
    if (!eventMs) return defaultReturn;
    
    const packageName = snapshot.packageName || "Unknown Package";
    const guestCountFinalByPackageName: Record<string, number> = {};
    const packageCoversBilledByPackageName: Record<string, number> = {};

    if (packageName) {
        guestCountFinalByPackageName[packageName] = snapshot.finalGuestCount || 0;
        packageCoversBilledByPackageName[packageName] = snapshot.billedPackageCovers || 0;
    }

    return {
        dayId: getDayIdFromTimestamp(eventMs),
        dayStartMs: getDayStartMs(eventMs),
        isPackageSession: true,
        guestCountFinal: snapshot.finalGuestCount || 0,
        billedPackageCovers: snapshot.billedPackageCovers || 0,
        packageName: packageName,
        packageSessionsCount: 1,
        guestCountFinalByPackageName: guestCountFinalByPackageName,
        packageCoversBilledByPackageName,
    };
}

// --- Sales Contribution ---
type SalesContribution = {
    dayId: string;
    dayStartMs: number;
    packageSalesAmountByName: Record<string, number>;
    packageSalesQtyByName: Record<string, number>;
    addonSalesAmountByCategory: Record<string, number>;
    addonSalesByItem: Record<string, { qty: number; amount: number; categoryName: string; }>;
};

export function getSalesContribution(receipt: Receipt | null): SalesContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, addonSalesByItem: {} };
    if (isVoidReceipt(receipt) || receipt.analytics?.v !== 2) return defaultReturn;
    
    const analytics = receipt.analytics as ReceiptAnalyticsV2;
    const eventMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime();
    const dayId = eventMs ? getDayIdFromTimestamp(eventMs) : "";
    const dayStartMs = eventMs ? getDayStartMs(eventMs) : 0;

    const packageSalesAmountByName: Record<string, number> = {};
    const packageSalesQtyByName: Record<string, number> = {};
    const addonSalesAmountByCategory: Record<string, number> = {};
    const addonSalesByItem: Record<string, { qty: number; amount: number; categoryName: string; }> = {};


    if (analytics.salesByItem) {
        for (const [itemName, values] of Object.entries(analytics.salesByItem)) {
            const isPackage = !values.categoryName || values.categoryName === "Uncategorized";

            if (isPackage) {
                packageSalesAmountByName[itemName] = (packageSalesAmountByName[itemName] || 0) + values.amount;
                packageSalesQtyByName[itemName] = (packageSalesQtyByName[itemName] || 0) + values.qty;
            } else {
                 if (!addonSalesByItem[itemName]) {
                    addonSalesByItem[itemName] = { qty: 0, amount: 0, categoryName: values.categoryName };
                }
                addonSalesByItem[itemName].qty += values.qty;
                addonSalesByItem[itemName].amount += values.amount;
            }
        }
    }

    if (analytics.salesByCategory) {
        for (const [categoryName, values] of Object.entries(analytics.salesByCategory)) {
            addonSalesAmountByCategory[categoryName] = (addonSalesAmountByCategory[categoryName] || 0) + values.amount;
        }
    }


    return {
        dayId,
        dayStartMs,
        packageSalesAmountByName,
        packageSalesQtyByName,
        addonSalesAmountByCategory,
        addonSalesByItem
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
    if (isVoidReceipt(receipt) || receipt.analytics?.v !== 2) return defaultReturn;
    
    // Use session start time first, which is more accurate for peak hour calculation
    const eventMs = receipt.analytics.sessionStartedAtClientMs || toJsDate(receipt.analytics.sessionStartedAt)?.getTime();
    if (!eventMs) return defaultReturn;
    
    const date = new Date(eventMs);
    const dayId = getDayIdFromTimestamp(date);
    const dayStartMs = getDayStartMs(date);
    const hour = date.getHours();

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

export function getKitchenTicketContribution(ticket: KitchenTicket): KitchenTicketContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, typeKey: "unknown", servedCount: 0, cancelledCount: 0, durationMsSum: 0, durationCount: 0 };
    
    // Use client-side timestamp if available for dayId generation
    const eventMs = ticket.servedAtClientMs || toJsDate(ticket.servedAt || ticket.cancelledAt || ticket.createdAt)?.getTime();
    if (!eventMs) return defaultReturn;
    
    const dayId = getDayIdFromTimestamp(eventMs);
    const dayStartMs = getDayStartMs(eventMs);
    const typeKey = ticket.type || "unknown";

    if (ticket.status === 'served') {
        let durationMs = ticket.durationMs ?? 0;
        if (durationMs <= 0 && ticket.servedAtClientMs) {
            const createdAtMs = toJsDate(ticket.createdAt)?.getTime();
            if (createdAtMs) {
                durationMs = ticket.servedAtClientMs - createdAtMs;
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
    if (isVoidReceipt(receipt)) return defaultReturn;

    const eventMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime();
    if (!eventMs) return defaultReturn;

    return {
        dayId: getDayIdFromTimestamp(eventMs),
        dayStartMs: getDayStartMs(eventMs),
        closedCount: 1,
        totalPaid: receipt.total ?? 0,
    };
}


// --- Refill Contribution ---
type RefillContribution = {
    dayId: string;
    dayStartMs: number;
    servedRefillsTotal: number;
    servedRefillsByName: Record<string, number>;
    packageSessionsCount: number;
};

export function getRefillContribution(receipt: Receipt | null): RefillContribution {
    const defaultReturn = { dayId: "", dayStartMs: 0, servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0 };
    if (isVoidReceipt(receipt) || receipt.sessionMode !== 'package_dinein' || receipt.analytics?.v !== 2) {
        return defaultReturn;
    }
    
    const eventMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime();
    if (!eventMs) return defaultReturn;
    
    const analytics = receipt.analytics as ReceiptAnalyticsV2;
    const servedRefillsByName = analytics.servedRefillsByName ?? {};
    const servedRefillsTotal = Object.values(servedRefillsByName).reduce((sum, count) => sum + count, 0);

    return {
        dayId: getDayIdFromTimestamp(eventMs),
        dayStartMs: getDayStartMs(eventMs),
        servedRefillsTotal,
        servedRefillsByName,
        packageSessionsCount: 1,
    };
}
