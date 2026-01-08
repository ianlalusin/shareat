
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
  Transaction,
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
    linesRef: collection,
    variant: Partial<BillableLine>
): Promise<{ ref: DocumentReference; data: BillableLine }> {
    const variantKey = makeVariantKey(variant);
    // This is a limitation: we can't query inside a transaction on fields not part of the read set.
    // Instead, we'll create a deterministic ID based on the variant key.
    // This is generally safe if variant keys are unique enough.
    const deterministicId = variantKey.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 400);
    const lineRef = doc(linesRef, deterministicId);
    const lineSnap = await tx.get(lineRef);

    if (lineSnap.exists()) {
        return { ref: lineRef, data: lineSnap.data() as BillableLine };
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
        return { ref: lineRef, data: newLineData };
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
        
        // 1. Read fromLine
        const fromLineSnap = await tx.get(fromLineRef);
        if (!fromLineSnap.exists()) throw new Error(`Source line ${fromLineId} not found.`);
        const fromLineData = fromLineSnap.data() as BillableLine;

        // 2. Ensure tickets exist in source
        const fromTicketSet = new Set(fromLineData.ticketIds);
        for (const ticketId of ticketIdsToMove) {
            if (!fromTicketSet.has(ticketId)) {
                throw new Error(`Ticket ${ticketId} not found in source line ${fromLineId}.`);
            }
        }
        
        // 3. Find or Create destination line
        const { ref: toLineRef, data: toLineData } = await findOrCreateLineByVariant(tx, linesRef, toVariant);
        
        // 4. Update both lines
        const newFromTicketIds = fromLineData.ticketIds.filter(id => !ticketIdsToMove.includes(id));
        const newToTicketIds = [...new Set([...toLineData.ticketIds, ...ticketIdsToMove])];

        if (newFromTicketIds.length === 0) {
            tx.delete(fromLineRef);
        } else {
            tx.update(fromLineRef, { ticketIds: newFromTicketIds, qty: newFromTicketIds.length, updatedAt: serverTimestamp() });
        }

        if (toLineSnap.exists()) {
             tx.update(toLineRef, { ticketIds: newToTicketIds, qty: newToTicketIds.length, updatedAt: serverTimestamp() });
        } else {
             tx.set(toLineRef, { ...toLineData, ticketIds: newToTicketIds, qty: newToTicketIds.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        }
    });
}
