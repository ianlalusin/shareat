# PayMongo QR Ph — POS Cashier Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "PayMongo QR" tender to the POS cashier checkout that generates a dynamic per-bill QR Ph code, confirms payment via a PayMongo webhook, and finalizes the sale through the existing checkout path.

**Architecture:** Pure logic (money, request builders, response parsing, signature verification) lives in `src/lib/payments/paymongo/qrph.ts` with co-located Vitest tests. A thin server module orchestrates the three PayMongo API calls. Two App Hosting route handlers (`create-qr`, `webhook`) plus a fallback `status` route bridge PayMongo to a Firestore doc under the session. The cashier UI watches that doc via the app's existing Firestore listeners and, on `paid`, feeds a normal `Payment` into the unchanged `completePaymentFromUnits` flow. Offline hides the method entirely.

**Tech Stack:** Next.js 16 (App Router route handlers), React 18, TypeScript, Firestore (client + `firebase-admin`), Vitest, `qrcode.react`, Node `crypto`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-paymongo-qr-pos-design.md`

## Global Constraints

- **No new dependencies.** Use installed `firebase`, `firebase-admin`, `qrcode`, `qrcode.react`, `zod`, and Node built-in `crypto`. Call `https://api.paymongo.com` via native `fetch` (no SDK).
- **Session closes only on confirmation.** Never close a session or write a `Payment` for PayMongo until the bridge doc reaches `status: 'paid'`.
- **Online-only.** The PayMongo tender is hidden/disabled whenever the device is offline.
- **Secrets are server-only.** `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET_POS` never appear in client code or the APK bundle.
- **Test runner:** `npx vitest run <path>`. Tests are co-located as `<name>.test.ts` next to source and import via the `@/` alias (= `src/`).
- **House style:** pure functions take their dependencies as parameters (see `src/lib/offline/offlineReceiptNumber.test.ts`'s injected `KVStore`). Keep pure modules free of `Date.now()`/network — pass `nowMs` in.
- **Money:** peso amounts are floats in the UI; PayMongo amounts are integer centavos. Convert with the shared helper, never inline.
- **Amounts sent to PayMongo must be ≥ the QR Ph minimum** (`MIN_QRPH_AMOUNT_CENTAVOS`, default `2000` = ₱20.00 — verify against PayMongo before go-live and update the constant).

---

### Task 1: Pure core — money conversion + amount validation

**Files:**
- Create: `src/lib/payments/paymongo/qrph.ts`
- Test: `src/lib/payments/paymongo/qrph.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MIN_QRPH_AMOUNT_CENTAVOS: number` (= `2000`)
  - `pesosToCentavos(pesos: number): number`
  - `assertPayableAmount(centavos: number): void` — throws `Error` if not a positive integer ≥ minimum.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  pesosToCentavos,
  assertPayableAmount,
  MIN_QRPH_AMOUNT_CENTAVOS,
} from "@/lib/payments/paymongo/qrph";

describe("pesosToCentavos", () => {
  it("converts whole and fractional pesos to integer centavos", () => {
    expect(pesosToCentavos(850)).toBe(85000);
    expect(pesosToCentavos(20)).toBe(2000);
    expect(pesosToCentavos(199.99)).toBe(19999);
  });

  it("rounds float artifacts to the nearest centavo", () => {
    expect(pesosToCentavos(0.1 + 0.2)).toBe(30); // 0.30000000000000004
  });
});

describe("assertPayableAmount", () => {
  it("accepts amounts at or above the minimum", () => {
    expect(() => assertPayableAmount(MIN_QRPH_AMOUNT_CENTAVOS)).not.toThrow();
    expect(() => assertPayableAmount(85000)).not.toThrow();
  });

  it("rejects amounts below the minimum, zero, negatives, and non-integers", () => {
    expect(() => assertPayableAmount(MIN_QRPH_AMOUNT_CENTAVOS - 1)).toThrow();
    expect(() => assertPayableAmount(0)).toThrow();
    expect(() => assertPayableAmount(-100)).toThrow();
    expect(() => assertPayableAmount(1000.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: FAIL — cannot resolve `@/lib/payments/paymongo/qrph`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/payments/paymongo/qrph.ts

/** PayMongo QR Ph minimum chargeable amount, in centavos. Verify before go-live. */
export const MIN_QRPH_AMOUNT_CENTAVOS = 2000;

/** Convert a peso float to integer centavos, rounding away float artifacts. */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

/** Throw if the centavo amount is not a positive integer at or above the minimum. */
export function assertPayableAmount(centavos: number): void {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Amount must be whole centavos, got ${centavos}`);
  }
  if (centavos < MIN_QRPH_AMOUNT_CENTAVOS) {
    throw new Error(
      `Amount ${centavos} is below the QR Ph minimum of ${MIN_QRPH_AMOUNT_CENTAVOS} centavos`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/qrph.ts src/lib/payments/paymongo/qrph.test.ts
git commit -m "feat(paymongo): money conversion + amount validation for QR Ph"
```

---

### Task 2: Pure core — PayMongo request builders

**Files:**
- Modify: `src/lib/payments/paymongo/qrph.ts`
- Test: `src/lib/payments/paymongo/qrph.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type QrhpMetadata = { storeId: string; sessionId: string; intentDocId: string; kind: "pos_session" }`
  - `buildPaymentIntentBody(input: { amountCentavos: number; description: string; metadata: QrhpMetadata }): object`
  - `buildPaymentMethodBody(input: { name: string; email?: string; phone?: string }): object`
  - `buildAttachBody(paymentMethodId: string): object`

- [ ] **Step 1: Write the failing test**

```ts
import {
  buildPaymentIntentBody,
  buildPaymentMethodBody,
  buildAttachBody,
} from "@/lib/payments/paymongo/qrph";

describe("buildPaymentIntentBody", () => {
  it("wraps attributes with qrph allowed, PHP, automatic capture, and metadata", () => {
    const body = buildPaymentIntentBody({
      amountCentavos: 85000,
      description: "SHT session sess_1",
      metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "pi_doc_1", kind: "pos_session" },
    });
    expect(body).toEqual({
      data: {
        attributes: {
          amount: 85000,
          currency: "PHP",
          capture_type: "automatic",
          payment_method_allowed: ["qrph"],
          description: "SHT session sess_1",
          metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "pi_doc_1", kind: "pos_session" },
        },
      },
    });
  });
});

describe("buildPaymentMethodBody", () => {
  it("builds a qrph payment method with billing", () => {
    expect(buildPaymentMethodBody({ name: "Shareat SHT", email: "pos@shareat.net" })).toEqual({
      data: { attributes: { type: "qrph", billing: { name: "Shareat SHT", email: "pos@shareat.net" } } },
    });
  });

  it("omits undefined billing fields", () => {
    const body = buildPaymentMethodBody({ name: "Shareat SHT" }) as any;
    expect(body.data.attributes.billing).toEqual({ name: "Shareat SHT" });
  });
});

describe("buildAttachBody", () => {
  it("wraps the payment method id", () => {
    expect(buildAttachBody("pm_123")).toEqual({
      data: { attributes: { payment_method: "pm_123" } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Write minimal implementation** (append to `qrph.ts`)

```ts
export type QrhpMetadata = {
  storeId: string;
  sessionId: string;
  intentDocId: string;
  kind: "pos_session";
};

export function buildPaymentIntentBody(input: {
  amountCentavos: number;
  description: string;
  metadata: QrhpMetadata;
}): object {
  return {
    data: {
      attributes: {
        amount: input.amountCentavos,
        currency: "PHP",
        capture_type: "automatic",
        payment_method_allowed: ["qrph"],
        description: input.description,
        metadata: input.metadata,
      },
    },
  };
}

export function buildPaymentMethodBody(input: {
  name: string;
  email?: string;
  phone?: string;
}): object {
  const billing: Record<string, string> = { name: input.name };
  if (input.email) billing.email = input.email;
  if (input.phone) billing.phone = input.phone;
  return { data: { attributes: { type: "qrph", billing } } };
}

export function buildAttachBody(paymentMethodId: string): object {
  return { data: { attributes: { payment_method: paymentMethodId } } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/qrph.ts src/lib/payments/paymongo/qrph.test.ts
git commit -m "feat(paymongo): request-body builders for intent/method/attach"
```

---

### Task 3: Pure core — attach-response parser

**Files:**
- Modify: `src/lib/payments/paymongo/qrph.ts`
- Test: `src/lib/payments/paymongo/qrph.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type ParsedQr = { paymongoIntentId: string; qrData: string | null; imageUrl: string | null; expiresAtFromApiMs: number | null }`
  - `parseAttachResponse(json: unknown): ParsedQr` — throws if the QR next_action is missing.

- [ ] **Step 1: Write the failing test**

```ts
import { parseAttachResponse } from "@/lib/payments/paymongo/qrph";

const attachOk = {
  data: {
    id: "pi_abc",
    attributes: {
      status: "awaiting_next_action",
      next_action: {
        type: "present_qr_code",
        code: {
          type: "qrph",
          data: "00020101021226...6304ABCD",
          image_url: "https://paymongo.example/qr/pi_abc.png",
          expires_at: 1751690400, // unix seconds
        },
      },
    },
  },
};

describe("parseAttachResponse", () => {
  it("extracts intent id, qr data, image url, and expiry (ms)", () => {
    expect(parseAttachResponse(attachOk)).toEqual({
      paymongoIntentId: "pi_abc",
      qrData: "00020101021226...6304ABCD",
      imageUrl: "https://paymongo.example/qr/pi_abc.png",
      expiresAtFromApiMs: 1751690400000,
    });
  });

  it("returns null expiry when PayMongo omits expires_at", () => {
    const noExp = structuredClone(attachOk);
    delete (noExp.data.attributes.next_action.code as any).expires_at;
    expect(parseAttachResponse(noExp).expiresAtFromApiMs).toBeNull();
  });

  it("throws when there is no QR next_action", () => {
    expect(() => parseAttachResponse({ data: { id: "pi_x", attributes: { status: "awaiting_payment_method" } } })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: FAIL — `parseAttachResponse` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `qrph.ts`)

```ts
export type ParsedQr = {
  paymongoIntentId: string;
  qrData: string | null;
  imageUrl: string | null;
  expiresAtFromApiMs: number | null;
};

export function parseAttachResponse(json: unknown): ParsedQr {
  const data = (json as any)?.data;
  const attrs = data?.attributes;
  const code = attrs?.next_action?.code;
  if (!data?.id || !code || (!code.data && !code.image_url)) {
    throw new Error("PayMongo attach response has no QR code next_action");
  }
  const expSec = typeof code.expires_at === "number" ? code.expires_at : null;
  return {
    paymongoIntentId: String(data.id),
    qrData: code.data ?? null,
    imageUrl: code.image_url ?? null,
    expiresAtFromApiMs: expSec == null ? null : expSec * 1000,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/qrph.ts src/lib/payments/paymongo/qrph.test.ts
git commit -m "feat(paymongo): parse attach response into QR fields"
```

---

### Task 4: Pure core — webhook signature verification + event parsing

**Files:**
- Modify: `src/lib/payments/paymongo/qrph.ts`
- Test: `src/lib/payments/paymongo/qrph.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean` — parses `t=<ts>,te=<hex>,li=<hex>`; compares `HMAC-SHA256(secret, "<ts>.<rawBody>")` against `te` or `li` with `timingSafeEqual`.
  - `type WebhookEvent = { eventId: string; type: string; paymentId: string | null; paymentIntentId: string | null; status: string | null; metadata: Partial<QrhpMetadata> }`
  - `parseWebhookEvent(json: unknown): WebhookEvent`

- [ ] **Step 1: Write the failing test**

```ts
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, parseWebhookEvent } from "@/lib/payments/paymongo/qrph";

const SECRET = "whsk_test_secret";
const RAW = JSON.stringify({ hello: "world" });
function sign(ts: string, body: string, field: "te" | "li") {
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},${field}=${sig}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid test-mode (te) signature", () => {
    expect(verifyWebhookSignature(RAW, sign("1751690400", RAW, "te"), SECRET)).toBe(true);
  });
  it("accepts a valid live-mode (li) signature", () => {
    expect(verifyWebhookSignature(RAW, sign("1751690400", RAW, "li"), SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(RAW + "x", sign("1751690400", RAW, "li"), SECRET)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(RAW, sign("1751690400", RAW, "li"), "other")).toBe(false);
  });
  it("rejects a malformed header", () => {
    expect(verifyWebhookSignature(RAW, "garbage", SECRET)).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("pulls event id, type, payment id, intent id, status, and metadata", () => {
    const evt = {
      data: {
        id: "evt_1",
        attributes: {
          type: "payment.paid",
          data: {
            id: "pay_1",
            attributes: {
              status: "paid",
              payment_intent_id: "pi_abc",
              metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
            },
          },
        },
      },
    };
    expect(parseWebhookEvent(evt)).toEqual({
      eventId: "evt_1",
      type: "payment.paid",
      paymentId: "pay_1",
      paymentIntentId: "pi_abc",
      status: "paid",
      metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Write minimal implementation** (append to `qrph.ts`)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function parseSignatureHeader(header: string): { t: string; te?: string; li?: string } | null {
  const parts = header.split(",").map((p) => p.trim());
  const out: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0) out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  if (!out.t || (!out.te && !out.li)) return null;
  return { t: out.t, te: out.te, li: out.li };
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const expected = createHmac("sha256", secret).update(`${parsed.t}.${rawBody}`).digest("hex");
  return (
    (parsed.te ? safeEqualHex(parsed.te, expected) : false) ||
    (parsed.li ? safeEqualHex(parsed.li, expected) : false)
  );
}

export type WebhookEvent = {
  eventId: string;
  type: string;
  paymentId: string | null;
  paymentIntentId: string | null;
  status: string | null;
  metadata: Partial<QrhpMetadata>;
};

export function parseWebhookEvent(json: unknown): WebhookEvent {
  const ev = (json as any)?.data;
  const evAttrs = ev?.attributes ?? {};
  const resource = evAttrs?.data ?? {};
  const rAttrs = resource?.attributes ?? {};
  return {
    eventId: String(ev?.id ?? ""),
    type: String(evAttrs?.type ?? ""),
    paymentId: resource?.id ? String(resource.id) : null,
    paymentIntentId: rAttrs?.payment_intent_id ? String(rAttrs.payment_intent_id) : null,
    status: rAttrs?.status ? String(rAttrs.status) : null,
    metadata: (rAttrs?.metadata ?? {}) as Partial<QrhpMetadata>,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/paymongo/qrph.test.ts`
Expected: PASS (all Task 1–4 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/qrph.ts src/lib/payments/paymongo/qrph.test.ts
git commit -m "feat(paymongo): webhook signature verification + event parsing"
```

---

### Task 5: Types + gating helper (offline/online + gateway MOP)

**Files:**
- Modify: `src/lib/types.ts` (add `gateway?` to `ModeOfPayment` near ~L614; add `PosPaymentIntentDoc`)
- Create: `src/lib/payments/paymongo/gateway.ts`
- Test: `src/lib/payments/paymongo/gateway.test.ts`

**Interfaces:**
- Consumes: `ModeOfPayment` from `@/lib/types`.
- Produces:
  - `ModeOfPayment.gateway?: 'paymongo_qrph' | null`
  - `PosPaymentIntentDoc` type (fields per spec §5.3)
  - `isPaymongoQrMethod(mop: Pick<ModeOfPayment, 'gateway'>): boolean`
  - `shouldOfferPaymongoQr(mop: Pick<ModeOfPayment,'gateway'|'isActive'>, isOnline: boolean): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isPaymongoQrMethod, shouldOfferPaymongoQr } from "@/lib/payments/paymongo/gateway";

describe("isPaymongoQrMethod", () => {
  it("is true only for the paymongo_qrph gateway", () => {
    expect(isPaymongoQrMethod({ gateway: "paymongo_qrph" })).toBe(true);
    expect(isPaymongoQrMethod({ gateway: null })).toBe(false);
    expect(isPaymongoQrMethod({ gateway: undefined })).toBe(false);
  });
});

describe("shouldOfferPaymongoQr", () => {
  it("offers only when active AND online", () => {
    const mop = { gateway: "paymongo_qrph" as const, isActive: true };
    expect(shouldOfferPaymongoQr(mop, true)).toBe(true);
    expect(shouldOfferPaymongoQr(mop, false)).toBe(false);
    expect(shouldOfferPaymongoQr({ gateway: "paymongo_qrph", isActive: false }, true)).toBe(false);
  });

  it("never gates a non-gateway method (returns true so normal rules apply)", () => {
    expect(shouldOfferPaymongoQr({ gateway: null, isActive: true }, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/gateway.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/types.ts` inside the `ModeOfPayment` type:

```ts
  /** Marks this mode of payment as an auto-confirming gateway tender. */
  gateway?: 'paymongo_qrph' | null;
```

Add to `src/lib/types.ts` (near other session/payment types):

```ts
export type PosPaymentIntentDoc = {
  id: string;
  storeId: string;
  sessionId: string;
  provider: 'paymongo_qrph';
  amount: number;
  amountCentavos: number;
  paymongoIntentId: string;
  paymongoPaymentId: string | null;
  qrData: string | null;
  imageUrl: string | null;
  status: 'awaiting_payment' | 'paid' | 'failed' | 'expired' | 'canceled';
  createdAtMs: number;
  expiresAtMs: number;
  processedEventIds: string[];
  methodId: string;
  createdByLocalUserId: string | null;
  createdByUid: string;
};
```

Create `src/lib/payments/paymongo/gateway.ts`:

```ts
export function isPaymongoQrMethod(mop: { gateway?: 'paymongo_qrph' | null }): boolean {
  return mop.gateway === "paymongo_qrph";
}

export function shouldOfferPaymongoQr(
  mop: { gateway?: 'paymongo_qrph' | null; isActive: boolean },
  isOnline: boolean,
): boolean {
  if (!isPaymongoQrMethod(mop)) return true; // non-gateway → normal rules apply upstream
  return mop.isActive && isOnline;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/lib/payments/paymongo/gateway.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/payments/paymongo/gateway.ts src/lib/payments/paymongo/gateway.test.ts
git commit -m "feat(paymongo): gateway MOP type + online/active gating helper"
```

---

### Task 6: Server orchestration — create QR via PayMongo API

**Files:**
- Create: `src/lib/payments/paymongo/qrph.server.ts`
- Test: `src/lib/payments/paymongo/qrph.server.test.ts`

**Interfaces:**
- Consumes: builders + `parseAttachResponse` from Task 2–3.
- Produces:
  - `type PostJson = (path: string, body: object) => Promise<unknown>`
  - `createQrPaymentViaApi(deps: { postJson: PostJson }, input: { amountCentavos: number; description: string; metadata: QrhpMetadata; billing: { name: string; email?: string } }): Promise<ParsedQr>` — calls `/v1/payment_intents` → `/v1/payment_methods` → `/v1/payment_intents/:id/attach` in order.
  - `defaultPostJson(path, body)` — real `fetch` with `Authorization: Basic base64(PAYMONGO_SECRET_KEY + ":")`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createQrPaymentViaApi } from "@/lib/payments/paymongo/qrph.server";

describe("createQrPaymentViaApi", () => {
  it("creates intent, then method, then attaches, and returns parsed QR", async () => {
    const calls: string[] = [];
    const postJson = vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/v1/payment_intents") return { data: { id: "pi_1", attributes: {} } };
      if (path === "/v1/payment_methods") return { data: { id: "pm_1", attributes: {} } };
      if (path === "/v1/payment_intents/pi_1/attach") {
        return {
          data: {
            id: "pi_1",
            attributes: {
              next_action: { code: { data: "00020101...", image_url: "https://x/y.png", expires_at: 1751690400 } },
            },
          },
        };
      }
      throw new Error("unexpected path " + path);
    });

    const parsed = await createQrPaymentViaApi(
      { postJson },
      {
        amountCentavos: 85000,
        description: "SHT sess_1",
        metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
        billing: { name: "Shareat SHT" },
      },
    );

    expect(calls).toEqual([
      "/v1/payment_intents",
      "/v1/payment_methods",
      "/v1/payment_intents/pi_1/attach",
    ]);
    expect(parsed.paymongoIntentId).toBe("pi_1");
    expect(parsed.qrData).toBe("00020101...");
    expect(parsed.expiresAtFromApiMs).toBe(1751690400000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/qrph.server.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/payments/paymongo/qrph.server.ts
import "server-only";
import {
  buildPaymentIntentBody,
  buildPaymentMethodBody,
  buildAttachBody,
  parseAttachResponse,
  type ParsedQr,
  type QrhpMetadata,
} from "@/lib/payments/paymongo/qrph";

export type PostJson = (path: string, body: object) => Promise<unknown>;

const PAYMONGO_BASE = "https://api.paymongo.com";

export const defaultPostJson: PostJson = async (path, body) => {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${PAYMONGO_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PayMongo ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
};

export async function createQrPaymentViaApi(
  deps: { postJson: PostJson },
  input: {
    amountCentavos: number;
    description: string;
    metadata: QrhpMetadata;
    billing: { name: string; email?: string };
  },
): Promise<ParsedQr> {
  const intent = (await deps.postJson(
    "/v1/payment_intents",
    buildPaymentIntentBody({
      amountCentavos: input.amountCentavos,
      description: input.description,
      metadata: input.metadata,
    }),
  )) as any;
  const intentId = intent?.data?.id as string;
  if (!intentId) throw new Error("PayMongo did not return a payment intent id");

  const method = (await deps.postJson(
    "/v1/payment_methods",
    buildPaymentMethodBody(input.billing),
  )) as any;
  const methodId = method?.data?.id as string;
  if (!methodId) throw new Error("PayMongo did not return a payment method id");

  const attached = await deps.postJson(
    `/v1/payment_intents/${intentId}/attach`,
    buildAttachBody(methodId),
  );
  return parseAttachResponse(attached);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/paymongo/qrph.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/qrph.server.ts src/lib/payments/paymongo/qrph.server.test.ts
git commit -m "feat(paymongo): server orchestration for intent/method/attach"
```

---

### Task 7: `create-qr` route handler

**Files:**
- Create: `src/app/api/pos/paymongo/create-qr/route.ts`
- Create: `src/lib/payments/paymongo/bridge.server.ts` (Firestore Admin writes for the bridge doc)
- Test: `src/lib/payments/paymongo/bridge.server.test.ts` (pure builder for the doc)

**Interfaces:**
- Consumes: `createQrPaymentViaApi`, `defaultPostJson`, `pesosToCentavos`, `assertPayableAmount`, `PosPaymentIntentDoc`.
- Produces:
  - `buildInitialIntentDoc(input): PosPaymentIntentDoc` (pure, in `bridge.server.ts` but framework-free — testable)
  - Route `POST /api/pos/paymongo/create-qr` returning `{ intentDocId, qrData, imageUrl, expiresAtMs, paymongoIntentId }`.

- [ ] **Step 1: Write the failing test** (pure doc builder)

```ts
import { describe, it, expect } from "vitest";
import { buildInitialIntentDoc, TEN_MINUTES_MS } from "@/lib/payments/paymongo/bridge.server";

describe("buildInitialIntentDoc", () => {
  it("uses PayMongo expiry when present, else now + 10min", () => {
    const base = {
      intentDocId: "d1", storeId: "SHT", sessionId: "sess_1",
      amount: 850, amountCentavos: 85000, methodId: "mop_1",
      createdByUid: "uid_1", createdByLocalUserId: "lu_1",
      parsed: { paymongoIntentId: "pi_1", qrData: "00020...", imageUrl: null, expiresAtFromApiMs: null },
      nowMs: 1_000_000,
    };
    expect(buildInitialIntentDoc(base).expiresAtMs).toBe(1_000_000 + TEN_MINUTES_MS);
    expect(buildInitialIntentDoc({ ...base, parsed: { ...base.parsed, expiresAtFromApiMs: 2_000_000 } }).expiresAtMs).toBe(2_000_000);
  });

  it("initializes status=awaiting_payment with empty processedEventIds", () => {
    const doc = buildInitialIntentDoc({
      intentDocId: "d1", storeId: "SHT", sessionId: "sess_1",
      amount: 850, amountCentavos: 85000, methodId: "mop_1",
      createdByUid: "uid_1", createdByLocalUserId: null,
      parsed: { paymongoIntentId: "pi_1", qrData: "q", imageUrl: null, expiresAtFromApiMs: null },
      nowMs: 1,
    });
    expect(doc.status).toBe("awaiting_payment");
    expect(doc.processedEventIds).toEqual([]);
    expect(doc.paymongoPaymentId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/bridge.server.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/payments/paymongo/bridge.server.ts
import "server-only";
import type { ParsedQr } from "@/lib/payments/paymongo/qrph";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const TEN_MINUTES_MS = 10 * 60 * 1000;

export function buildInitialIntentDoc(input: {
  intentDocId: string;
  storeId: string;
  sessionId: string;
  amount: number;
  amountCentavos: number;
  methodId: string;
  createdByUid: string;
  createdByLocalUserId: string | null;
  parsed: ParsedQr;
  nowMs: number;
}): PosPaymentIntentDoc {
  return {
    id: input.intentDocId,
    storeId: input.storeId,
    sessionId: input.sessionId,
    provider: "paymongo_qrph",
    amount: input.amount,
    amountCentavos: input.amountCentavos,
    paymongoIntentId: input.parsed.paymongoIntentId,
    paymongoPaymentId: null,
    qrData: input.parsed.qrData,
    imageUrl: input.parsed.imageUrl,
    status: "awaiting_payment",
    createdAtMs: input.nowMs,
    expiresAtMs: input.parsed.expiresAtFromApiMs ?? input.nowMs + TEN_MINUTES_MS,
    processedEventIds: [],
    methodId: input.methodId,
    createdByLocalUserId: input.createdByLocalUserId,
    createdByUid: input.createdByUid,
  };
}
```

Then the route. Note: `import { adminDb, adminAuth }` — confirm the exact exports of `src/lib/firebase/admin.ts` and adjust names if needed.

```ts
// src/app/api/pos/paymongo/create-qr/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { pesosToCentavos, assertPayableAmount, type QrhpMetadata } from "@/lib/payments/paymongo/qrph";
import { createQrPaymentViaApi, defaultPostJson } from "@/lib/payments/paymongo/qrph.server";
import { buildInitialIntentDoc } from "@/lib/payments/paymongo/bridge.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  storeId: z.string().min(1),
  sessionId: z.string().min(1),
  amount: z.number().positive(),
  methodId: z.string().min(1),
  localUserId: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  // 1. Authenticate the Firebase user (device).
  const authz = req.headers.get("authorization") ?? "";
  const idToken = authz.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(idToken, true)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Validate input.
  const parsedBody = Body.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { storeId, sessionId, amount, methodId, localUserId } = parsedBody.data;

  // 3. Authorize against the live session (must exist, be active, and belong to storeId).
  const sessionRef = adminDb.doc(`stores/${storeId}/sessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists || sessionSnap.get("status") !== "active") {
    return NextResponse.json({ error: "Session not open" }, { status: 409 });
  }

  // 4. Validate amount against PayMongo minimum.
  const amountCentavos = pesosToCentavos(amount);
  try {
    assertPayableAmount(amountCentavos);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // 5. Pre-allocate the bridge doc id (so metadata can reference it).
  const intentsCol = adminDb.collection(`stores/${storeId}/sessions/${sessionId}/paymentIntents`);
  const intentRef = intentsCol.doc();
  const metadata: QrhpMetadata = { storeId, sessionId, intentDocId: intentRef.id, kind: "pos_session" };

  // 6. Create the QR at PayMongo.
  let parsed;
  try {
    parsed = await createQrPaymentViaApi(
      { postJson: defaultPostJson },
      { amountCentavos, description: `${storeId} session ${sessionId}`, metadata, billing: { name: `Shareat ${storeId}` } },
    );
  } catch (e) {
    return NextResponse.json({ error: "Could not start payment", detail: (e as Error).message }, { status: 502 });
  }

  // 7. Persist the bridge doc.
  const doc = buildInitialIntentDoc({
    intentDocId: intentRef.id, storeId, sessionId, amount, amountCentavos, methodId,
    createdByUid: uid, createdByLocalUserId: localUserId ?? null, parsed, nowMs: Date.now(),
  });
  await intentRef.set(doc);

  return NextResponse.json({
    intentDocId: intentRef.id,
    qrData: doc.qrData,
    imageUrl: doc.imageUrl,
    expiresAtMs: doc.expiresAtMs,
    paymongoIntentId: doc.paymongoIntentId,
  });
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/lib/payments/paymongo/bridge.server.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no new errors (fix `adminDb`/`adminAuth` import names to match `src/lib/firebase/admin.ts` if they differ).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/bridge.server.ts src/lib/payments/paymongo/bridge.server.test.ts src/app/api/pos/paymongo/create-qr/route.ts
git commit -m "feat(paymongo): create-qr route + bridge doc builder"
```

---

### Task 8: Webhook route handler

**Files:**
- Create: `src/app/api/webhooks/paymongo/route.ts`
- Modify: `src/lib/payments/paymongo/bridge.server.ts` (add `applyWebhookToIntentDoc` pure reducer)
- Test: `src/lib/payments/paymongo/bridge.server.test.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature`, `parseWebhookEvent`, `PosPaymentIntentDoc`.
- Produces:
  - `applyWebhookToIntentDoc(doc: PosPaymentIntentDoc, ev: WebhookEvent): { changed: boolean; next: PosPaymentIntentDoc }` — idempotent reducer: ignore if event already processed or doc terminal; map `payment.paid`→`paid`(+paymentId), `payment.failed`→`failed`; append event id.
  - Route `POST /api/webhooks/paymongo`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyWebhookToIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import type { PosPaymentIntentDoc } from "@/lib/types";
import type { WebhookEvent } from "@/lib/payments/paymongo/qrph";

function baseDoc(): PosPaymentIntentDoc {
  return {
    id: "d1", storeId: "SHT", sessionId: "sess_1", provider: "paymongo_qrph",
    amount: 850, amountCentavos: 85000, paymongoIntentId: "pi_1", paymongoPaymentId: null,
    qrData: "q", imageUrl: null, status: "awaiting_payment", createdAtMs: 1, expiresAtMs: 2,
    processedEventIds: [], methodId: "mop_1", createdByLocalUserId: null, createdByUid: "uid_1",
  };
}
const paidEvent: WebhookEvent = {
  eventId: "evt_1", type: "payment.paid", paymentId: "pay_1", paymentIntentId: "pi_1",
  status: "paid", metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
};

describe("applyWebhookToIntentDoc", () => {
  it("marks paid and records the payment id + event id", () => {
    const { changed, next } = applyWebhookToIntentDoc(baseDoc(), paidEvent);
    expect(changed).toBe(true);
    expect(next.status).toBe("paid");
    expect(next.paymongoPaymentId).toBe("pay_1");
    expect(next.processedEventIds).toEqual(["evt_1"]);
  });

  it("is idempotent for a repeated event id", () => {
    const once = applyWebhookToIntentDoc(baseDoc(), paidEvent).next;
    const twice = applyWebhookToIntentDoc(once, paidEvent);
    expect(twice.changed).toBe(false);
  });

  it("does not downgrade a paid doc on a later failed event", () => {
    const paid = applyWebhookToIntentDoc(baseDoc(), paidEvent).next;
    const failed: WebhookEvent = { ...paidEvent, eventId: "evt_2", type: "payment.failed", status: "failed" };
    const res = applyWebhookToIntentDoc(paid, failed);
    expect(res.next.status).toBe("paid");
    expect(res.changed).toBe(false);
  });

  it("maps a failed event on an awaiting doc to failed", () => {
    const failed: WebhookEvent = { ...paidEvent, eventId: "evt_3", type: "payment.failed", status: "failed" };
    expect(applyWebhookToIntentDoc(baseDoc(), failed).next.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/bridge.server.test.ts`
Expected: FAIL — `applyWebhookToIntentDoc` missing.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/payments/paymongo/bridge.server.ts`:

```ts
import type { WebhookEvent } from "@/lib/payments/paymongo/qrph";

export function applyWebhookToIntentDoc(
  doc: PosPaymentIntentDoc,
  ev: WebhookEvent,
): { changed: boolean; next: PosPaymentIntentDoc } {
  if (ev.eventId && doc.processedEventIds.includes(ev.eventId)) return { changed: false, next: doc };
  if (doc.status === "paid") return { changed: false, next: doc }; // terminal-positive: never downgrade
  const processedEventIds = ev.eventId ? [...doc.processedEventIds, ev.eventId] : doc.processedEventIds;
  if (ev.type === "payment.paid") {
    return { changed: true, next: { ...doc, status: "paid", paymongoPaymentId: ev.paymentId, processedEventIds } };
  }
  if (ev.type === "payment.failed") {
    return { changed: true, next: { ...doc, status: "failed", processedEventIds } };
  }
  return { changed: false, next: doc };
}
```

Create `src/app/api/webhooks/paymongo/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { verifyWebhookSignature, parseWebhookEvent } from "@/lib/payments/paymongo/qrph";
import { applyWebhookToIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text(); // raw body required for HMAC
  const sig = req.headers.get("paymongo-signature") ?? "";
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET_POS ?? "";
  if (!secret || !verifyWebhookSignature(raw, sig, secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let ev;
  try {
    ev = parseWebhookEvent(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 }); // unparseable → ack, ignore
  }

  // Only handle POS session events; storefront events go to the website webhook.
  const md = ev.metadata;
  if (md?.kind !== "pos_session" || !md.storeId || !md.sessionId || !md.intentDocId) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const ref = adminDb.doc(
    `stores/${md.storeId}/sessions/${md.sessionId}/paymentIntents/${md.intentDocId}`,
  );
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const { changed, next } = applyWebhookToIntentDoc(snap.data() as PosPaymentIntentDoc, ev);
    if (changed) tx.set(ref, next);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/paymongo/bridge.server.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/bridge.server.ts src/lib/payments/paymongo/bridge.server.test.ts src/app/api/webhooks/paymongo/route.ts
git commit -m "feat(paymongo): webhook route + idempotent intent-doc reducer"
```

---

### Task 9: Fallback `status` route (delayed-webhook safety net)

**Files:**
- Create: `src/app/api/pos/paymongo/status/route.ts`
- Modify: `src/lib/payments/paymongo/qrph.server.ts` (add `getPaymentIntentViaApi` + `mapIntentStatusToDocStatus`)
- Test: `src/lib/payments/paymongo/qrph.server.test.ts`

**Interfaces:**
- Consumes: `PostJson` deps pattern; `applyWebhookToIntentDoc` not used here.
- Produces:
  - `mapIntentStatusToDocStatus(paymongoStatus: string): PosPaymentIntentDoc['status'] | null` — `'succeeded'`→`'paid'`, `'awaiting_next_action'`/`'processing'`/`'awaiting_payment_method'`→`'awaiting_payment'`, else `null`.
  - `getPaymentIntentViaApi(deps: { getJson }, intentId): Promise<{ status: string; latestPaymentId: string | null }>`
  - Route `POST /api/pos/paymongo/status`.

- [ ] **Step 1: Write the failing test**

```ts
import { mapIntentStatusToDocStatus } from "@/lib/payments/paymongo/qrph.server";

describe("mapIntentStatusToDocStatus", () => {
  it("maps succeeded to paid", () => {
    expect(mapIntentStatusToDocStatus("succeeded")).toBe("paid");
  });
  it("maps in-flight statuses to awaiting_payment", () => {
    expect(mapIntentStatusToDocStatus("awaiting_next_action")).toBe("awaiting_payment");
    expect(mapIntentStatusToDocStatus("processing")).toBe("awaiting_payment");
  });
  it("returns null for unknown statuses", () => {
    expect(mapIntentStatusToDocStatus("weird")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/paymongo/qrph.server.test.ts`
Expected: FAIL — `mapIntentStatusToDocStatus` missing.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/payments/paymongo/qrph.server.ts`:

```ts
import type { PosPaymentIntentDoc } from "@/lib/types";

export type GetJson = (path: string) => Promise<unknown>;

export const defaultGetJson: GetJson = async (path) => {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${PAYMONGO_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayMongo GET ${path} failed (${res.status})`);
  return json;
};

export function mapIntentStatusToDocStatus(
  paymongoStatus: string,
): PosPaymentIntentDoc["status"] | null {
  switch (paymongoStatus) {
    case "succeeded":
      return "paid";
    case "awaiting_next_action":
    case "processing":
    case "awaiting_payment_method":
      return "awaiting_payment";
    default:
      return null;
  }
}

export async function getPaymentIntentViaApi(
  deps: { getJson: GetJson },
  intentId: string,
): Promise<{ status: string; latestPaymentId: string | null }> {
  const json = (await deps.getJson(`/v1/payment_intents/${intentId}`)) as any;
  const attrs = json?.data?.attributes ?? {};
  const payments = attrs?.payments ?? [];
  const latest = Array.isArray(payments) && payments.length ? payments[payments.length - 1] : null;
  return { status: String(attrs?.status ?? ""), latestPaymentId: latest?.id ?? null };
}
```

Create `src/app/api/pos/paymongo/status/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { getPaymentIntentViaApi, defaultGetJson, mapIntentStatusToDocStatus } from "@/lib/payments/paymongo/qrph.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ storeId: z.string(), sessionId: z.string(), intentDocId: z.string() });

export async function POST(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
  try { await adminAuth.verifyIdToken(idToken, true); }
  catch { return NextResponse.json({ error: "Invalid token" }, { status: 401 }); }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { storeId, sessionId, intentDocId } = parsed.data;

  const ref = adminDb.doc(`stores/${storeId}/sessions/${sessionId}/paymentIntents/${intentDocId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = snap.data() as PosPaymentIntentDoc;
  if (doc.status === "paid" || doc.status === "failed") return NextResponse.json({ status: doc.status });

  const remote = await getPaymentIntentViaApi({ getJson: defaultGetJson }, doc.paymongoIntentId);
  const mapped = mapIntentStatusToDocStatus(remote.status);
  if (mapped === "paid" && doc.status !== "paid") {
    await ref.set({ ...doc, status: "paid", paymongoPaymentId: remote.latestPaymentId ?? doc.paymongoPaymentId });
    return NextResponse.json({ status: "paid" });
  }
  return NextResponse.json({ status: doc.status });
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/lib/payments/paymongo/qrph.server.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymongo/qrph.server.ts src/lib/payments/paymongo/qrph.server.test.ts src/app/api/pos/paymongo/status/route.ts
git commit -m "feat(paymongo): fallback status poll route"
```

---

### Task 10: Firestore security rules for the bridge subcollection

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: nothing.
- Produces: read-allowed / client-write-denied rule for `sessions/{sessionId}/paymentIntents/{intentId}`.

- [ ] **Step 1: Locate the existing `sessions/{sessionId}` match block**

Open `firestore.rules` and find the `match /stores/{storeId}/sessions/{sessionId}` block (search `sessions/{`).

- [ ] **Step 2: Add the nested rule**

Inside that session match block (mirroring how existing session subcollections such as `sessionBillLines` / `payments` gate reads to the store's authenticated users), add:

```
      // PayMongo QR bridge docs: readable by the same users who can read the
      // session; writes come only from the Admin SDK (server), so deny client writes.
      match /paymentIntents/{intentId} {
        allow read: if request.auth != null;   // tighten to the same predicate the sibling `payments` subcollection uses
        allow write: if false;                  // Admin SDK bypasses rules; clients may never write
      }
```

Match the exact `read` predicate used by the sibling `payments` subcollection in this file so store-scoping is identical (replace `request.auth != null` with that predicate).

- [ ] **Step 3: Compile-check the rules**

Run: `npx firebase deploy --only firestore:rules --dry-run`
(If the CLI/`--dry-run` is unavailable, run `npx firebase firestore:rules:canary` is not needed — instead lint by deploying to a test project, or visually verify the block parses. At minimum ensure braces balance.)
Expected: rules compile without syntax errors.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat(paymongo): firestore rules for QR bridge docs (read-only to clients)"
```

---

### Task 11: Cashier QR view + PaymentModal wiring

**Files:**
- Create: `src/components/cashier/paymongo-qr-view.tsx`
- Modify: `src/components/cashier/payment-modal.tsx` (branch to the QR view when the selected MOP is the gateway; gate the option with `shouldOfferPaymongoQr`)

**Interfaces:**
- Consumes: `shouldOfferPaymongoQr`, `isPaymongoQrMethod`, the create-qr route, the app's online-status hook, the app's Firestore client (`db`), and the existing `completePaymentFromUnits` entry point used by `payment-modal.tsx`.
- Produces: a self-contained sub-view that, on `paid`, calls back with a completed `Payment` for the gateway tender.

- [ ] **Step 1: Write the QR view component**

Before writing, confirm three integration points in `payment-modal.tsx`:
1. the online-status source (search for `isOnline` / `useOnlineStatus` / `navigator.onLine`),
2. the Firebase client `db` import path (search `from "@/lib/firebase` in cashier components),
3. the signature of the function that records a tender + completes the sale online (`completePaymentFromUnits`).

```tsx
// src/components/cashier/paymongo-qr-view.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { db } from "@/lib/firebase/client"; // adjust to the app's client db export
import { auth } from "@/lib/firebase/client"; // adjust to the app's auth export
import type { PosPaymentIntentDoc } from "@/lib/types";

type Props = {
  storeId: string;
  sessionId: string;
  methodId: string;
  amount: number; // pesos, the QR portion of the bill
  localUserId: string | null;
  onPaid: (info: { amount: number; reference: string }) => void; // caller records Payment + completes
  onCancel: () => void;
};

type Phase = "creating" | "awaiting" | "paid" | "expired" | "failed" | "error";

export function PaymongoQrView({ storeId, sessionId, methodId, amount, localUserId, onPaid, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("creating");
  const [qrData, setQrData] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number>(0);
  const [remaining, setRemaining] = useState<number>(0);
  const intentDocIdRef = useRef<string | null>(null);
  const paidRef = useRef(false);

  // 1. Create the QR once on mount.
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/pos/paymongo/create-qr", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ storeId, sessionId, amount, methodId, localUserId }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (aborted) return;
        intentDocIdRef.current = data.intentDocId;
        setQrData(data.qrData);
        setExpiresAtMs(data.expiresAtMs);
        setPhase("awaiting");
      } catch {
        if (!aborted) setPhase("error");
      }
    })();
    return () => { aborted = true; };
  }, [storeId, sessionId, amount, methodId, localUserId]);

  // 2. Listen to the bridge doc for status changes.
  useEffect(() => {
    if (phase !== "awaiting" || !intentDocIdRef.current) return;
    const ref = doc(db, `stores/${storeId}/sessions/${sessionId}/paymentIntents/${intentDocIdRef.current}`);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data() as PosPaymentIntentDoc | undefined;
      if (!d || paidRef.current) return;
      if (d.status === "paid") {
        paidRef.current = true;
        setPhase("paid");
        onPaid({ amount, reference: d.paymongoPaymentId ?? d.paymongoIntentId });
      } else if (d.status === "failed") {
        setPhase("failed");
      }
    });
    return () => unsub();
  }, [phase, storeId, sessionId, amount, onPaid]);

  // 3. Countdown + auto-expire.
  useEffect(() => {
    if (phase !== "awaiting" || !expiresAtMs) return;
    const tick = () => {
      const left = expiresAtMs - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) setPhase("expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, expiresAtMs]);

  // 4. Manual "Check status" fallback.
  const checkStatus = async () => {
    if (!intentDocIdRef.current) return;
    const token = await auth.currentUser?.getIdToken();
    await fetch("/api/pos/paymongo/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storeId, sessionId, intentDocId: intentDocIdRef.current }),
    }).catch(() => {});
    // The snapshot listener will pick up the flip; no local state change needed.
  };

  const mmss = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      {phase === "creating" && <p>Generating QR…</p>}
      {phase === "awaiting" && qrData && (
        <>
          <p className="text-sm text-muted-foreground">Scan to pay ₱{amount.toFixed(2)}</p>
          <QRCodeSVG value={qrData} size={240} />
          <p className="text-sm">Expires in {mmss}</p>
          <div className="flex gap-2">
            <button onClick={checkStatus} className="btn">Check status</button>
            <button onClick={onCancel} className="btn btn-outline">Cancel</button>
          </div>
        </>
      )}
      {phase === "paid" && <p className="text-green-600 font-semibold">Payment received ✓</p>}
      {phase === "expired" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-amber-600">QR expired.</p>
          <button onClick={onCancel} className="btn">Back</button>
        </div>
      )}
      {(phase === "failed" || phase === "error") && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-600">Payment could not be completed.</p>
          <button onClick={onCancel} className="btn">Back</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `payment-modal.tsx`**

In `payment-modal.tsx`:
1. When rendering the list of `ModeOfPayment` options, filter with `shouldOfferPaymongoQr(mop, isOnline)` so the gateway method is hidden offline (import from `@/lib/payments/paymongo/gateway`).
2. When the cashier picks a tender whose `isPaymongoQrMethod(mop)` is true, instead of showing the manual reference input, render `<PaymongoQrView ... />` with the tender amount.
3. Pass an `onPaid={({ amount, reference }) => { /* add Payment{ methodId, amount, reference } to the tender set, then run the existing completePaymentFromUnits online path */ }}` and `onCancel={() => { /* drop back to tender selection; leave the session open */ }}`.

Use the existing multi-tender state so a QR tender coexists with other tenders. Do **not** introduce a second completion path — reuse `completePaymentFromUnits`.

- [ ] **Step 3: Manual smoke (dev server, online)**

Run: `npm run dev`
- Mark a test MOP as `gateway: 'paymongo_qrph'` (Task 12 UI, or set the field directly in Firestore for this smoke).
- Ring up a bill, pick the PayMongo tender → confirm the QR renders and a countdown ticks.
- Toggle the device offline → confirm the PayMongo tender disappears from the options.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/cashier/paymongo-qr-view.tsx src/components/cashier/payment-modal.tsx
git commit -m "feat(paymongo): cashier QR view + PaymentModal gateway wiring"
```

---

### Task 12: Manager toggle to flag a MOP as the gateway

**Files:**
- Modify: `src/components/manager/collections/ModeOfPaymentEditDialog.tsx`

**Interfaces:**
- Consumes: `ModeOfPayment.gateway` field (Task 5).
- Produces: a manager control that sets `gateway` to `'paymongo_qrph'` or `null` when saving a MOP.

- [ ] **Step 1: Add the control**

In the edit dialog form (alongside the existing `type` / `hasRef` controls), add a checkbox "Auto-confirm via PayMongo QR". When checked, set the saved MOP's `gateway = 'paymongo_qrph'`; when unchecked, `gateway = null`. Persist it in the same save path that writes `storeModesOfPayment/{id}`.

- [ ] **Step 2: Manual verify**

Run: `npm run dev`
- Open a MOP in the manager, check the box, save.
- Confirm the Firestore doc now has `gateway: 'paymongo_qrph'`.
- Confirm that MOP now triggers the QR view in the cashier flow (online) and is hidden offline.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/manager/collections/ModeOfPaymentEditDialog.tsx
git commit -m "feat(paymongo): manager toggle to mark a MOP as the QR gateway"
```

---

### Task 13: Config, secrets, and webhook registration (ops)

**Files:**
- Modify: `.env.local` (local only — do not commit real secrets)
- Modify: `apphosting.yaml`

**Interfaces:**
- Consumes: `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET_POS` (read by Task 6/8/9).
- Produces: configured secrets in local + App Hosting environments and a registered PayMongo webhook endpoint.

- [ ] **Step 1: Add local env vars** (use **test-mode** keys first)

Append to `.env.local`:
```
PAYMONGO_SECRET_KEY=sk_test_xxx
PAYMONGO_WEBHOOK_SECRET_POS=whsk_xxx   # filled in after Step 3
```

- [ ] **Step 2: Reference secrets in App Hosting**

In `apphosting.yaml`, add two entries mirroring the existing `GEMINI_API_KEY` / `CRON_SECRET` pattern:
```yaml
  - variable: PAYMONGO_SECRET_KEY
    secret: PAYMONGO_SECRET_KEY
  - variable: PAYMONGO_WEBHOOK_SECRET_POS
    secret: PAYMONGO_WEBHOOK_SECRET_POS
```
Then create the secrets in Secret Manager:
```bash
npx firebase apphosting:secrets:set PAYMONGO_SECRET_KEY
npx firebase apphosting:secrets:set PAYMONGO_WEBHOOK_SECRET_POS
```

- [ ] **Step 3: Register the POS webhook at PayMongo** (returns the signing secret for Step 1/2)

Point it at the POS App Hosting domain, subscribed to `payment.paid` and `payment.failed`:
```bash
curl https://api.paymongo.com/v1/webhooks \
  -u sk_test_xxx: \
  -H "Content-Type: application/json" \
  -d '{ "data": { "attributes": {
        "url": "https://<POS-APP-HOSTING-DOMAIN>/api/webhooks/paymongo",
        "events": ["payment.paid", "payment.failed"] } } }'
```
Copy the returned `attributes.secret_key` into `PAYMONGO_WEBHOOK_SECRET_POS` (local `.env.local` and Secret Manager).

- [ ] **Step 4: Confirm coexistence with the website webhook**

Verify the Shareat Website `paymongoWebhook` handler ignores events whose intent metadata has `kind: "pos_session"` (or simply lacks a matching storefront order) so both endpoints can safely receive `payment.paid`. If it throws on unknown events, add an early "no matching order → 200 ignore" guard there.

- [ ] **Step 5: Commit** (config only — no secret values)

```bash
git add apphosting.yaml
git commit -m "chore(paymongo): app hosting secret wiring for POS QR payments"
```

---

### Task 14: End-to-end verification in PayMongo test mode

**Files:** none (verification only).

- [ ] **Step 1: Full run** with test keys and a real device build (`npm run build:cap`, install APK) or `npm run dev` in a mobile viewport:
  - Ring up a bill ≥ ₱20, select the PayMongo tender.
  - QR renders; scan and pay in the PayMongo test sandbox.
  - Confirm the bridge doc flips to `paid`, the cashier screen auto-completes, the session closes, and the receipt shows the PayMongo amount in its `mop` breakdown with the `pay_…` reference.
- [ ] **Step 2: Negative paths**
  - Offline → PayMongo tender hidden.
  - Let a QR expire (10 min) → shows expired, session stays open.
  - Kill connectivity right after the scan, then use "Check status" once back online → completes.
- [ ] **Step 3: Idempotency** — from the PayMongo dashboard, resend the `payment.paid` event → confirm no duplicate `Payment` and the session stays singular.
- [ ] **Step 4:** Record results in the PR description; flip to live keys only after all pass.

---

## Self-Review

**Spec coverage:**
- §5.1 flow → Tasks 6–11. §5.2 components → Tasks 1–4 (pure `qrph.ts`), 5 (gateway/types), 6/9 (`qrph.server.ts`), 7 (create-qr + `bridge.server.ts`), 8 (webhook), 9 (status), 11 (QR view + modal), 12 (manager toggle). §5.3 bridge doc → Tasks 5 (type) + 7 (builder) + 8 (reducer). §6 API contracts → Tasks 7/8/9. §7 config/secrets/coexistence → Task 13. §8 edge cases → covered: offline gate (5,11), expiry (11), delayed webhook (9,11,14), idempotency (8,14), under/overpay impossible (dynamic amount), min-amount reject (1,7), void→manual-refund is a non-goal (documented). §9 security → Tasks 7 (token+session auth), 8 (signature), 10 (rules), 8 (idempotency). §10 testing → per-task unit tests + Task 14. §11 rollout → Tasks 12/13/14 (dormant behind gateway flag, test keys first).
- **Gap noted & closed:** the "orphaned confirmation" edge (spec §8 last bullet) — a lightweight reconcile on session re-open — is **not** implemented in v1 because the QR view is modal-blocking, making it rare; the `status` fallback (Task 9) plus webhook idempotency cover the realistic cases. Flagged here so it's a conscious deferral, not an omission. If you want the re-open reconcile in v1, add a task that, on opening an `active` session, queries its `paymentIntents` for a `paid` doc and offers "finalize".

**Placeholder scan:** No "TBD/implement later" left. Two spots intentionally require the implementer to match an existing name to avoid guessing wrong: `adminDb`/`adminAuth` export names (`src/lib/firebase/admin.ts`), the client `db`/`auth` export path, and the sibling `payments` Firestore read predicate — each is a named, locatable anchor with instructions, not an open placeholder.

**Type consistency:** `ParsedQr`, `QrhpMetadata`, `WebhookEvent`, `PosPaymentIntentDoc` names are used identically across Tasks 1–9. `createQrPaymentViaApi`, `applyWebhookToIntentDoc`, `buildInitialIntentDoc`, `mapIntentStatusToDocStatus`, `shouldOfferPaymongoQr`, `isPaymongoQrMethod` are defined once and consumed by the exact same names downstream. `status` enum values (`awaiting_payment | paid | failed | expired | canceled`) match between the type (Task 5), the builder (Task 7), the reducer (Task 8), and the UI (Task 11).
