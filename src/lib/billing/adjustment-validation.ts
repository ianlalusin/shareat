/**
 * Shared validation for discount / charge values (audit F09).
 *
 * Every editor that lets staff type a discount or charge (line editor, bill
 * discount popover, custom bill charge) validates through these helpers so the
 * same rules apply everywhere:
 *   - the value must be a finite number with at most 2 decimals
 *   - percent values must be within (0, 100]
 *   - fixed discounts must be > 0 and no larger than the amount they apply to
 *   - charges must be > 0 (a negative "charge" is a hidden discount)
 *
 * `sanitizeAdjustmentValue` is the defensive twin used by calculateBillTotals
 * so a bad value already stored in Firestore can never produce a negative or
 * >100% discount in the totals.
 */

export type AdjustmentValueType = "fixed" | "percent";

const MAX_DECIMALS = 2;

function hasTooManyDecimals(value: number): boolean {
  const scaled = value * 10 ** MAX_DECIMALS;
  return Math.abs(scaled - Math.round(scaled)) > 1e-6;
}

function peso(n: number): string {
  return `₱${n.toFixed(2)}`;
}

/**
 * Returns an error message, or null when the discount value is valid.
 * `eligibleAmount` is the amount the fixed discount applies to (per-unit price
 * for a line discount, remaining bill for a bill discount). When omitted or not
 * a finite number, the fixed-amount cap is skipped.
 */
export function validateDiscountValue(
  type: AdjustmentValueType | null | undefined,
  value: unknown,
  eligibleAmount?: number | null,
): string | null {
  if (type !== "fixed" && type !== "percent") return "Choose ₱ or %.";
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return "Enter a valid number.";
  if (n <= 0) return "Discount must be greater than 0.";
  if (hasTooManyDecimals(n)) return "Use at most 2 decimal places.";
  if (type === "percent") {
    if (n > 100) return "Percent discount cannot be more than 100%.";
    return null;
  }
  if (typeof eligibleAmount === "number" && Number.isFinite(eligibleAmount) && n > eligibleAmount + 1e-9) {
    return `Discount cannot be more than ${peso(Math.max(0, eligibleAmount))}.`;
  }
  return null;
}

/** Returns an error message, or null when the charge value is valid. */
export function validateChargeValue(
  type: AdjustmentValueType | null | undefined,
  value: unknown,
): string | null {
  if (type !== "fixed" && type !== "percent") return "Choose ₱ or %.";
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return "Enter a valid number.";
  if (n <= 0) return "Charge must be greater than 0.";
  if (hasTooManyDecimals(n)) return "Use at most 2 decimal places.";
  if (type === "percent" && n > 100) return "Percent charge cannot be more than 100%.";
  return null;
}

/**
 * Clamp a stored adjustment value into its legal range for totals math:
 * non-finite or negative → 0, percent capped at 100. Fixed amounts are capped
 * by the caller (it knows the base).
 */
export function sanitizeAdjustmentValue(type: unknown, value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (type === "percent" || type === "percentage") return Math.min(100, n);
  return n;
}
