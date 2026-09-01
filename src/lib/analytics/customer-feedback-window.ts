import { getDayStartMs, getManilaDayOfWeek, getDayIdFromTimestamp } from "./daily";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export type SelectedRange = { start: Date | number; end: Date | number };
export type Window = { startMs: number; endMs: number };

function toMs(v: Date | number): number {
  return v instanceof Date ? v.getTime() : v;
}

/** Sun 00:00 Manila epoch ms for the calendar week containing `ts`. */
export function getManilaWeekStartMs(ts: number | Date): number {
  return getDayStartMs(ts) - getManilaDayOfWeek(ts) * DAY_MS;
}

/**
 * Resolves the dashboard's selected date range into the window the feedback
 * card should query. Ranges shorter than a full week snap to the Manila
 * calendar week (Sun-Sat) containing the range's start, since a single day of
 * feedback is too sparse to summarize on its own. Ranges a week or longer are
 * used as given. The returned window is always half-open [startMs, endMs) —
 * callers passing an inclusive end (e.g. `endOfDay`, 23:59:59.999) get it
 * converted by +1ms.
 */
export function resolveCandidateWindow(range: SelectedRange): Window {
  const startMs = toMs(range.start);
  const endMsInclusive = toMs(range.end);
  const spanMs = endMsInclusive - startMs + 1;

  if (spanMs < WEEK_MS) {
    const weekStartMs = getManilaWeekStartMs(startMs);
    return { startMs: weekStartMs, endMs: weekStartMs + WEEK_MS };
  }

  return { startMs, endMs: endMsInclusive + 1 };
}

/**
 * Whether the most recent feedback entry (or null if there is none) falls on
 * the same Manila calendar day as `nowMs` — drives the dashboard card's
 * "new feedback today" red-border highlight.
 */
export function hasFeedbackToday(mostRecentDateMs: number | null, nowMs: number): boolean {
  if (mostRecentDateMs === null) return false;
  return getDayIdFromTimestamp(mostRecentDateMs) === getDayIdFromTimestamp(nowMs);
}

/**
 * Candidate windows to try in order for the summary card: the resolved
 * window first, then stepping back by exactly its own size until one has
 * data (checked by the caller) or `maxSteps` is exhausted.
 */
export function feedbackFallbackWindows(range: SelectedRange, maxSteps = 52): Window[] {
  const first = resolveCandidateWindow(range);
  const stepMs = first.endMs - first.startMs;

  const windows: Window[] = [];
  for (let i = 0; i <= maxSteps; i++) {
    windows.push({ startMs: first.startMs - i * stepMs, endMs: first.endMs - i * stepMs });
  }
  return windows;
}
