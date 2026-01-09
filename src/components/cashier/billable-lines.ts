
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
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { BillableLine, KitchenTicket } from '@/lib/types';
import { AppUser } from '@/context/auth-context';
import { sha1 } from 'js-sha1';
import { writeActivityLog } from './activity-log';

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
 * Ensures a ticket ID array is unique and sorted.
 * This guarantees consistency for comparisons and data integrity.
 * @param ticketIds An array of ticket IDs.
 * @returns A new array with unique, sorted ticket IDs.
 */
export function normalizeTicketIds(ticketIds: string[]): string[] {
  if (!Array.isArray(ticketIds)) return [];
  return [...new Set(ticketIds)].sort();
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

export async function findOrCreateLineByVariantTx(
    tx: Transaction,
    linesRef: CollectionReference,
    variant: Partial<BillableLine>
): Promise<{ ref: DocumentReference; data: BillableLine, exists: boolean }> {
    const variantKey = makeVariantKey(variant);
    const deterministicId = sha1(variantKey).substring(0, 20);
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
            ticketIds: [], // Always start with an empty array
            qty: 0,        // And a quantity of 0
            isFree: variant.isFree ?? false,
            discountType: variant.discountType,
            discountValue: variant.discountValue,
            isVoided: variant.isVoided ?? false,
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
  actor,
  action,
  reason,
  note,
  meta,
}: {
  storeId: string;
  sessionId: string;
  fromLineId: string;
  toVariant: Partial<BillableLine>;
  ticketIdsToMove: string[];
  actor: AppUser;
  action: ActivityLog['action'];
  reason?: string | null;
  note?: string | null;
  meta?: ActivityLog['meta'];
}) {
    if (ticketIdsToMove.length === 0) return;

    let fromLineFinalData: BillableLine | null = null;
    let toLineFinalData: BillableLine | null = null;

    await runTransaction(db, async (tx) => {
        const linesRef = collection(db, `stores/${storeId}/sessions/${sessionId}/billableLines`);
        const fromLineRef = doc(linesRef, fromLineId);
        
        const { ref: toLineRef, data: toLineData, exists: toLineExists } = await findOrCreateLineByVariantTx(tx, linesRef, toVariant);
        
        if (fromLineRef.id === toLineRef.id) {
            console.warn("moveTicketIdsBetweenLines: Attempted to move tickets to their own variant. Aborting.");
            return;
        }

        const fromLineSnap = await tx.get(fromLineRef);
        if (!fromLineSnap.exists()) throw new Error(`Source line ${fromLineId} not found.`);
        const fromLineData = fromLineSnap.data() as BillableLine;

        const toMoveSet = new Set(ticketIdsToMove);
        const validIdsToMove = fromLineData.ticketIds.filter(id => toMoveSet.has(id));
        if (validIdsToMove.length === 0) return;

        const remainingFromIds = normalizeTicketIds(fromLineData.ticketIds.filter(id => !toMoveSet.has(id)));
        const newToIds = normalizeTicketIds([...(toLineData.ticketIds || []), ...validIdsToMove]);

        if (remainingFromIds.length === 0 && fromLineData.type === 'addon') {
            tx.delete(fromLineRef);
            fromLineFinalData = { ...fromLineData, ticketIds: [], qty: 0 };
        } else {
            const updatedQty = fromLineData.type === 'package' ? fromLineData.qty : remainingFromIds.length;
            fromLineFinalData = { ...fromLineData, ticketIds: remainingFromIds, qty: updatedQty };
            tx.update(fromLineRef, { 
                ticketIds: remainingFromIds, 
                qty: updatedQty, 
                updatedAt: serverTimestamp() 
            });
        }
        
        const toLineQty = toLineData.type === 'package' ? toLineData.qty : newToIds.length;
        toLineFinalData = { ...toLineData, ticketIds: newToIds, qty: toLineQty };
        const toLinePayload = {
            ...toVariant, // Use the target variant to ensure all properties are correct
            ticketIds: newToIds,
            qty: toLineQty,
            updatedAt: serverTimestamp()
        };
        
        if (toLineExists) {
             tx.set(toLineRef, toLinePayload, { merge: true });
        } else {
             tx.set(toLineRef, { ...toLinePayload, createdAt: serverTimestamp() }, { merge: true });
        }
    });

    // Best-effort logging outside the transaction
    if (fromLineFinalData && toLineFinalData) {
        await writeActivityLog({
            storeId,
            sessionId,
            user: actor,
            action,
            ticketIds: ticketIdsToMove,
            fromLineId: fromLineId,
            toLineId: toLineFinalData.id,
            lineIds: [fromLineId, toLineFinalData.id],
            reason,
            note,
            meta: {
                ...meta,
                qty: ticketIdsToMove.length,
                itemName: toLineFinalData.itemName,
            },
        });
    }
}

export async function updateLineUnitPrice(
  storeId: string,
  sessionId: string,
  line: BillableLine,
  newPrice: number,
  actor: AppUser
) {
    const lineRef = doc(db, `stores/${storeId}/sessions/${sessionId}/billableLines`, line.id);
    
    if (line.type === 'package') {
        await updateDoc(lineRef, { unitPrice: newPrice, updatedAt: serverTimestamp() });
        // Log this simple change
        await writeActivityLog({
            storeId,
            sessionId,
            user: actor,
            action: 'PRICE_OVERRIDE',
            lineIds: [line.id],
            meta: {
                itemId: line.itemId,
                itemName: line.itemName,
                unitPriceBefore: line.unitPrice,
                unitPriceAfter: newPrice,
            },
        });
        return;
    }

    await moveTicketIdsBetweenLines({
        storeId,
        sessionId,
        fromLineId: line.id,
        toVariant: { ...line, unitPrice: newPrice },
        ticketIdsToMove: line.ticketIds, // Move all tickets
        actor,
        action: 'PRICE_OVERRIDE',
        meta: {
            itemId: line.itemId,
            itemName: line.itemName,
            unitPriceBefore: line.unitPrice,
            unitPriceAfter: newPrice,
        }
    });
}


export async function changeLineQty(
    storeId: string,
    sessionId: string,
    line: BillableLine,
    newQty: number,
    actor: AppUser,
    tickets: Map<string, KitchenTicket>
) {
    const lineRef = doc(db, `stores/${storeId}/sessions/${sessionId}/billableLines`, line.id);
    
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
            
            const finalTicketIds = normalizeTicketIds([...lineData.ticketIds, ...newTicketIds]);
            tx.update(lineRef, {
                ticketIds: finalTicketIds,
                qty: finalTicketIds.length,
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

            const remainingTicketIds = normalizeTicketIds(lineData.ticketIds.filter(id => !ticketsToCancel.includes(id)));
            
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
