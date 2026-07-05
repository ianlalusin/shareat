# PayMongo QR Ph — POS Cashier Payment Integration

**Status:** Approved design (ready for implementation planning)
**Date:** 2026-07-05
**Repo:** `C:\Users\ianla\webapps\POS` (`culinaryflow`)
**Author:** Design session (brainstorming skill)

---

## 1. Summary

Add **"PayMongo QR"** as a tender on the POS cashier checkout. When the cashier
selects it for a bill amount, the POS generates a **dynamic QR Ph code** (unique
per transaction, exact amount baked in) that the customer scans with any bank or
e-wallet app. PayMongo confirms the payment via webhook; the cashier screen — which
already runs on Firestore real-time listeners — sees the confirmation and finalizes
the sale through the existing checkout path.

The PayMongo tender behaves like any other `ModeOfPayment` of `type: "online"` and
is fully compatible with multi-tender bills (e.g. ₱500 QR + ₱350 cash).

### The one rule that governs every decision

**A session never closes until PayMongo confirms the payment.** There is therefore
no "paid but unsynced" state to reconcile. A payment either completes online in the
moment, or it did not happen — in which case the session stays open and the cashier
retries or switches to another tender. Nothing is ever lost or double-counted.

---

## 2. Goals / Non-goals

### Goals (v1)
- Accept in-store payment via a dynamic, per-bill QR Ph code from the cashier flow.
- Auto-confirm via PayMongo webhook + Firestore bridge doc; no manual reference entry.
- Reuse the existing multi-tender checkout and receipt path unchanged.
- Online-only: the method is hidden/disabled when the device is offline.
- Keep all POS payment logic inside the POS repo (new webhook lives here).

### Non-goals (deferred)
- **Refunds / API-driven reversals.** Voiding a PayMongo-paid session in v1 is allowed
  but flags the payment for **manual refund in the PayMongo dashboard**. API refunds
  are a v2.
- Offline/queued gateway payments (explicitly out of scope — offline disables the method).
- Static store QR or hosted checkout-session flows (dynamic QR chosen).
- Changing storefront online-order payments (owned by the website project; untouched).

---

## 3. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| QR mechanism | **Dynamic QR per bill** (PaymentIntent + `qrph` PaymentMethod + attach) | Exact-amount matching, auto-confirm, clean per-bill reconciliation. |
| Webhook home | **New webhook in the POS project** (`/api/webhooks/paymongo`) | Keeps POS payment logic in the POS repo; reuses the website's proven verify pattern. |
| Refund scope | **Deferred to v2** | Keeps v1 small and shippable. |
| Offline behavior | **Method hidden/disabled when offline** | User constraint; removes all offline-reconciliation complexity. |
| Confirmation channel | **Firestore bridge doc**, driven by webhook, watched by the cashier UI | The app is already Firestore-listener-based; no client polling needed for the happy path. |

---

## 4. Existing-system context (verified during exploration)

- **Stack:** Next.js 16 + React 18 + Capacitor 6, TypeScript. Firestore project
  `shareat-hub-v2` (shared by POS, ERP-rebuild, CUSTOMER, Shareat Website). Deployed on
  **Firebase App Hosting** — so `/api/*` route handlers run server-side even though the
  Android APK ships as a static export. Native `fetch`; `CapacitorHttp` for CORS-sensitive
  native calls. Secrets via Firebase Secret Manager + `.env.local`.
- **Checkout today:** `src/components/cashier/payment-modal.tsx` →
  `completePaymentFromUnits()` (online) / `completePaymentOffline()` (offline queue).
  Each tender is a `Payment { id, methodId, amount, reference? }` written under
  `stores/{storeId}/sessions/{sessionId}/payments/{paymentId}`. Receipt carries
  `mop: Record<string, number>`.
- **Payment methods:** `ModeOfPayment { id, name, type: "cash"|"card"|"online"|"other",
  hasRef, isActive, sortOrder, ... }` at `src/lib/types.ts` (~L614), configured in
  `src/components/manager/collections/ModesOfPaymentSettings.tsx`.
- **Session state machine:** `PendingSession.status: 'pending_verification' | 'active' |
  'closed' | 'voided'` (`src/lib/types.ts` ~L819). `Receipt.status: 'final' | 'voided'`.
- **PayMongo already exists — but not here.** The **Shareat Website** project
  (`functions/index.js`) runs `paymongoWebhook` (region `asia-southeast1`, endpoint
  `https://shareat.net/api/storefront-paymongo-webhook`) for storefront online orders.
  It verifies the `Paymongo-Signature` header (format `t=<ts>,li=<hex>`) as
  `HMAC-SHA256(secret, "<ts>.<rawBody>")` with `crypto.timingSafeEqual`, and calls
  `POST https://api.paymongo.com/v1/checkout_sessions` with `Authorization: Basic
  base64(secret_key + ":")`. POS has **no** PayMongo code and no `/api/webhooks/*`.
- **Reusable POS infra:** HMAC/`timingSafeEqual` helpers already exist
  (`src/lib/server/customer-join-token.ts`, `src/lib/server/external-auth.ts`);
  Admin SDK init at `src/lib/firebase/admin.ts`; QR libs `qrcode` + `qrcode.react`
  already installed; thermal printer plugin exposes `printQRCode(...)`
  (`src/lib/printing/thermalPrinter.ts`).
- **ERP reconciliation:** POS already exposes `GET /api/external/sales` and
  `/api/external/payment-methods`, which aggregate by MOP — so a new MOP surfaces to the
  ERP automatically with no ERP-side change.

---

## 5. Architecture

### 5.1 End-to-end flow

```
Cashier taps "PayMongo QR" for ₱850   (method only shown when online)
   │
   ▼
POST /api/pos/paymongo/create-qr  { storeId, sessionId, amount }
   │  server (secret key):
   │    1) POST /v1/payment_intents      amount=85000, currency=PHP,
   │                                      payment_method_allowed=["qrph"],
   │                                      capture_type="automatic",
   │                                      metadata={storeId, sessionId, intentDocId, kind:"pos_session"}
   │    2) POST /v1/payment_methods       type="qrph", billing={ name/email = store }
   │    3) POST /v1/payment_intents/:id/attach  payment_method=<pm_id>
   │       → next_action.code.{image_url|data}  (QR), expires ~10 min
   │  server: write bridge doc  sessions/{id}/paymentIntents/{intentDoc}  status=awaiting_payment
   ▼
Cashier screen renders the QR (qrcode.react from qrData) + 10-min countdown
   │                                     (optional: printQRCode to thermal printer)
   ▼
Customer scans, pays exactly ₱850
   │
   ▼
PayMongo → POST /api/webhooks/paymongo   event: payment.paid
   │  read raw body → verify Paymongo-Signature (HMAC-SHA256) → 401 on mismatch
   │  idempotency: skip if event id already in processedEventIds
   │  metadata → address bridge doc directly → status=paid, store pay_… id
   │  respond 200 quickly
   ▼
Cashier screen (Firestore listener on bridge doc) sees status=paid
   │  add Payment{ methodId, amount:850, reference: "pay_…" } to the tender set
   ▼
existing completePaymentFromUnits (online path) → session closed, receipt, mop breakdown
```

No new completion logic: the webhook confirmation simply feeds the tender that the
existing checkout already knows how to finalize.

### 5.2 Components (each isolated, single-purpose, testable)

| Unit | Kind | Responsibility |
|---|---|---|
| `src/lib/payments/paymongo/qrph.ts` | **Pure** | Build the intent/method/attach request bodies; parse the attach response into `{ qrData, imageUrl, expiresAtMs }`; verify a webhook signature given `(rawBody, header, secret)`; peso→centavo conversion. No framework, no I/O. |
| `src/lib/payments/paymongo/qrph.server.ts` | **Thin server** (`server-only`) | Perform the `fetch` calls to `api.paymongo.com` with the secret key (`Basic base64(sk + ":")`); read/write the bridge doc via Admin SDK. |
| `src/app/api/pos/paymongo/create-qr/route.ts` | Route | Authenticate caller (Firebase ID token) + scope to `storeId`; validate `amount ≥ PayMongo min`; create intent/method/attach; write bridge doc; return `{ intentDocId, qrData, imageUrl, expiresAtMs }`. |
| `src/app/api/webhooks/paymongo/route.ts` | Route | Read **raw** body; verify signature; idempotency by event id; **filter by metadata** (ignore events without `sessionId`); on `payment.paid`/`payment.failed`, write bridge doc via metadata addressing; 200 fast. |
| `src/app/api/pos/paymongo/status/route.ts` | Route (fallback) | Cashier "Check status" — read the PaymentIntent from PayMongo and reconcile the bridge doc, covering a delayed/missed webhook. |
| `src/components/cashier/paymongo-qr-view.tsx` | UI | Modal launched by `PaymentModal` when the gateway MOP is selected & online: call create-qr → render QR + countdown → subscribe to bridge doc → on `paid` add `Payment` and complete → handle expire/cancel/(optional) print. |
| `src/lib/types.ts` | Type | Add `gateway?: 'paymongo_qrph' \| null` to `ModeOfPayment`. |
| `src/components/manager/collections/ModeOfPaymentEditDialog.tsx` | UI | Let a manager flag one MOP as the PayMongo gateway (sets `gateway`). |

### 5.3 Firestore bridge doc — the confirmation channel

Path: `stores/{storeId}/paymentIntents/{intentDocId}`

> **Design change (during implementation, user-approved):** the bridge doc is a
> **top-level per-store** collection, not nested under the session. The repo's
> Firestore rules use a catch-all that grants staff write to everything under a
> store, and Firestore's OR-semantics mean a narrower "deny" rule can't override
> it. Making the doc top-level lets `'paymentIntents'` be added to the catch-all's
> write-exclusion list (mirroring `onlineOrders`) → **client-read / Admin-SDK-write
> only**, so a cashier device can't forge `status:"paid"`. `sessionId` remains a
> field on the doc for reconciliation.

```ts
type PosPaymentIntentDoc = {
  id: string;
  storeId: string;
  sessionId: string;
  provider: 'paymongo_qrph';
  amount: number;                 // pesos, matches the tender amount
  amountCentavos: number;         // integer sent to PayMongo
  paymongoIntentId: string;       // pi_…
  paymongoPaymentId: string | null; // pay_… (set on paid)
  qrData: string | null;          // EMVCo string → render (qrcode.react) & print
  imageUrl: string | null;        // PayMongo-hosted QR image, if used instead of qrData
  status: 'awaiting_payment' | 'paid' | 'failed' | 'expired' | 'canceled';
  createdAtMs: number;
  expiresAtMs: number;            // createdAt + ~10 min
  processedEventIds: string[];    // webhook idempotency (evt_…)
  methodId: string;               // the ModeOfPayment id
  createdByLocalUserId: string | null; // cashier audit
  createdByUid: string;           // device/Firebase uid
};
```

The webhook writes here **without a lookup query**: `{ storeId, sessionId, intentDocId }`
are stamped into the PaymentIntent `metadata`, and PayMongo echoes metadata back on the
payment event, giving the exact document path (`stores/{storeId}/paymentIntents/{intentDocId}`).

---

## 6. API contracts

### `POST /api/pos/paymongo/create-qr`
- **Auth:** `Authorization: Bearer <Firebase ID token>`; verify via Admin SDK and confirm
  the token's store access includes `storeId` (mirror the existing mobile-API auth pattern).
- **Body:** `{ storeId, sessionId, amount, methodId, localUserId? }`
- **Validation:** `amount` is a positive number ≥ PayMongo's QR Ph minimum (enforce a
  configured floor, e.g. ₱20.00 unless confirmed otherwise); session is `active`.
- **200:** `{ intentDocId, qrData, imageUrl, expiresAtMs, paymongoIntentId }`
- **4xx:** validation / auth errors; **5xx:** PayMongo/upstream errors (client shows
  "couldn't start payment, try again").

### `POST /api/webhooks/paymongo`
- **No app auth**; trust is established by signature verification.
- Read the **raw** request body (needed for HMAC). Verify `Paymongo-Signature`
  (`t=<ts>,li=<hex>`) as `HMAC-SHA256(PAYMONGO_WEBHOOK_SECRET_POS, "<ts>.<rawBody>")`
  with `timingSafeEqual`. On mismatch → **401**, no side effects.
- Parse event. If `data.attributes.data.attributes.metadata` (payment → intent metadata)
  has no `sessionId` / `kind !== "pos_session"` → **200 ignore** (it's a storefront event).
- Idempotency: if the event id is already in the bridge doc's `processedEventIds` → **200 no-op**.
- On `payment.paid` → set `status='paid'`, `paymongoPaymentId`, append event id.
  On `payment.failed` → `status='failed'`. Respond **200** promptly.

### `POST /api/pos/paymongo/status` (fallback)
- **Auth:** same as create-qr.
- **Body:** `{ storeId, sessionId, intentDocId }`
- Reads the PaymentIntent from PayMongo, updates the bridge doc if the webhook hasn't
  landed yet, returns the current `status`.

---

## 7. Config, secrets, ops

- **API key:** reuse `PAYMONGO_SECRET_KEY` (same PayMongo account as the website).
- **Webhook secret:** register a **new** PayMongo webhook endpoint pointing at the POS
  App Hosting domain (`/api/webhooks/paymongo`), subscribed to `payment.paid` and
  `payment.failed`. Store its signing secret as **`PAYMONGO_WEBHOOK_SECRET_POS`**.
- Add both to App Hosting Secret Manager and `.env.local`; reference them in
  `apphosting.yaml` via `secret:` like the existing `GEMINI_API_KEY` / `CRON_SECRET`.
- **Coexistence:** both the website and POS webhooks receive every `payment.paid`. Each
  handler filters by metadata (POS events carry `sessionId`; storefront events carry
  `orderId`) and ignores the other's — one guard clause each. The website handler already
  ignores events it can't match to an order; confirm this holds for POS events.
- **ERP:** none needed — PayMongo QR appears as its own MOP in `/api/external/sales`, and
  the `pay_…` id on `Payment.reference` is the audit trail.

---

## 8. Edge cases

All are resolved by "session closes only on confirmation":

- **Offline** → method hidden/disabled.
- **Connection drops after QR shown** → confirmation can't arrive; countdown + "Check
  status" poll; on expiry the attempt is canceled and the session stays **open** →
  cashier retries or switches to cash. No lost or duplicated sale.
- **QR expires (~10 min) unpaid** → bridge doc `expired`; UI offers "Generate new QR".
- **Customer paid but webhook delayed** → "Check status" hits PayMongo directly; the
  webhook still arrives later and is idempotent.
- **Duplicate webhook / cashier double-tap** → event-id idempotency + single-use bridge
  doc + idempotent session close.
- **Under/overpayment** → impossible; the dynamic intent fixes the exact amount.
- **Amount below PayMongo minimum** → rejected at create-qr with a clear message.
- **Void a paid session (v1)** → allowed; the payment is flagged for **manual refund** in
  the PayMongo dashboard (API refunds are v2). Record a note on the void.
- **Orphaned confirmation** (cashier left the QR screen before `paid` arrived) → on
  re-opening that session, if a `paid` bridge doc exists while the session is still open,
  the UI offers "Payment received — finalize sale?" so the tender can be completed via the
  same path. (Small reconcile; keep the happy path modal-blocking so this is rare.)

---

## 9. Security

- Secret key and webhook secret live only server-side (Secret Manager / `.env.local`),
  never in the client bundle or the APK.
- Webhook trust = signature verification with constant-time compare; unverified requests
  get 401 with no side effects.
- `create-qr` / `status` require a verified Firebase ID token scoped to the `storeId`.
- Firestore rules for `stores/{storeId}/paymentIntents/*` (top-level; see §5.3): staff may
  **read** their store's intents; **writes/deletes** are denied to clients by adding
  `'paymentIntents'` to the rules catch-all's write-exclusion list (same pattern as
  `onlineOrders`), so only the Admin SDK (create-qr route + webhook) can write. This is what
  prevents a cashier device from forging `status:"paid"`.
- Idempotency on both the webhook (event id) and session completion prevents replay/double
  charges from producing double sales.

---

## 10. Testing

- **Unit (pure module):** request-body shapes; attach-response parsing; signature verify
  with known good/bad vectors (including tampered body and wrong timestamp); peso→centavo
  conversion incl. rounding and the minimum-amount floor.
- **Webhook:** idempotent replay (same event twice → one state change); metadata filtering
  (storefront event → ignored); bad signature → 401 no-op.
- **Manual E2E in PayMongo test mode** (`sk_test_…`): create a QR, simulate the scan/pay
  via the sandbox, confirm the bridge doc flips and the session finalizes with the correct
  `mop` breakdown and receipt. Verify the offline gate hides the method.
- Follow the repo's pure-logic-first convention so the money/signature logic is covered
  without Firestore or network.

---

## 11. Rollout

1. Ship behind the gateway-MOP flag: no `ModeOfPayment` marked `gateway:'paymongo_qrph'`
   → the feature is dormant.
2. Test-mode keys first; validate end-to-end on a real device (QR render + scan + printer).
3. Switch to live keys, register the live webhook endpoint, mark one store's MOP as the
   gateway, pilot on one store, then roll out.

---

## 12. Open questions / defaults to confirm during implementation

- **QR surface default:** on-screen (primary) with an optional "Print QR" button using the
  existing `printQRCode` — assumed unless you prefer print-only or both.
- **PayMongo QR Ph minimum amount:** confirm the current floor when wiring `create-qr`
  validation.
- **Billing details for the `qrph` PaymentMethod:** default to store name/email; confirm
  whether a customer name should be attached when known.

---

## References
- PayMongo QR Ph docs: https://docs.paymongo.com/docs/payment-acceptance-qr-ph
- PayMongo webhooks: https://developers.paymongo.com/docs/webhooks
- Existing website webhook pattern: `Shareat Website/functions/index.js` (`paymongoWebhook`, ~L785–L1299)
- POS checkout: `src/components/cashier/payment-modal.tsx`, `src/components/cashier/offlinePayment.ts`
- POS types: `src/lib/types.ts` (`ModeOfPayment` ~L614, `Payment` ~L532, `PendingSession` ~L819, `Receipt` ~L1039)
