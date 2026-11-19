"use client";

import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

import { storage } from "@/lib/firebase/client";
import { PROOF_UPLOAD_MAX_EDGE, downscaleImage } from "@/lib/images/downscale";

/**
 * Uploads a payment screenshot for a set reservation and returns its download URL.
 * Lives under reservationProofs/ (no 15-day expiry, unlike paymentProofs/). The
 * server only accepts URLs that point into this order's own folder.
 */
export async function uploadReservationProof(file: File, storeId: string, orderId: string): Promise<string> {
  const { blob } = await downscaleImage(file, { maxEdge: PROOF_UPLOAD_MAX_EDGE });
  const r = storageRef(storage, `reservationProofs/${storeId}/${orderId}/${crypto.randomUUID()}.jpg`);
  await uploadBytes(r, blob, { contentType: "image/jpeg" });
  return getDownloadURL(r);
}
