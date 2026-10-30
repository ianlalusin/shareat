"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getQueue } from "@/lib/offline/payment-queue";
import {
  SYNCED_FLASH_MS,
  deriveSyncBanner,
  getServerSyncRuntime,
  getSyncRuntime,
  requestSyncRetry,
  subscribeSyncRuntime,
  summarizeQueue,
  type QueueCounts,
} from "@/lib/offline/sync-status";

const QUEUE_POLL_MS = 2000;
const EMPTY: QueueCounts = { pending: 0, failed: 0, total: 0 };

function sameCounts(a: QueueCounts, b: QueueCounts) {
  return a.pending === b.pending && a.failed === b.failed;
}

/**
 * Offline / sync status strip (audit F23).
 *
 * Shows the payment queue's real state: queued and failed offline sales, a
 * live "syncing", and a Retry button. It stays up while anything is pending
 * or failed, and only says "synced" after the sync confirmed items with the
 * server — never just because the network came back.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY);
  const [now, setNow] = useState(() => Date.now());
  const runtime = useSyncExternalStore(subscribeSyncRuntime, getSyncRuntime, getServerSyncRuntime);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCounts = useCallback(() => {
    const next = summarizeQueue(getQueue());
    setCounts((prev) => (sameCounts(prev, next) ? prev : next));
  }, []);

  // Network state. Set after mount to avoid an SSR/hydration mismatch.
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Queue counts: the queue lives in localStorage and is written by the
  // checkout and the sync hook in this tab (no storage event), so poll it
  // cheaply, and also re-read whenever the sync runtime or another tab changes.
  useEffect(() => {
    refreshCounts();
    const id = setInterval(refreshCounts, QUEUE_POLL_MS);
    window.addEventListener("storage", refreshCounts);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage", refreshCounts);
    };
  }, [refreshCounts]);

  useEffect(() => {
    refreshCounts();
  }, [runtime, online, refreshCounts]);

  // Re-render once when the "synced" flash should end. One timer, replaced on
  // every change and cleared on unmount, so a flap can never hide a newer state.
  useEffect(() => {
    setNow(Date.now());
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = null;
    if (runtime.lastCompletedAt !== null) {
      const left = runtime.lastCompletedAt + SYNCED_FLASH_MS - Date.now();
      if (left > 0) flashTimer.current = setTimeout(() => setNow(Date.now()), left + 50);
    }
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = null;
    };
  }, [runtime.lastCompletedAt, online]);

  const banner = deriveSyncBanner({ online, counts, runtime, now });
  if (!banner.visible) return null;

  const Icon =
    banner.tone === "offline" ? WifiOff :
    banner.tone === "success" ? CheckCircle2 :
    banner.tone === "info" && runtime.syncing ? Loader2 :
    banner.tone === "info" ? RefreshCw :
    AlertTriangle;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed top-0 left-0 right-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-medium transition-colors",
        banner.tone === "offline" && "bg-destructive text-destructive-foreground",
        banner.tone === "error" && "bg-destructive text-destructive-foreground",
        banner.tone === "warning" && "bg-amber-500 text-black",
        banner.tone === "info" && "bg-sky-600 text-white",
        banner.tone === "success" && "bg-green-600 text-white",
      )}
    >
      <span className="flex items-center gap-2 text-center">
        <Icon size={16} className={cn("shrink-0", Icon === Loader2 && "animate-spin")} aria-hidden />
        {banner.text}
      </span>
      {banner.showRetry && (
        <button
          type="button"
          onClick={() => requestSyncRetry()}
          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-current bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
        >
          <RefreshCw size={14} aria-hidden /> Retry sync
        </button>
      )}
    </div>
  );
}
