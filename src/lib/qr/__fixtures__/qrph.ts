/**
 * EMVCo / QR Ph payload fixtures.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE ARE SYNTHETIC. They are structurally valid QR Ph payloads with real,
 * computed CRCs, which is enough to test the parser — but they were built by
 * this repo, not captured from a bank.
 *
 * BEFORE SHIPPING: photograph the store's own GCash, Maya and one bank QR,
 * decode them with `decodeQrFromImage`, and paste the exact strings into
 * REAL_FIXTURES below. Do NOT hand-write them — the whole point is to prove we
 * parse what issuers actually emit, including their quirks (duplicate tag 58,
 * unusual tag ordering, vendor-specific sub-tags).
 *
 * A cautionary note on borrowed vectors: the EMVCo specification sample that
 * circulates online with CRC "A13A" does NOT verify — it computes to 822D over
 * UTF-8 bytes and EA0E over latin-1. Every vector in this file is generated and
 * checked in-repo for that reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type QrFixture = {
  name: string;
  payload: string;
  merchantName: string;
  provider: string;
};

/** Static GCash-style P2M QR — the canonical reusable wallet QR. */
export const GCASH_STATIC =
  "00020101021126440011ph.ppmi.p2m011091712345670311GXCHPHM2XXX5204000053036085802PH5914JUAN DELA CRUZ6011MANILA CITY630462A7";

/** Maya-style QR that carries a fixed amount (tag 54) — must warn `has_amount`. */
export const MAYA_WITH_AMOUNT =
  "00020101021127290011ph.ppmi.p2p011099812345675204581253036085406250.005802PH5913MAYA MERCHANT6009LIPA CITY630422F8";

/** Dynamic, one-time QR (tag 01 = "12") — must warn `dynamic_initiation`. */
export const DYNAMIC_ONE_TIME =
  "00020101021226440011ph.ppmi.p2m011091712345670311GXCHPHM2XXX53036085802PH5908ONE TIME6004CEBU62120508TXN1234563048BC3";

/** Static fixtures that must parse cleanly as reusable wallet QRs. */
export const STATIC_FIXTURES: QrFixture[] = [
  {
    name: "gcash-static-p2m",
    payload: GCASH_STATIC,
    merchantName: "JUAN DELA CRUZ",
    provider: "gcash",
  },
];

/** Every fixture, for round-trip and robustness sweeps. */
export const ALL_FIXTURES: string[] = [GCASH_STATIC, MAYA_WITH_AMOUNT, DYNAMIC_ONE_TIME];

/**
 * Real payloads captured from live QRs. EMPTY UNTIL CAPTURED — see the header.
 * The test suite skips its real-fixture block while this is empty and will
 * start exercising it automatically once entries are added.
 */
export const REAL_FIXTURES: QrFixture[] = [];
