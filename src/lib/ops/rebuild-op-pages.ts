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
  collectionGroup,
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
  activeSessionsProjected: number;
  closedPreviewWritten: number;
  deletedActiveTickets: number;
  deletedActiveSessions: number;
  errors: string[];
};

/**
 * Rebuilds the operational projections (opPages) for a given date range.
 * This tool is used to fix out-of-sync KDS counts, missing history, or stuck active session displays.
 * Strictly store-scoped using the provided storeId.
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
    activeSessionsProjected: 0,
    closedPreviewWritten: 0,
    deletedActiveTickets: 0,
    deletedActiveSessions: 0,
    errors: [],
  };

  const { storeId, startMs, endMs } = args;

  if (!storeId) {
    result.errors.push("Store ID is required for scoped rebuild.");
    return result;
  }

  try {
    // 1. Load active stations for this specific store
    const stationsRef = collection(db, "stores", storeId, "kitchenLocations");
    const stationsSnap = await getDocs(query(stationsRef, where("isActive", "==", true)));
    const stations = stationsSnap.docs.map(d => ({ id: d.id, name: d.data().name }));
    
    if (stations.length === 0) {
      result.errors.push("No active kitchen stations found for this store.");
      return result;
    }

    // 2. Clear existing projections (Store Scoped Paths)
    
    // Clear activeKdsTickets for each station within the store
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

    // Clear sessionPage/activeSessions for the store
    const activeSessionsProjRef = collection(db, "stores", storeId, "opPages", "sessionPage", "activeSessions");
    const activeSessionsProjSnap = await getDocs(activeSessionsProjRef);
    let sessionBatch = writeBatch(db);
    let sessionCount = 0;
    for (const d of activeSessionsProjSnap.docs) {
      sessionBatch.delete(d.ref);
      sessionCount++;
      result.deletedActiveSessions++;
      if (sessionCount >= 400) {
        await sessionBatch.commit();
        sessionBatch = writeBatch(db);
        sessionCount = 0;
      }
    }
    if (sessionCount > 0) await sessionBatch.commit();

    // 3. Scan sessions in date range for this store
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

    const sessionDataCache = new Map<string, PendingSession>();
    const todayDayId = getDayIdFromTimestamp(new Date());
    let totalActiveSessionCount = 0;
    let totalActiveGuestCount = 0;

    // Write session projections in batches
    let globalBatch = writeBatch(db);
    let globalOpCount = 0;

    for (const sessionDoc of sessionsSnap.docs) {
      const sessionData = sessionDoc.data();
      const session = { 
        id: sessionDoc.id, 
        ...sessionData,
        sessionMode: sessionData.sessionMode,
        customerName: sessionData.customer?.name ?? sessionData.customerName,
        tableNumber: sessionData.tableNumber
      } as PendingSession;
      
      sessionDataCache.set(session.id, session);

      // Handle Session Projection
      if (session.status === 'active' || session.status === 'pending_verification') {
        totalActiveSessionCount++;
        totalActiveGuestCount += (session.guestCountFinal || session.guestCountCashierInitial || 0);

        const projRef = doc(db, "stores", storeId, "opPages", "sessionPage", "activeSessions", session.id);
        const projectionPayload = {
          meta: { source: 'rebuild-v1' },
          status: session.status,
          sessionMode: session.sessionMode,
          tableId: session.tableId,
          tableNumber: session.tableNumber,
          customerName: session.customerName,
          packageOfferingId: session.packageOfferingId,
          packageSnapshot: session.packageSnapshot,
          guestCountCashierInitial: session.guestCountCashierInitial,
          guestCountFinal: session.guestCountFinal,
          startedAt: session.startedAt,
          startedAtClientMs: session.startedAtClientMs,
          updatedAt: serverTimestamp(),
          initialFlavorIds: (session as any).initialFlavorIds || [],
        };
        globalBatch.set(projRef, projectionPayload);
        globalOpCount++;
        result.activeSessionsProjected++;
      }

      if (globalOpCount >= 400) {
        await globalBatch.commit();
        globalBatch = writeBatch(db);
        globalOpCount = 0;
      }
    }
    if (globalOpCount > 0) await globalBatch.commit();

    // 4. Fetch all kitchen tickets for this store in one go (Efficient & Scoped)
    const ticketsRefGroup = collectionGroup(db, "kitchentickets");
    const qTickets = query(
        ticketsRefGroup,
        where("storeId", "==", storeId),
        where("createdAt", ">=", Timestamp.fromMillis(startMs - 86400000)), // Buffer for long sessions
        where("createdAt", "<=", Timestamp.fromMillis(endMs + 86400000))
    );
    const ticketsSnap = await getDocs(qTickets);
    result.scannedTickets = ticketsSnap.size;

    for (const ticketDoc of ticketsSnap.docs) {
      const ticket = { id: ticketDoc.id, ...ticketDoc.data() } as KitchenTicket;
      
      // Skip if ticket doesn't belong to a session we just scanned (ensures range consistency)
      const session = sessionDataCache.get(ticket.sessionId);
      if (!session) continue;

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

    // 5. Write projections and update opPages summaries (All Store Scoped)
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
      
      const endMsDate = new Date(endMs);
      if (getDayIdFromTimestamp(endMsDate) === todayDayId) {
          summaryPayload.todayDayId = todayDayId;
          summaryPayload.todayServeCount = data.todayServedCount;
          summaryPayload.todayServeMsSum = data.todayServedMsSum;
          summaryPayload.todayServeAvgMs = data.todayServedCount > 0 ? data.todayServedMsSum / data.todayServedCount : 0;
      }

      await updateDoc(stationDocRef, summaryPayload);
    }

    // 6. Update sessionPage summary (Active Sessions & Guest Count)
    const sessionOpPageRef = doc(db, `stores/${storeId}/opPages`, 'sessionPage');
    await updateDoc(sessionOpPageRef, {
        activeSessionCount: totalActiveSessionCount,
        activeGuestCount: totalActiveGuestCount,
        updatedAt: serverTimestamp(),
    });

  } catch (e: any) {
    console.error("Rebuild OpPages error:", e);
    result.errors.push(e.message || "Unknown error occurred.");
  }

  return result;
}
