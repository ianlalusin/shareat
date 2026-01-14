

import { doc, type Firestore } from "firebase/firestore";
import { Timestamp } from "firebase/firestore";

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
    // Corrected path: points to a document within the 'analytics' collection.
    return doc(db, "stores", storeId, "analytics", dayId);
}

    