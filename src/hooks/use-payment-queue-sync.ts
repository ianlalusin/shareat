"use client";
import { useEffect, useRef, useCallback } from "react";
import { useOnlineStatus } from "./use-online-status";
import { getQueue, updateQueueItem, removeFromQueue } from "@/lib/offline/payment-queue";
import { useToast } from "./use-toast";

export function usePaymentQueueSync(
  onSync: (queuedId: string, storeId: string, sessionId: string, payload: any) => Promise<string>
) {
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const isSyncingRef = useRef(false);
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  const processQueue = useCallback(async () => {
    if (isSyncingRef.current) return;
    const queue = getQueue().filter(q => q.status === "pending");
    if (queue.length === 0) return;

    isSyncingRef.current = true;
    try {
      for (const item of queue) {
        updateQueueItem(item.id, { status: "syncing" });
        try {
          await onSyncRef.current(item.id, item.storeId, item.sessionId, item.payload);
          removeFromQueue(item.id);
          toast({
            title: "Payment synced",
            description: `Offline payment for session ${item.sessionId.slice(0, 6)}... has been processed.`,
          });
        } catch (err: any) {
          updateQueueItem(item.id, { status: "failed", errorMessage: err.message });
          toast({
            variant: "destructive",
            title: "Sync failed",
            description: `Could not sync offline payment: ${err.message}`,
          });
        }
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, [toast]);

  // Process queue when coming back online
  useEffect(() => {
    if (isOnline) processQueue();
  }, [isOnline, processQueue]);

  // Listen for SW background sync message (PWA)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "PROCESS_PAYMENT_QUEUE") {
        console.log("[QueueSync] SW triggered sync");
        processQueue();
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [processQueue]);
}
