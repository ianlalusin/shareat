"use client";

import type { KVStore } from "@/lib/offline/device";

/** Zero-pads a non-negative integer to `width` digits. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Formats an offline receipt number `<storeCode>-OL-<HHMM>-<NNN>`.
 * `date` supplies the device wall-clock finalize time; `seq` is the per-device
 * daily sequence. Example: `SHT-OL-0320-001`.
 */
export function formatOfflineReceiptNumber(args: {
  storeCode: string;
  date: Date;
  seq: number;
}): string {
  const { storeCode, date, seq } = args;
  const hhmm = pad(date.getHours(), 2) + pad(date.getMinutes(), 2);
  return `${storeCode}-OL-${hhmm}-${pad(seq, 3)}`;
}

const SEQ_KEY = "pos_offline_seq";

interface DailySeqState {
  ymd: string; // local calendar day the counter belongs to
  seq: number; // last issued sequence for that day
}

function localYmd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * Allocates the next gapless per-device sequence for the local day of `date`,
 * resetting to 1 when the calendar day changes. Persisted via `KVStore` so it
 * survives reloads. NOTE: production callers must serialize access to avoid two
 * tabs reusing a sequence; the durable IndexedDB single-writer wrapper is added
 * in Plan 3 where this is wired into payment.
 */
export function nextDailySeq(store: KVStore, date: Date): number {
  const ymd = localYmd(date);
  let state: DailySeqState | null = null;
  const raw = store.getItem(SEQ_KEY);
  if (raw) {
    try {
      state = JSON.parse(raw) as DailySeqState;
    } catch {
      state = null;
    }
  }
  const seq = state && state.ymd === ymd ? state.seq + 1 : 1;
  store.setItem(SEQ_KEY, JSON.stringify({ ymd, seq }));
  return seq;
}

/** Convenience: allocate the next daily sequence and format it in one call. */
export function allocateOfflineReceiptNumber(
  store: KVStore,
  storeCode: string,
  date: Date,
): string {
  const seq = nextDailySeq(store, date);
  return formatOfflineReceiptNumber({ storeCode, date, seq });
}
