/**
 * Shared offline-sync status (audit F23, 2026-10-30).
 *
 * One place that says what the offline payment queue is really doing, so the
 * banner stops treating `navigator.onLine` as "synced". The queue sync hook
 * (src/hooks/use-payment-queue-sync.ts) publishes its runtime state here; the
 * banner reads queue counts from localStorage plus this runtime state and
 * derives what to show with `deriveSyncBanner` (pure, unit-tested).
 */
import type { QueuedPayment } from "./payment-queue";

export interface QueueCounts {
  pending: number; // waiting to replay (includes "syncing" left over)
  failed: number; // terminal conflict, needs a person
  total: number;
}

export interface SyncRuntime {
  /** A drain is running right now. */
  syncing: boolean;
  /** Automatic retries are used up while items are still pending. */
  stalled: boolean;
  /** Items the server acknowledged in the most recent drain. */
  lastCompletedCount: number;
  /** When that acknowledgement happened (ms), null if never. */
  lastCompletedAt: number | null;
}

export type BannerTone = "offline" | "info" | "warning" | "error" | "success";

export interface SyncBanner {
  visible: boolean;
  tone: BannerTone;
  text: string;
  showRetry: boolean;
}

export const SYNCED_FLASH_MS = 4000;

export function summarizeQueue(queue: Pick<QueuedPayment, "status">[]): QueueCounts {
  let pending = 0;
  let failed = 0;
  for (const q of queue) {
    if (q.status === "failed") failed += 1;
    else pending += 1;
  }
  return { pending, failed, total: pending + failed };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What the banner should say. Rules:
 * - offline: always visible, says how many sales are queued on this device;
 * - online with failed items: stays visible (error) with Retry until resolved;
 * - online with pending items: stays visible; "syncing" while a drain runs,
 *   "not synced yet" + Retry when automatic retries are exhausted;
 * - "synced" only after the sync actually confirmed items this drain, and only
 *   for a short flash. A reconnect with nothing queued shows nothing.
 */
export function deriveSyncBanner(args: {
  online: boolean;
  counts: QueueCounts;
  runtime: SyncRuntime;
  now: number;
}): SyncBanner {
  const { online, counts, runtime, now } = args;
  const hidden: SyncBanner = { visible: false, tone: "info", text: "", showRetry: false };

  if (!online) {
    const queued = counts.pending > 0 ? ` ${plural(counts.pending, "offline sale")} saved on this device, waiting to sync.` : "";
    const failed = counts.failed > 0 ? ` ${plural(counts.failed, "sale")} need attention.` : "";
    return {
      visible: true,
      tone: "offline",
      text: `You are offline.${queued}${failed}` + (queued || failed ? "" : " Payments will be saved on this device."),
      showRetry: false,
    };
  }

  if (counts.failed > 0) {
    const also = counts.pending > 0 ? ` ${plural(counts.pending, "other sale")} still waiting.` : "";
    return {
      visible: true,
      tone: "error",
      text: `${plural(counts.failed, "offline sale")} could not sync and need a manager to check.${also}`,
      showRetry: !runtime.syncing,
    };
  }

  if (counts.pending > 0) {
    if (runtime.syncing) {
      return { visible: true, tone: "info", text: `Syncing ${plural(counts.pending, "offline sale")}…`, showRetry: false };
    }
    if (runtime.stalled) {
      return {
        visible: true,
        tone: "warning",
        text: `${plural(counts.pending, "offline sale")} not synced yet. Automatic retries stopped.`,
        showRetry: true,
      };
    }
    return {
      visible: true,
      tone: "info",
      text: `${plural(counts.pending, "offline sale")} waiting to sync.`,
      showRetry: true,
    };
  }

  if (
    runtime.lastCompletedAt !== null &&
    runtime.lastCompletedCount > 0 &&
    now - runtime.lastCompletedAt < SYNCED_FLASH_MS
  ) {
    return {
      visible: true,
      tone: "success",
      text: `${plural(runtime.lastCompletedCount, "offline sale")} synced.`,
      showRetry: false,
    };
  }

  return hidden;
}

// ---------------------------------------------------------------------------
// Tiny shared store (works with useSyncExternalStore)
// ---------------------------------------------------------------------------

const INITIAL: SyncRuntime = { syncing: false, stalled: false, lastCompletedCount: 0, lastCompletedAt: null };
let runtime: SyncRuntime = INITIAL;
const listeners = new Set<() => void>();
let retryHandler: (() => void) | null = null;

export function getSyncRuntime(): SyncRuntime {
  return runtime;
}

export function getServerSyncRuntime(): SyncRuntime {
  return INITIAL;
}

export function setSyncRuntime(patch: Partial<SyncRuntime>) {
  runtime = { ...runtime, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeSyncRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The sync hook registers how to retry; the banner's Retry button calls it. */
export function registerSyncRetry(fn: (() => void) | null) {
  retryHandler = fn;
}

export function requestSyncRetry(): boolean {
  if (!retryHandler) return false;
  retryHandler();
  return true;
}

/** Test-only reset. */
export function __resetSyncRuntime() {
  runtime = INITIAL;
  listeners.clear();
  retryHandler = null;
}
