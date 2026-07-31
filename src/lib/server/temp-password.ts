import { randomInt } from "node:crypto";

/**
 * Alphabet for admin-issued temporary passwords.
 *
 * Deliberately excludes visually ambiguous characters — 0/O, 1/l/I, 5/S, 8/B —
 * because these get read aloud over the phone or copied off a screen by hand.
 * A temp password that cannot be transcribed reliably just becomes a support
 * call.
 */
const ALPHABET =
  // no B, I, L, O, S
  "ACDEFGHJKMNPQRTUVWXYZ" +
  // no b, i, l, o, s — the lowercase forms are just as confusable as the
  // uppercase ones (b/6, i/1, l/1, o/0, s/5)
  "acdefghjkmnpqrtuvwxyz" +
  // no 0, 1, 5, 8
  "234679";

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
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
