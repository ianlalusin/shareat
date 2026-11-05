import { randomInt } from "node:crypto";

/**
 * Alphabet for admin-issued temporary passwords.
 *
 * Deliberately excludes visually ambiguous characters — 0/O, 1/l/I, 5/S, 8/B —
 * because these get read aloud over the phone or copied off a screen by hand.
 * A temp password that cannot be transcribed reliably just becomes a support
 * call.
 */
// no B, I, L, O, S
const UPPER = "ACDEFGHJKMNPQRTUVWXYZ";
// no b, i, l, o, s — the lowercase forms are just as confusable as the
// uppercase ones (b/6, i/1, l/1, o/0, s/5)
const LOWER = "acdefghjkmnpqrtuvwxyz";
// no 0, 1, 5, 8
const DIGITS = "234679";
// The project's Firebase password policy requires a non-alphanumeric
// character; these are easy to say aloud and never confused with letters.
const SYMBOLS = "#$%&*+=?@";
const ALPHABET = UPPER + LOWER + DIGITS;

/** Firebase Auth requires >= 6; 14 keeps the entropy well clear of guessing. */
const LENGTH = 14;

/**
 * Generates a temporary password using a CSPRNG.
 *
 * `randomInt` is rejection-sampled by Node, so there is no modulo bias toward
 * the front of the alphabet — which a naive `randomBytes[i] % len` would
 * introduce.
 *
 * Never log the return value.
 */
export function generateTempPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  // One of each class so any password policy (upper/lower/number/symbol) passes.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < LENGTH) chars.push(pick(ALPHABET));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
