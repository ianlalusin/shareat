# Online Orders & Reservations — Stress Test & Audit Report

Date: 2026-11-24 (Asia/Manila)
Scope: website ordering + reservations across TWO repos:
  - POS ("C:\Users\ianla\webapps\POS") — admin/manager side, kitchen, cron, server ops
  - Shareat Website ("C:\Users\ianla\webapps\Shareat Website") — public site + Firebase Cloud Functions

## 1. Workflow map

Two independent customer journeys share one hub Firestore (shareat-hub-v2):

### A. Online ordering (website → kitchen)
1. Public site reads the storefront catalog via `getStorefrontCatalog` (functions/index.js) — public read, server is the price authority.
2. Customer verifies contact via OTP (`sendOtp` / `verifyOtp`, HMAC checkout token) and places the order via `placeOrder` — re-validates every line/variant/modifier against the snapshot, delivery radius, hours, min order, payment method.
3. Wallet orders wait in `pending_payment`; PayMongo is gone, the cashier confirms the transfer via the POS `confirm-payment` op (src/app/api/admin/online-orders/route.ts).
4. `paymongoWebhook` (idempotent) and `expireStalePendingPayments` (dry-run by default, lastUpdateTime-preconditioned) keep abandoned orders from lingering.
5. The POS Online Orders inbox (OnlineOrdersClient) drives accept → preparing → ready → out_for_delivery/ready_for_pickup → completed/cancelled/rejected.

### B. Reservations (website → POS reservations / set-reservation inbox)
1. Standard table booking: `createReservation` → `stores/{id}/reservations` (status booked) → POS /reservations lifecycle (confirm/seat/cancel/no-show/handled).
2. Christmas take-out set reservation: `reserveSet` → `stores/{id}/onlineOrders` with kind "set_reservation" → POS Online Orders inbox; cashier records a ≥50% deposit (`record-payment`), which flips pending → accepted; the cron `release-set-reservations` sends accepted orders to the kitchen 2h before the requested time.

## 2. Method

- Static inspection of the pure, load-bearing logic in both repos (money math, status transitions, availability, menu merge, feed merge, OTP/token flow).
- Property-based stress tests added (seeded PRNG, thousands of iterations) in both repos.
- Existing suites re-run to confirm a green baseline.

## 3. Findings — hardening dispositions

Both workflows are server-authoritative and already heavily audited (the code is littered with prior-fix citations: WP-S2c, audit B22, F12/F13, "LipA bug", etc.). Every write re-validates on the server; the client is treated as untrusted. Specific guarantees confirmed:

- Price authority: `placeOrder` rebuilds line totals from the snapshot; the browser's prices are ignored (test: "a price sent by the browser is ignored").
- `reserveSet` reads the branch's own POS inventory price and refuses a set priced 0 / missing / archived / inactive.
- Payment never moves through the kitchen-lifecycle table; deposit math is centavo-exact (validatePayment caps at the balance; `meetsDeposit` compares centavos).
- Idempotency: PayMongo webhook de-dupes by event id; expiry sweep uses lastUpdateTime preconditions; the release cron re-checks inside a transaction.
- Availability: open/closed mirrors between POS and website (online-hours vs onlineOpenNow), including overnight windows and manual override.

The new stress tests and final review confirmed the server-authoritative flow and led to these small hardening changes:

1. **Receipt MOP overpayment defense** — `receiptMop` now caps each recorded payment at the remaining grand total before adding the completion remainder. Upstream `validatePayment` already enforces that limit; the cap protects generated receipts from manually corrupted or legacy payment arrays. Added a regression test.
2. **Malformed schedule start times** — `toMinutes` now validates `HH:mm` (00:00–23:59) and maps malformed values to `Infinity`; equal-time sections use a title tiebreaker, with “All Day” last. This avoids `NaN` comparisons and makes malformed schedule ordering deterministic. Added a regression test.
3. **Malformed reservation party sizes** — `createReservation` no longer floors numeric input and accepts only numbers or non-empty numeric strings before the existing integer/range checks. Values such as `"3.7"` and `true` are rejected rather than silently turning into a party of 3 or 1. Added endpoint tests confirming no reservation is written.
4. **Cancelled payment badge** — kept as-is. The badge describes recorded payment, while order status is shown in a separate badge and the payment line separately reports the recorded amount. A cancelled but fully paid order is therefore historically “Paid” in the payment badge; no refund state is represented by this workflow. Added a test to pin this distinction.
5. **Release-time boundary** — both `isReleaseDue` and the pending reservation badge now use `releaseAtMs <= nowMs`, including the exact release millisecond. Added a boundary assertion.

## 4. Verification

POS (vitest):
- `src/lib/__tests__/reservation-stress.test.ts` — 6 property-based tests (new).
- Requested suites, including explicit component-test file paths for PowerShell: reservation (24), release-set-reservations (5), online-order-tickets (9), online-orders-feed (9), OnlineOrdersClient (11), plus 6 stress tests — **64 tests green**.
- `npx tsc --noEmit` — clean (exit 0).

Shareat Website (node --test):
- `tests/online-orders-stress.test.cjs` — 4 property-based tests (new).
- Requested suites plus `tests/menu-merge.test.mjs` and `tests/website-enrolment.functions.test.cjs` for the added regression cases — **65 tests green**.

## 5. Added/updated files

- POS: `src/lib/__tests__/reservation-stress.test.ts`
- POS: `src/lib/online-orders/reservation.ts` and `src/lib/online-orders/reservation.test.ts`
- Shareat Website: `tests/online-orders-stress.test.cjs`
- Shareat Website: `src/lib/menu-merge.mjs`, `tests/menu-merge.test.mjs`, `functions/index.js`, and `tests/website-enrolment.functions.test.cjs`
