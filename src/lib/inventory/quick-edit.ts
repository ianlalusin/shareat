import { roundMoney } from "@/lib/money";

/**
 * Decision logic for the inline price cells on the manager inventory table.
 *
 * Kept out of the React component on purpose: two of the three fields these
 * cells edit (`sellingPrice`, `onlinePrice`) decide what a customer is
 * charged, and this repo's vitest runs in a node environment where the
 * component itself cannot be rendered. Everything worth getting right is
 * therefore a pure function.
 */

export type PriceDraft =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Turns what the manager typed into the value to store.
 *
 * `allowEmpty` distinguishes the optional online price — where blank means
 * "no override", stored as null — from cost / selling price, where blank is
 * not an instruction and the edit is rejected.
 */
export function parsePriceDraft(raw: string, opts: { allowEmpty: boolean }): PriceDraft {
  const text = String(raw ?? "").trim();

  if (text === "") {
    return opts.allowEmpty
      ? { ok: true, value: null }
      : { ok: false, error: "Enter a price." };
  }

  // Number(), never parseFloat(): parseFloat("249abc") yields 249, which would
  // silently store a price the manager never typed. A price cell may not guess.
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "Not a number." };
  if (n < 0) return { ok: false, error: "Cannot be negative." };

  return { ok: true, value: roundMoney(n) };
}

/** The string an idle cell displays. An unset optional price is blank, not 0. */
export function formatPriceDraft(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

/**
 * Whether committing `next` is a real change.
 *
 * Guards two things at once: a pointless Firestore write, and — for the two
 * storefront-facing prices — a pointless catalog republish every time a
 * manager tabs through a row without editing it.
 */
export function priceDraftChanged(current: number | null | undefined, next: number | null): boolean {
  const before = current == null ? null : roundMoney(current);
  return before !== next;
}
