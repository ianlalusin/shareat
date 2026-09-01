export const CHAT_RESPONSE_STANDARD_MS = 2 * 60 * 1000;

/**
 * Elapsed time credited to a responder: from whichever is LATER — the
 * message's arrival, or the responder's own on-duty start. A cashier who
 * inherits a stale message from a shift handover is timed from when they
 * actually came on duty, never from before.
 */
export function computeFairResponseMs(
  arrivalMs: number,
  responderOnDutyStartMs: number | null,
  respondedAtMs: number,
): number {
  const effectiveStart = responderOnDutyStartMs != null
    ? Math.max(arrivalMs, responderOnDutyStartMs)
    : arrivalMs;
  return Math.max(0, respondedAtMs - effectiveStart);
}

export function isWithinStandard(fairResponseMs: number): boolean {
  return fairResponseMs <= CHAT_RESPONSE_STANDARD_MS;
}

export type ChatRating = "very poor" | "poor" | "average" | "good" | "very good";

/**
 * 80% timeliness (answered-within-standard rate) + 20% efficiency (answered /
 * received-while-on-duty rate), both 0–100. Either side may be null (no
 * basis); both null -> no score.
 */
export function computeChatScore(
  timelinessPct: number | null,
  efficiencyPct: number | null,
): number | null {
  if (timelinessPct == null && efficiencyPct == null) return null;
  if (efficiencyPct == null) return timelinessPct;
  if (timelinessPct == null) return efficiencyPct;
  return Math.round((0.8 * timelinessPct + 0.2 * efficiencyPct) * 10) / 10;
}

export function chatRatingLabel(score: number): ChatRating {
  if (score < 20) return "very poor";
  if (score < 40) return "poor";
  if (score < 60) return "average";
  if (score < 80) return "good";
  return "very good";
}
