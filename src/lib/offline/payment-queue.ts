"use client";

const QUEUE_KEY = "offline_payment_queue";

export type DeferredEffect = "analytics" | "loyaltyFinalize" | "loyaltyEarn" | "pinFinalize" | "loyaltyReverse";
export type EffectState = "pending" | "done" | "skip";

export interface QueuedReceiptContext {
  pin?: string | null;
  phone?: string | null;
  amount: number;
  redemptionIds?: string[];
  /** Tenders as taken offline — kept so a rejected sale can be reconciled by hand. */
  tenders?: { methodId: string; amount: number; reference?: string | null }[];
}

export interface QueuedPayment {
  id: string;
  storeId: string;
  sessionId: string;
  receiptId: string;
  queuedAtMs: number;
  status: "pending" | "syncing" | "failed";
  kind?: "payment" | "void";
  /** The OL receipt number this device minted; the sync gate compares it to the server receipt. */
  receiptNumber?: string;
  /** Matches the session's offlineWriteId stamped by the offline batch (audit B16). */
  offlineWriteId?: string;
  ctx: QueuedReceiptContext;
  effects: Record<DeferredEffect, EffectState>;
  errorMessage?: string;
  /**
   * Audit P1: offline command id. Items with an opId are settled by the server
   * (/api/pos/commands/reconcile) and their effects run from the server outbox;
   * `effects` is all "skip" for them. Items without one are legacy (pre-P1 APK).
   */
  opId?: string;
  /** Full immutable command, also written to stores/{s}/posCommands/{opId}. */
  command?: Record<string, unknown>;
  /** Receipt as shown/printed on the till while settlement is pending. */
  provisionalReceipt?: Record<string, unknown>;
  /** Set after a server rejection so a manual Retry asks the server to re-validate. */
  rejected?: boolean;
}

/** Fired on this tab whenever the queue changes (storage events cover other tabs). */
export const QUEUE_EVENT = "offline-payment-queue-changed";

function notifyQueueChanged() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT));
  } catch {
    // non-browser
  }
}

/**
 * Session ids whose offline sale/void is recorded on this till but not yet
 * accepted by the server ("pending settlement"). Rejected (failed) items are
 * NOT included, so the bill reappears for the cashier to resolve.
 */
export function pendingSettlementSessionIds(queue: QueuedPayment[] = getQueue()): Set<string> {
  return new Set(queue.filter((q) => q.opId && q.status !== "failed").map((q) => q.sessionId));
}

export function findQueuedReceipt(receiptId: string): QueuedPayment | null {
  return getQueue().find((q) => q.opId && q.receiptId === receiptId && q.provisionalReceipt) ?? null;
}

const ALL_EFFECTS: DeferredEffect[] = ["analytics", "loyaltyFinalize", "loyaltyEarn", "pinFinalize", "loyaltyReverse"];

export function pendingEffects(item: QueuedPayment): DeferredEffect[] {
  return ALL_EFFECTS.filter((e) => item.effects[e] === "pending");
}

export function markEffect(item: QueuedPayment, effect: DeferredEffect, state: EffectState): QueuedPayment {
  return { ...item, effects: { ...item.effects, [effect]: state } };
}

export function isItemComplete(item: QueuedPayment): boolean {
  return pendingEffects(item).length === 0;
}

export function getQueue(): QueuedPayment[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToQueue(item: Omit<QueuedPayment, "id" | "queuedAtMs" | "status">): QueuedPayment {
  const queue = getQueue();
  const newItem: QueuedPayment = {
    ...item,
    id: crypto.randomUUID(),
    queuedAtMs: Date.now(),
    status: "pending",
  };
  queue.push(newItem);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notifyQueueChanged();

  // Register background sync so SW can process when reconnected (PWA only)
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if ("sync" in reg) {
        (reg as any).sync.register("offline-payment-sync").catch((err: any) => {
          console.warn("[Queue] Background sync registration failed:", err);
        });
      }
    }).catch((err) => { console.warn("[Queue] SW ready failed:", err); });
  }

  return newItem;
}

export function updateQueueItem(id: string, patch: Partial<QueuedPayment>) {
  const queue = getQueue();
  const idx = queue.findIndex(q => q.id === id);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx], ...patch };
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notifyQueueChanged();
}

export function removeFromQueue(id: string) {
  const queue = getQueue().filter(q => q.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notifyQueueChanged();
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}
