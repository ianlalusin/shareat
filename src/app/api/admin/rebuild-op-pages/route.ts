
import { NextResponse } from 'next/server';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';

import type { RebuildOpPagesResult } from '@/lib/ops/rebuild-op-pages';
import type { KitchenTicket, PendingSession } from '@/lib/types';
import { computeSessionLabel } from '@/lib/utils/session';
import { getDayIdFromTimestamp } from '@/lib/analytics/daily';
import { toJsDate } from '@/lib/utils/date';
import { stripUndefined } from '@/lib/firebase/utils';


// --- API Route Configuration ---
export const runtime = 'nodejs'; // Must run on Node.js for Admin SDK
export const dynamic = 'force-dynamic'; // Ensures fresh data on every request

// --- Main Route Handler ---
export async function POST(req: Request) {
  try {
    // 1. Authenticate and Authorize the user
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized: Missing Bearer token" }, { status: 401 });
    }
    const token = authHeader.split("Bearer ")[1];
    
    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(token);

    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized: Invalid token" }, { status: 401 });
    }
    
    // Check for appropriate roles
    const isAllowed = decoded.platformAdmin === true || decoded.role === 'admin' || decoded.role === 'manager';
    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions" }, { status: 403 });
    }

    // 2. Validate the incoming request body
    const body = await req.json();
    const { storeId, startMs, endMs } = body;

    if (!storeId || typeof storeId !== 'string') {
        return NextResponse.json({ error: "Bad Request: storeId is required and must be a string." }, { status: 400 });
    }
    if (typeof startMs !== 'number' || typeof endMs !== 'number' || startMs > endMs) {
        return NextResponse.json({ error: "Bad Request: Invalid startMs or endMs." }, { status: 400 });
    }

    // 3. Execute the server-side rebuild logic
    const adminDb = getAdminDb();
    const result = await rebuildOpPagesForRangeServer(adminDb, {
        storeId,
        startMs,
        endMs,
        actorUid: decoded.uid,
    });
    
    return NextResponse.json(result);

  } catch (err: any) {
    console.error("[rebuild-op-pages] uncaught error:", err);

    if (err.code === 'auth/invalid-credential' || (err.message && (err.message.includes('Could not load the default credentials') || err.message.includes('Error getting access token')))) {
        return NextResponse.json({
            error: "Firebase Admin credentials missing or invalid. Ensure server environment variables are correctly set."
        }, { status: 500 });
    }

    return NextResponse.json({ error: err.message || "An internal server error occurred." }, { status: 500 });
  }
}


/**
 * Server-side rebuild logic using the Firebase Admin SDK.
 * This function is safe to run in a Node.js environment.
 */
async function rebuildOpPagesForRangeServer(
    db: Firestore, 
    args: { storeId: string; startMs: number; endMs: number; actorUid: string; }
): Promise<RebuildOpPagesResult> {
  
  const result: RebuildOpPagesResult = {
    scannedSessions: 0, scannedTickets: 0, stationsUpdated: 0,
    activeTicketsWritten: 0, activeSessionsProjected: 0,
    closedPreviewWritten: 0, deletedActiveTickets: 0,
    deletedActiveSessions: 0, errors: [],
  };

  const { storeId, startMs, endMs } = args;

  let batch = db.batch();
  let opCount = 0;
  const BATCH_LIMIT = 400;

  const commitBatchIfNeeded = async () => {
      if (opCount >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          opCount = 0;
      }
  };

  try {
      const stationsRef = db.collection(`stores/${storeId}/kitchenLocations`);
      const stationsSnap = await stationsRef.where("isActive", "==", true).get();
      const stations = stationsSnap.docs.map(d => ({ id: d.id, name: d.data().name }));

      for (const station of stations) {
          const activeProjRef = db.collection(`stores/${storeId}/opPages/${station.id}/activeKdsTickets`);
          const activeProjSnap = await activeProjRef.get();
          for (const d of activeProjSnap.docs) {
              batch.delete(d.ref);
              opCount++;
              result.deletedActiveTickets++;
              await commitBatchIfNeeded();
          }
      }
      
      const activeSessionsProjRef = db.collection(`stores/${storeId}/opPages/sessionPage/activeSessions`);
      const activeSessionsProjSnap = await activeSessionsProjRef.get();
      for (const d of activeSessionsProjSnap.docs) {
          batch.delete(d.ref);
          opCount++;
          result.deletedActiveSessions++;
          await commitBatchIfNeeded();
      }

      if (opCount > 0) { await batch.commit(); batch = db.batch(); opCount = 0; }

      const sessionsRef = db.collection(`stores/${storeId}/sessions`);
      const qSessions = sessionsRef
        .where("startedAt", ">=", Timestamp.fromMillis(startMs))
        .where("startedAt", "<=", Timestamp.fromMillis(endMs))
        .orderBy("startedAt", "asc");
      
      const sessionsSnap = await qSessions.get();
      result.scannedSessions = sessionsSnap.size;
      const sessionDataCache = new Map<string, PendingSession>();
      let totalActiveSessionCount = 0;
      let totalActiveGuestCount = 0;

      for (const sessionDoc of sessionsSnap.docs) {
        const sessionData = sessionDoc.data();
        const session = { id: sessionDoc.id, ...sessionData } as PendingSession;
        sessionDataCache.set(session.id, session);

        if (session.status === 'active' || session.status === 'pending_verification') {
            totalActiveSessionCount++;
            totalActiveGuestCount += (session.guestCountFinal || session.guestCountCashierInitial || 0);

            const projRef = db.doc(`stores/${storeId}/opPages/sessionPage/activeSessions/${session.id}`);
            const projectionPayload = {
                meta: { source: 'rebuild-v1-server' },
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
                updatedAt: Timestamp.now(),
                initialFlavorIds: (session as any).initialFlavorIds || [],
            };
            batch.set(projRef, stripUndefined(projectionPayload));
            opCount++;
            result.activeSessionsProjected++;
            await commitBatchIfNeeded();
        }
      }
      
      const ticketsRefGroup = db.collectionGroup("kitchentickets");
      const qTickets = ticketsRefGroup
          .where("storeId", "==", storeId)
          .where("createdAt", ">=", Timestamp.fromMillis(startMs - 86400000))
          .where("createdAt", "<=", Timestamp.fromMillis(endMs + 86400000))
          .orderBy("createdAt", "desc");
      const ticketsSnap = await qTickets.get();
      result.scannedTickets = ticketsSnap.size;
      
      const stationDataMap = new Map<string, { activeTickets: any[]; closedTickets: any[]; todayServedMsSum: number; todayServedCount: number; }>();
      stations.forEach(s => stationDataMap.set(s.id, { activeTickets: [], closedTickets: [], todayServedMsSum: 0, todayServedCount: 0 }));
      const todayDayId = getDayIdFromTimestamp(new Date());

      for (const ticketDoc of ticketsSnap.docs) {
          const ticket = { id: ticketDoc.id, ...ticketDoc.data() } as KitchenTicket;
          const session = sessionDataCache.get(ticket.sessionId);
          if (!session) continue;

          const stationId = ticket.kitchenLocationId;
          const sData = stationDataMap.get(stationId);
          if (!sData) continue;

          const payload = { ...ticket, sessionLabel: computeSessionLabel(session), updatedAt: Timestamp.now() };

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

      for (const [stationId, data] of stationDataMap.entries()) {
          result.stationsUpdated++;
          for (const t of data.activeTickets) {
              const ref = db.doc(`stores/${storeId}/opPages/${stationId}/activeKdsTickets/${t.id}`);
              batch.set(ref, stripUndefined(t));
              opCount++;
              result.activeTicketsWritten++;
              await commitBatchIfNeeded();
          }

          const sortedClosed = data.closedTickets.sort((a, b) => (a.servedAtClientMs || a.cancelledAtClientMs || 0) - (b.servedAtClientMs || b.cancelledAtClientMs || 0)).slice(0, 15);
          const historyRef = db.doc(`stores/${storeId}/opPages/${stationId}/historyPreview/current`);
          batch.set(historyRef, {
              items: sortedClosed.map(t => ({
                  id: t.id, sessionLabel: t.sessionLabel, tableNumber: t.tableNumber, customerName: t.customerName,
                  itemName: t.itemName, qty: t.qty, status: t.status,
                  closedAtClientMs: t.servedAtClientMs || t.cancelledAtClientMs || t.createdAtClientMs || Date.now(),
                  durationMs: t.durationMs || 0
              })),
              updatedAt: Timestamp.now(),
          }, { merge: true });
          opCount++;
          result.closedPreviewWritten += sortedClosed.length;

          const stationDocRef = db.doc(`stores/${storeId}/opPages/${stationId}`);
          const summaryPayload: any = { activeCount: data.activeTickets.length, updatedAt: Timestamp.now() };
          if (getDayIdFromTimestamp(new Date(endMs)) === todayDayId) {
              summaryPayload.todayDayId = todayDayId;
              summaryPayload.todayServeCount = data.todayServedCount;
              summaryPayload.todayServeMsSum = data.todayServedMsSum;
              summaryPayload.todayServeAvgMs = data.todayServedCount > 0 ? data.todayServedMsSum / data.todayServedCount : 0;
          }
          batch.update(stationDocRef, stripUndefined(summaryPayload));
          opCount++;
          await commitBatchIfNeeded();
      }

      const sessionOpPageRef = db.doc(`stores/${storeId}/opPages/sessionPage`);
      batch.update(sessionOpPageRef, {
          activeSessionCount: totalActiveSessionCount,
          activeGuestCount: totalActiveGuestCount,
          updatedAt: Timestamp.now(),
      });
      opCount++;

      if (opCount > 0) {
          await batch.commit();
      }

  } catch (e: any) {
    result.errors.push(e.message || "An unknown error occurred during the main rebuild process.");
  }
  
  return result;
}
