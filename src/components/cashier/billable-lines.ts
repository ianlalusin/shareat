
'use client';

import {
  collection,
  query,
  limit,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
  runTransaction,
  where,
  getDoc,
  type Transaction,
  type DocumentReference,
  type CollectionReference,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { BillableItem, BillableLine, KitchenTicket } from '@/lib/types';
import { AppUser } from '@/context/auth-context';

// Helper to create a consistent key for grouping.
export function normalizeKey(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, '-');
}

// Helper to generate a key for identifying a unique billable line variant.
export function makeVariantKey(lineLike: Partial<BillableLine>): string {
  const parts = [
    lineLike.type || 'addon',
    lineLike.itemId || normalizeKey(lineLike.itemName || 'unknown'),
    `price:${(lineLike.unitPrice || 0).toFixed(2)}`,
    `free:${lineLike.isFree ? 'yes' : 'no'}`,
    `disc:${lineLike.discountType || 'none'}-${lineLike.discountValue || 0}`,
    `void:${lineLike.isVoided ? 'yes' : 'no'}`,
  ];
  return parts.join('|');
}

/**
 * Checks for the existence of the `billableLines` subcollection and, if it doesn't exist,
 * reads the legacy `billables` subcollection, groups them into line variants, and writes
 * the new `billableLines` documents in a single batch.
 *
 * This function is designed to be called once per session load.
 */
export async function ensureBillableLinesForSession(
  storeId: string,
  sessionId: string
): Promise<void> {
  const billableLinesRef = collection(db, 'stores', storeId, 'sessions', sessionId, 'billableLines');
  const legacyBillablesRef = collection(db, 'stores', storeId, 'sessions', sessionId, 'billables');

  try {
    // 1. Check if billableLines already exist.
    const checkQuery = query(billableLinesRef, limit(1));
    const checkSnap = await getDocs(checkQuery);
    if (!checkSnap.empty) {
      // billableLines already exist, no migration needed.
      return;
    }

    // 2. Read all legacy billable documents.
    const legacySnap = await getDocs(legacyBillablesRef);
    if (legacySnap.empty) {
      // Nothing to migrate.
      return;
    }

    const legacyDocs = legacySnap.docs.map(d => ({ id: d.id, ...d.data() } as BillableItem));

    // 3. Group legacy documents into new billable line variants.
    const variantMap = new Map<string, BillableLine>();

    for (const item of legacyDocs) {
      if (item.type === 'refill') continue; // Skip refills

      const variantKey = makeVariantKey(item);
      const existing = variantMap.get(variantKey);

      const qty = Math.max(1, item.qty || 1);
      const ticketIds: string[] = [];

      if (item.type === 'package') {
        // For packages with qty > 1, create synthetic IDs
        for (let i = 0; i < qty; i++) {
          ticketIds.push(`${item.id}#${i + 1}`);
        }
      } else {
        // For addons, each doc is 1 unit.
        ticketIds.push(item.id);
      }

      if (existing) {
        existing.ticketIds.push(...ticketIds);
        existing.qty = existing.ticketIds.length;
      } else {
        variantMap.set(variantKey, {
          id: '', // Will be set by Firestore
          type: item.type as 'package' | 'addon',
          itemId: (item as any).addonId || (item as any).packageId || normalizeKey(item.itemName),
          itemName: item.itemName,
          unitPrice: item.unitPrice || 0,
          ticketIds: ticketIds,
          qty: ticketIds.length,
          isFree: item.isFree || false,
          discountType: item.lineDiscountType || 'fixed',
          discountValue: item.lineDiscountValue || 0,
          isVoided: item.isVoided || false,
          voidReason: item.voidReason || undefined,
          voidNote: item.voidNote || undefined,
          voidedAt: item.voidedAt || undefined,
          voidedByUid: item.voidedByUid || undefined,
        });
      }
    }

    // 4. Write the new billableLines documents in a batch.
    if (variantMap.size === 0) return;

    const batch = writeBatch(db);
    variantMap.forEach(line => {
      const newLineRef = doc(billableLinesRef);
      batch.set(newLineRef, {
        ...line,
        id: newLineRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    console.log(`Successfully migrated ${legacyDocs.length} legacy billables into ${variantMap.size} billable lines for session ${sessionId}.`);

  } catch (error) {
    console.error(`Failed to migrate billable lines for session ${sessionId}:`, error);
    // We do not throw here to allow the UI to fall back to legacy data.
  }
}

export function getEligibleTicketIds(line: BillableLine, ticketsById: Map<string, KitchenTicket>, mode: "served" | "pending" | "any"): string[] {
    if (!line || !line.ticketIds) return [];

    return line.ticketIds.filter(ticketId => {
        const ticket = ticketsById.get(ticketId);
        // For packages, which are synthetic, there's no ticket, so we treat them as "served" for billing purposes.
        if (line.type === 'package') return true; 
        if (!ticket) return false;

        switch (mode) {
            case "served":
                return ticket.status === 'served';
            case "pending":
                return ticket.status === 'preparing' || ticket.status === 'ready';
            case "any":
                return ticket.status !== 'cancelled' && ticket.status !== 'void';
            default:
                return false;
        }
    });
}

async function findOrCreateLineByVariant(
    tx: Transaction,
    linesRef: CollectionReference,
    variant: Partial<BillableLine>
): Promise<{ ref: DocumentReference; data: BillableLine, exists: boolean }> {
    const variantKey = makeVariantKey(variant);
    // This is a limitation: we can't query inside a transaction on fields not part of the read set.
    // Instead, we'll create a deterministic ID based on the variant key.
    // This is generally safe if variant keys are unique enough.
    const deterministicId = variantKey.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 400);
    const lineRef = doc(linesRef, deterministicId);
    const lineSnap = await tx.get(lineRef);

    if (lineSnap.exists()) {
        return { ref: lineRef, data: lineSnap.data() as BillableLine, exists: true };
    } else {
        const newLineData: BillableLine = {
            id: lineRef.id,
            type: variant.type!,
            itemId: variant.itemId!,
            itemName: variant.itemName!,
            unitPrice: variant.unitPrice!,
            ticketIds: [],
            qty: 0,
            isFree: variant.isFree,
            discountType: variant.discountType,
            discountValue: variant.discountValue,
            isVoided: variant.isVoided,
            voidReason: variant.voidReason,
            voidNote: variant.voidNote,
        };
        return { ref: lineRef, data: newLineData, exists: false };
    }
}

export async function moveTicketIdsBetweenLines({
  storeId, sessionId,
  fromLineId,
  toVariant,
  ticketIdsToMove,
  actorUid,
  logAction
}: {
  storeId: string;
  sessionId: string;
  fromLineId: string;
  toVariant: Partial<BillableLine>;
  ticketIdsToMove: string[];
  actorUid: string;
  logAction?: string;
}) {
    if (ticketIdsToMove.length === 0) return;

    await runTransaction(db, async (tx) => {
        const linesRef = collection(db, `stores/${storeId}/sessions/${sessionId}/billableLines`);
        const fromLineRef = doc(linesRef, fromLineId);
        
        const fromLineSnap = await tx.get(fromLineRef);
        if (!fromLineSnap.exists()) throw new Error(`Source line ${fromLineId} not found.`);
        const fromLineData = fromLineSnap.data() as BillableLine;

        // Harden: Ensure we only move IDs that actually exist on the source line.
        const toMoveSet = new Set(ticketIdsToMove);
        const validIdsToMove = fromLineData.ticketIds.filter(id => toMoveSet.has(id));
        if (validIdsToMove.length === 0) return; // Nothing to do

        // Find or Create destination line
        const { ref: toLineRef, data: toLineData, exists: toLineExists } = await findOrCreateLineByVariant(tx, linesRef, toVariant);
        
        // Harden: Calculate new arrays using sets to prevent duplicates
        const remainingFromIds = fromLineData.ticketIds.filter(id => !toMoveSet.has(id));
        const newToIds = [...new Set([...toLineData.ticketIds, ...validIdsToMove])];

        // Update or delete the 'from' line
        if (remainingFromIds.length === 0) {
            tx.delete(fromLineRef);
        } else {
            tx.update(fromLineRef, { 
                ticketIds: remainingFromIds, 
                qty: remainingFromIds.length, 
                updatedAt: serverTimestamp() 
            });
        }

        // Update or create the 'to' line
        if (toLineExists) {
             tx.update(toLineRef, { 
                ticketIds: newToIds, 
                qty: newToIds.length, 
                updatedAt: serverTimestamp() 
            });
        } else {
             tx.set(toLineRef, { 
                ...toLineData, 
                ticketIds: newToIds, 
                qty: newToIds.length, 
                createdAt: serverTimestamp(), 
                updatedAt: serverTimestamp() 
            });
        }
    });
}

export async function updateLineUnitPrice(
  storeId: string,
  sessionId: string,
  lineId: string,
  newPrice: number,
  actorUid: string
) {
    const lineRef = doc(db, `stores/${storeId}/sessions/${sessionId}/billableLines`, lineId);
    const lineSnap = await getDoc(lineRef);
    if (!lineSnap.exists()) throw new Error("Line item not found.");
    const lineData = lineSnap.data() as BillableLine;

    await moveTicketIdsBetweenLines({
        storeId,
        sessionId,
        fromLineId: lineId,
        toVariant: { ...lineData, unitPrice: newPrice },
        ticketIdsToMove: lineData.ticketIds,
        actorUid: actorUid,
        logAction: 'change_price'
    });
}


export async function changeLineQty(
    storeId: string,
    sessionId: string,
    lineId: string,
    newQty: number,
    actor: AppUser,
    tickets: Map<string, KitchenTicket>
) {
    const lineRef = doc(db, `stores/${storeId}/sessions/${sessionId}/billableLines`, lineId);
    
    await runTransaction(db, async (tx) => {
        const lineSnap = await tx.get(lineRef);
        if (!lineSnap.exists()) throw new Error("Line item not found.");
        const lineData = lineSnap.data() as BillableLine;

        const currentQty = lineData.qty;
        if (newQty === currentQty) return;

        if (newQty > currentQty) {
            // INCREASING QTY
            if (lineData.isVoided || lineData.isFree || (lineData.discountValue ?? 0) > 0) {
                throw new Error("Quantity can only be increased on regular, non-discounted items.");
            }
            if (lineData.type !== 'addon') {
                throw new Error("Quantity can only be changed for add-on items.");
            }

            const addonDoc = await getDoc(doc(db, `stores/${storeId}/storeAddons`, lineData.itemId));
            if (!addonDoc.exists()) throw new Error(`Addon details for ID ${lineData.itemId} not found.`);
            const addonData = addonDoc.data() as any;

            const sessionDoc = await getDoc(doc(db, `stores/${storeId}/sessions`, sessionId));
            const sessionData = sessionDoc.data();

            const newTicketIds: string[] = [];
            const ticketsColRef = collection(db, `stores/${storeId}/sessions/${sessionId}/kitchentickets`);

            for (let i = 0; i < (newQty - currentQty); i++) {
                const newTicketRef = doc(ticketsColRef);
                newTicketIds.push(newTicketRef.id);
                tx.set(newTicketRef, {
                    id: newTicketRef.id,
                    type: "addon",
                    itemName: lineData.itemName,
                    qty: 1,
                    kitchenLocationId: addonData.kitchenLocationId,
                    status: "preparing",
                    createdAt: serverTimestamp(),
                    createdByUid: actor.uid,
                    sessionId: sessionId, 
                    storeId: storeId,
                    tableNumber: sessionData?.tableNumber,
                    sessionLabel: sessionData?.sessionLabel,
                });
            }
            
            tx.update(lineRef, {
                ticketIds: [...lineData.ticketIds, ...newTicketIds],
                qty: newQty,
                updatedAt: serverTimestamp()
            });

        } else {
            // DECREASING QTY
            const qtyToReduce = currentQty - newQty;
            const pendingIds = getEligibleTicketIds(lineData, tickets, "pending");
            const servedIds = getEligibleTicketIds(lineData, tickets, "served");

            const ticketsToCancel = [
                ...pendingIds.slice(0, qtyToReduce),
                ...servedIds.slice(0, qtyToReduce - pendingIds.length)
            ];

            if (ticketsToCancel.length < qtyToReduce) {
                throw new Error("Cannot reduce quantity below the number of non-cancellable items.");
            }

            const remainingTicketIds = lineData.ticketIds.filter(id => !ticketsToCancel.includes(id));
            
            tx.update(lineRef, {
                ticketIds: remainingTicketIds,
                qty: remainingTicketIds.length,
                updatedAt: serverTimestamp()
            });
            
            // Mark the corresponding kitchen tickets as cancelled
            const ticketsColRef = collection(db, `stores/${storeId}/sessions/${sessionId}/kitchentickets`);
            for (const ticketId of ticketsToCancel) {
                tx.update(doc(ticketsColRef, ticketId), {
                    status: "cancelled",
                    cancelReason: "QTY_REDUCED",
                    cancelledAt: serverTimestamp(),
                    cancelledByUid: actor.uid
                });
            }
        }
    });
}

    