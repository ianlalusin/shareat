"use client";

import type { Receipt } from "@/lib/types";
import { postPosCommand } from "@/lib/pos-commands/client";

/**
 * Receipt void / correction through the server commands (audit P1 / B01).
 * Replaces the client batches in app/receipts/page.tsx and
 * components/receipts/page.tsx; the server snapshots its own copy for the
 * revision, recomputes totals and queues the analytics / loyalty effects.
 */

export async function voidReceiptCommand(
  storeId: string,
  receiptId: string,
  v: {
    reason: string;
    voidCashDisposition?: "refunded" | "retained" | "partial";
    voidCashRefunded?: number;
  },
): Promise<{ alreadyVoided: boolean }> {
  return postPosCommand("receipt-void", storeId, {
    receiptId,
    reason: v.reason,
    ...(v.voidCashDisposition ? { voidCashDisposition: v.voidCashDisposition } : {}),
    ...(v.voidCashDisposition === "partial" ? { voidCashRefunded: v.voidCashRefunded } : {}),
  });
}

/**
 * `updated` is what EditReceiptDialog built. Only the editable inputs are sent
 * (lines, discounts, customer fields, tenders); totals and analytics are
 * recomputed by the server.
 */
export async function saveReceiptCorrectionCommand(
  storeId: string,
  original: Receipt,
  updated: Partial<Receipt>,
  reason: string,
  methodIdByName: (name: string) => string | null,
): Promise<{ revisionId: string; editVersion: number; total: number }> {
  const mop = ((updated.analytics as any)?.mop ?? {}) as Record<string, number>;
  const payments = Object.entries(mop).map(([name, amount], i) => ({
    id: `p${i}`,
    methodId: methodIdByName(name) ?? name,
    amount: Math.round(Number(amount) * 100) / 100,
  }));
  return postPosCommand("receipt-edit", storeId, {
    receiptId: original.id,
    expectedEditVersion: Number(original.editVersion || 0),
    reason,
    lines: updated.lines ?? original.lines,
    billDiscount: updated.billDiscount ?? null,
    customAdjustments: updated.customAdjustments ?? [],
    customerName: updated.customerName ?? null,
    customerTin: (updated as any).customerTin ?? null,
    customerAddress: (updated as any).customerAddress ?? null,
    payments,
  });
}
