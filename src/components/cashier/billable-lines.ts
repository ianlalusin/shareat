
'use client';

import {
  collection,
  query,
  limit,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { BillableItem, BillableLine } from '@/lib/types';

// Helper to create a consistent key for grouping.
export function normalizeKey(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, '-');
}

// Helper to generate a key for identifying a unique billable line variant.
export function makeVariantKey(lineLike: Partial<BillableItem>): string {
  const parts = [
    lineLike.type || 'addon',
    (lineLike as any).addonId || (lineLike as any).packageId || normalizeKey(lineLike.itemName || 'unknown'),
    `price:${(lineLike.unitPrice || 0).toFixed(2)}`,
    `free:${lineLike.isFree ? 'yes' : 'no'}`,
    `disc:${lineLike.lineDiscountType || 'none'}-${lineLike.lineDiscountValue || 0}`,
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
