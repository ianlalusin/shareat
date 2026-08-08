"use client";

import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { ActivityLog, KitchenTicket, Receipt, SessionBillLine, SessionDoc } from "@/lib/types";
import type { GuestParticipant, SessionAuditFlag, SessionTrailSources } from "./types";

/**
 * One expansion's worth of session history.
 *
 * The Daily Session Timeline reads exactly one document per date; that cheapness
 * is the reason the projection exists, so nothing here runs until a row is
 * actually expanded. Deliberately one-shot rather than `onSnapshot`: these are
 * closed sessions, and a listener per open row would cost a subscription each
 * for data that cannot change.
 */

/** Activity logs are capped — a pathological session should not stall a page. */
const ACTIVITY_LOG_LIMIT = 300;

export async function fetchSessionTrail(args: {
  storeId: string;
  sessionId: string | null;
  receiptId: string;
}): Promise<SessionTrailSources> {
  const { storeId, sessionId, receiptId } = args;

  // The receipt is keyed by receiptId, never by sessionId. They coincide for an
  // ordinary sale, but a refund receipt gets a fresh uuid — keying by session
  // silently showed the original receipt's money on the refund row.
  const receiptRef = doc(db, "stores", storeId, "receipts", receiptId);

  if (!sessionId) {
    // Row with no linked session (very old data). One read, receipt only.
    const receiptSnap = await getDoc(receiptRef);
    return {
      sessionId: null,
      receiptId,
      session: null,
      receipt: receiptSnap.exists() ? ({ id: receiptSnap.id, ...receiptSnap.data() } as Receipt) : null,
      billLines: [],
      tickets: [],
      activityLogs: [],
      flag: null,
      participants: [],
    };
  }

  const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
  const linesRef = collection(db, "stores", storeId, "sessions", sessionId, "sessionBillLines");
  const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
  const logsRef = collection(db, "stores", storeId, "sessions", sessionId, "activityLogs");
  const flagRef = doc(db, "stores", storeId, "sessionAuditFlags", sessionId);
  // `closeSession` deletes the activeSessions parent doc, but Firestore does not
  // cascade to subcollections — so guest devices remain readable after close.
  const participantsRef = collection(db, "stores", storeId, "activeSessions", sessionId, "customerParticipants");

  const [sessionSnap, linesSnap, ticketsSnap, logsSnap, receiptSnap, flagSnap, participantsSnap] =
    await Promise.all([
      getDoc(sessionRef),
      getDocs(query(linesRef, orderBy("createdAt", "asc"))),
      getDocs(ticketsRef),
      getDocs(query(logsRef, orderBy("createdAt", "desc"), limit(ACTIVITY_LOG_LIMIT))),
      getDoc(receiptRef),
      getDoc(flagRef),
      getDocs(query(participantsRef, orderBy("joinedAtMs", "desc"))),
    ]);

  return {
    sessionId,
    receiptId,
    session: sessionSnap.exists() ? ({ id: sessionSnap.id, ...sessionSnap.data() } as SessionDoc) : null,
    receipt: receiptSnap.exists() ? ({ id: receiptSnap.id, ...receiptSnap.data() } as Receipt) : null,
    billLines: linesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SessionBillLine)),
    tickets: ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as KitchenTicket)),
    activityLogs: logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog)),
    flag: flagSnap.exists() ? (flagSnap.data() as SessionAuditFlag) : null,
    participants: participantsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as GuestParticipant)),
  };
}

/**
 * Flavor id → name.
 *
 * Flavor *names* are persisted nowhere: sessions store `initialFlavorIds`, and
 * `KitchenTicket.initialFlavorNames` is declared in the types but written by
 * nothing (the KDS resolves it in memory; the refill modal folds names into a
 * notes string). So a lookup is required to show anything but raw ids.
 *
 * Prefers the single `storeConfig/current` doc and falls back to the collection,
 * because that config doc is rebuilt manually and can lag a new flavor.
 */
export async function fetchFlavorNames(storeId: string): Promise<Map<string, string>> {
  try {
    const cfgSnap = await getDoc(doc(db, "stores", storeId, "storeConfig", "current"));
    const flavors = cfgSnap.exists() ? ((cfgSnap.data() as any)?.flavors as any[] | undefined) : undefined;
    if (Array.isArray(flavors) && flavors.length > 0) {
      return new Map(
        flavors
          .filter((f) => f?.flavorId && f?.flavorName)
          .map((f) => [String(f.flavorId), String(f.flavorName)] as const)
      );
    }
  } catch {
    // Fall through to the collection.
  }

  const snap = await getDocs(collection(db, "stores", storeId, "storeFlavors"));
  return new Map(
    snap.docs
      .map((d) => {
        const data = d.data() as any;
        return [String(data?.flavorId ?? d.id), String(data?.flavorName ?? "")] as const;
      })
      .filter(([, name]) => !!name)
  );
}
