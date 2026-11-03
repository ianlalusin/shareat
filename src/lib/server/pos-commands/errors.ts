/**
 * Typed failure for financial commands. `code` is stable (clients and the
 * offline reconciler branch on it); `status` is the HTTP status the route
 * returns. 409 codes are business conflicts (bill changed, already settled),
 * which the offline reconciler records as a rejection instead of retrying.
 */
export class PosCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "PosCommandError";
  }
}

/** Codes that mean "this command can never succeed as recorded". */
export const TERMINAL_CONFLICT_CODES = new Set([
  "already_settled",
  "session_voided",
  "session_changed",
  "bill_changed",
  "total_mismatch",
  "tender_invalid",
  "gateway_invalid",
  "gateway_consumed",
  "session_not_found",
  "operator_session_invalid",
  "operator_session_required",
  "command_invalid",
  "line_price_invalid",
]);

export function isTerminalConflict(e: unknown): boolean {
  return e instanceof PosCommandError && TERMINAL_CONFLICT_CODES.has(e.code);
}
