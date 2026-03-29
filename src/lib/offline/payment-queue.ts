"use client";

const QUEUE_KEY = "offline_payment_queue";

export type QueuedPayment = {
  id: string;
  storeId: string;
  sessionId: string;
  queuedAtMs: number;
  status: "pending" | "syncing" | "failed";
  payload: {
    payments: any[];
    billLines: any[];
    billDiscount: any | null;
    customAdjustments: any[];
    totalAmount: number;
  };
  errorMessage?: string;
};

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

  // Register background sync so SW can process when reconnected (PWA only)
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if ("sync" in reg) {
        (reg as any).sync.register("offline-payment-sync").catch((err: any) => {
          console.warn("[Queue] Background sync registration failed:", err);
        });
      }
    }).catch(() => {});
  }

  return newItem;
}

export function updateQueueItem(id: string, patch: Partial<QueuedPayment>) {
  const queue = getQueue();
  const idx = queue.findIndex(q => q.id === id);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx], ...patch };
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function removeFromQueue(id: string) {
  const queue = getQueue().filter(q => q.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}
