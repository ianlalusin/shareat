'use client';

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
  serverTimestamp,
  Timestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import type { KitchenTicket, PendingSession } from "@/lib/types";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";
import { computeSessionLabel } from "@/lib/utils/session";

export type RebuildOpPagesResult = {
  scannedSessions: number;
  scannedTickets: number;
  stationsUpdated: number;
  activeTicketsWritten: number;
  closedPreviewWritten: number;
  deletedActiveTickets: number;
  errors: string[];
};

/**
 * Rebuilds the operational projections (opPages) for a given date range.
 * This tool is used to fix out-of-sync KDS counts or missing history.
 */
export async function rebuildOpPagesForRange(db: Firestore, args: {
  storeId: string;
  startMs: number;
  endMs: number;
  actorUid: string;
}): Promise<RebuildOpPagesResult> {
  const result: RebuildOpPagesResult = {
    scannedSessions: 0,
    scannedTickets: 0,
    stationsUpdated: 0,
    activeTicketsWritten: 0,
    closedPreviewWritten: 0,
    deletedActiveTickets: 0,
    errors: [],
  };

  const { storeId, startMs, endMs } = args;

  try {
    // 1. Load active stations
    const stationsRef = collection(db, "stores", storeId, "kitchenLocations");
    const stationsSnap = await getDocs(query(stationsRef, where("isActive", "==", true)));
    const stations = stationsSnap.docs.map(d => ({ id: d.id, name: d.data().name }));
    
    if (stations.length === 0) {
      result.errors.push("No active kitchen stations found for this store.");
      return result;
    }

    // 2. Clear existing activeKdsTickets for each station
    for (const station of stations) {
      const activeProjRef = collection(db, "stores", storeId, "opPages", station.id, "activeKdsTickets");
      const activeProjSnap = await getDocs(activeProjRef);
      
      let batch = writeBatch(db);
      let count = 0;
      for (const d of activeProjSnap.docs) {
        batch.delete(d.ref);
        count++;
        result.deletedActiveTickets++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
    }

    // 3. Scan sessions in date range
    const sessionsRef = collection(db, "stores", storeId, "sessions");
    const qSessions = query(
      sessionsRef,
      where("startedAt", ">=", Timestamp.fromMillis(startMs)),
      where("startedAt", "<=", Timestamp.fromMillis(endMs)),
      orderBy("startedAt", "desc")
    );
    const sessionsSnap = await getDocs(qSessions);
    result.scannedSessions = sessionsSnap.size;

    // Track state in memory to avoid redundant reads/writes
    const stationDataMap = new Map<string, {
      activeTickets: any[];
      closedTickets: any[];
      todayServedMsSum: number;
      todayServedCount: number;
    }>();

    stations.forEach(s => stationDataMap.set(s.id, {
      activeTickets: [],
      closedTickets: [],
      todayServedMsSum: 0,
      todayServedCount: 0,
    }));

    const todayDayId = getDayIdFromTimestamp(new Date());

    // 4. Scan tickets for each session
    for (const sessionDoc of sessionsSnap.docs) {
      const sessionData = sessionDoc.data();
      const session = { 
        id: sessionDoc.id, 
        ...sessionData,
        sessionMode: sessionData.sessionMode,
        customerName: sessionData.customer?.name ?? sessionData.customerName,
        tableNumber: sessionData.tableNumber
      } as PendingSession;

      const ticketsRef = collection(db, "stores", storeId, "sessions", session.id, "kitchentickets");
      const ticketsSnap = await getDocs(ticketsRef);
      result.scannedTickets += ticketsSnap.size;

      for (const ticketDoc of ticketsSnap.docs) {
        const ticket = { id: ticketDoc.id, ...ticketDoc.data() } as KitchenTicket;
        const stationId = ticket.kitchenLocationId;
        const sData = stationDataMap.get(stationId);
        
        if (!sData) continue;

        // Build projection payload
        const payload = {
          ...ticket,
          sessionLabel: computeSessionLabel(session),
          updatedAt: serverTimestamp(),
        };

        if (ticket.status === 'preparing' || ticket.status === 'ready') {
          sData.activeTickets.push(payload);
        } else if (ticket.status === 'served' || ticket.status === 'cancelled') {
          sData.closedTickets.push(payload);
          
          if (ticket.status === 'served') {
            const servedAtDate = toJsDate(ticket.servedAtClientMs || ticket.servedAt);
            if (servedAtDate && getDayIdFromTimestamp(servedAtDate) === todayDayId) {
              sData.todayServedCount++;
              sData.todayServedMsSum += (ticket.durationMs || 0);
            }
          }
        }
      }
    }

    // 5. Write projections and update opPages summaries
    for (const [stationId, data] of stationDataMap.entries()) {
      result.stationsUpdated++;

      // Write active tickets projections
      let batch = writeBatch(db);
      let count = 0;
      for (const t of data.activeTickets) {
        const ref = doc(db, "stores", storeId, "opPages", stationId, "activeKdsTickets", t.id);
        batch.set(ref, t);
        count++;
        result.activeTicketsWritten++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      // Sort closed tickets for history preview (top 15 newest)
      const sortedClosed = data.closedTickets.sort((a, b) => {
        const timeA = a.servedAtClientMs || a.cancelledAtClientMs || a.createdAtClientMs || 0;
        const timeB = b.servedAtClientMs || b.cancelledAtClientMs || b.createdAtClientMs || 0;
        return timeB - timeA;
      }).slice(0, 15);

      // Write history preview document
      const historyRef = doc(db, "stores", storeId, "opPages", stationId, "historyPreview", "current");
      await setDoc(historyRef, {
        items: sortedClosed.map(t => ({
          id: t.id,
          sessionLabel: t.sessionLabel,
          tableNumber: t.tableNumber,
          customerName: t.customerName,
          itemName: t.itemName,
          qty: t.qty,
          status: t.status,
          closedAtClientMs: t.servedAtClientMs || t.cancelledAtClientMs || t.createdAtClientMs || Date.now(),
          durationMs: t.durationMs || 0
        })),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      result.closedPreviewWritten += sortedClosed.length;

      // Update the main opPage summary doc
      const stationDocRef = doc(db, "stores", storeId, "opPages", stationId);
      const summaryPayload: any = {
        activeCount: data.activeTickets.length,
        updatedAt: serverTimestamp(),
      };
      
      // Only refresh "Today" metrics if we scanned enough data to be relevant
      if (data.todayServedCount > 0) {
        summaryPayload.todayDayId = todayDayId;
        summaryPayload.todayServeCount = data.todayServedCount;
        summaryPayload.todayServeMsSum = data.todayServedMsSum;
        summaryPayload.todayServeAvgMs = data.todayServedMsSum / data.todayServedCount;
      } else {
        // Reset if the scan range includes today but no tickets were found
        const endMsDate = new Date(endMs);
        if (getDayIdFromTimestamp(endMsDate) === todayDayId) {
             summaryPayload.todayDayId = todayDayId;
             summaryPayload.todayServeCount = 0;
             summaryPayload.todayServeMsSum = 0;
             summaryPayload.todayServeAvgMs = 0;
        }
      }

      await updateDoc(stationDocRef, summaryPayload);
    }

  } catch (e: any) {
    console.error("Rebuild OpPages error:", e);
    result.errors.push(e.message || "Unknown error occurred.");
  }

  return result;
}
