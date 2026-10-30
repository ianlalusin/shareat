// Keyed receipt loading + autoprint gating for the /receipt page.
// Pure (no React, no Firestore) so the race rules are unit-testable:
//   - state is keyed by store+receipt id and cleared the moment the key changes;
//   - a superseded fetch can never write its result;
//   - autoprint fires only for a loaded record whose key equals the requested
//     key, at most once per key per page, and is marked printed only after the
//     print was actually dispatched.

export type ReceiptLoadStatus = "idle" | "loading" | "loaded" | "error";

export interface ReceiptLoadState<T> {
  key: string | null;
  storeId: string | null;
  receiptId: string | null;
  status: ReceiptLoadStatus;
  data: T | null;
  error: string | null;
}

export const IDLE_RECEIPT_STATE: ReceiptLoadState<never> = {
  key: null, storeId: null, receiptId: null, status: "idle", data: null, error: null,
};

export function receiptLoadKey(storeId: string | null | undefined, receiptId: string | null | undefined): string | null {
  return storeId && receiptId ? `${storeId}/${receiptId}` : null;
}

export class ReceiptLoader<T> {
  private generation = 0;
  private current: ReceiptLoadState<T> = IDLE_RECEIPT_STATE;

  constructor(
    private readonly fetcher: (storeId: string, receiptId: string) => Promise<T>,
    private readonly onChange: (state: ReceiptLoadState<T>) => void,
  ) {}

  get state(): ReceiptLoadState<T> {
    return this.current;
  }

  private set(next: ReceiptLoadState<T>) {
    this.current = next;
    this.onChange(next);
  }

  /** Start loading (storeId, receiptId); same key while loading/loaded is a no-op. */
  load(storeId: string | null | undefined, receiptId: string | null | undefined): void {
    const key = receiptLoadKey(storeId, receiptId);
    if (key && key === this.current.key && this.current.status !== "error") return;
    const gen = ++this.generation;
    if (!key) {
      this.set(IDLE_RECEIPT_STATE);
      return;
    }
    // Clear the previous record synchronously so nothing can print/show it under the new key.
    this.set({ key, storeId: storeId!, receiptId: receiptId!, status: "loading", data: null, error: null });
    this.fetcher(storeId!, receiptId!).then(
      (data) => {
        if (gen !== this.generation) return; // superseded
        this.set({ key, storeId: storeId!, receiptId: receiptId!, status: "loaded", data, error: null });
      },
      (err: unknown) => {
        if (gen !== this.generation) return;
        const message = err instanceof Error ? err.message : String(err ?? "Failed to load receipt.");
        this.set({ key, storeId: storeId!, receiptId: receiptId!, status: "error", data: null, error: message });
      },
    );
  }

  /** Invalidate any in-flight fetch (unmount); a later load() of the same key refetches. */
  dispose(): void {
    this.generation++;
    this.current = IDLE_RECEIPT_STATE;
  }
}

export interface AutoprintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function autoprintStorageKey(storeId: string, receiptId: string): string {
  return `autoprint:${storeId}:${receiptId}`;
}

/**
 * Print the loaded receipt once if autoprint was requested for exactly this key.
 * `attempted` (per page instance) stops retry loops after a failed print; the
 * storage mark is written only when `print` reports a dispatched job.
 * Returns the key that was printed, or null.
 */
export async function maybeAutoprint<T>(opts: {
  enabled: boolean;
  ready: boolean;
  requestedKey: string | null;
  state: ReceiptLoadState<T>;
  attempted: Set<string>;
  storage: AutoprintStorage | null;
  print: (state: ReceiptLoadState<T>) => Promise<boolean>;
}): Promise<string | null> {
  const { enabled, ready, requestedKey, state, attempted, storage, print } = opts;
  if (!enabled || !ready || !requestedKey) return null;
  if (state.status !== "loaded" || !state.data || state.key !== requestedKey) return null;
  if (!state.storeId || !state.receiptId) return null;
  if (attempted.has(state.key)) return null;
  const markKey = autoprintStorageKey(state.storeId, state.receiptId);
  try {
    if (storage?.getItem(markKey) === "1") return null;
  } catch { /* storage unavailable: still print once per page */ }
  attempted.add(state.key);
  const ok = await print(state);
  if (!ok) return null;
  try { storage?.setItem(markKey, "1"); } catch { /* ignore */ }
  return state.key;
}
