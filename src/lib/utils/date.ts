import { Timestamp } from "firebase/firestore";

/**
 * Safely converts a value that might be a Firestore Timestamp, a plain object
 * representing a timestamp, a standard Date object, or a string/number into a
 * JavaScript Date object.
 *
 * This utility is crucial for components that render on both the server (Next.js SSR)
 * and the client, as Firestore Timestamps are serialized into plain objects during
 * server-side rendering.
 *
 * @param v The value to convert.
 * @returns A Date object, or null if the conversion is not possible.
 */
export function toJsDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  // Check for Firestore Timestamp-like objects after SSR
  if (typeof v === 'object' && 'seconds' in v && 'nanoseconds' in v) {
    const d = new Date(v.seconds * 1000 + v.nanoseconds / 1000000);
    // Validate the created date
    return isNaN(d.getTime()) ? null : d;
  }
  // Handle string or number representations of a date
  if (typeof v === "number" || typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // Handle other Firestore Timestamp-like objects (e.g., from different SDK versions)
  if (typeof v?.toDate === "function") return v.toDate();

  return null;
}
