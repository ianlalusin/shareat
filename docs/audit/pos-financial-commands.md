# POS financial commands (audit P1: B01, B03, B16, B17, NOV-RECEIPTS)

Status: design + compatibility contract, written before any rules change.
Branch: `audit/pos-financial-commands` (base `origin/sev5_advanced` @ 5fba19f0).

## 1. Goal

Canonical money documents are written only by authorized server commands
(Next.js API routes, Admin SDK, `verifyIdToken(token, true)` + staff/store
check + verified local-operator session). Clients may still *read* them.

Canonical documents and flags covered:

| Path | Canonical content |
|---|---|
| `stores/{s}/receipts/{id}` | whole doc (final receipts, refund receipts, void status, edit fields, analytics flags `analyticsApplied`, `analyticsReversed`, `analyticsEditVersion`, `voidCashRetainedReversed`, `reRing*`, refund counters) |
| `stores/{s}/receipts/{id}/revisions/{v}` | edit snapshots |
| `stores/{s}/counters/{id}` | receipt number sequence |
| `stores/{s}/paymentConversions/{id}` | tender conversions (already server-written) |
| `stores/{s}/sessions/{id}` | `status` -> closed/voided, `isPaid`, `revision`, `offlineWriteId`, close/void stamps |
| `stores/{s}/sessions/{id}/payments/{p}` | tender rows |
| `stores/{s}/tables/{t}`, `storeConfig/current/tables/{t}` | table release (`currentSessionId` cleared / `status: available` while seated) |
| `stores/{s}/paymentIntents/{id}` | consumption fields (server-only already) |

Not canonical (stay client-writable): bill lines, kitchen tickets, rtKdsTickets,
activeSessions/closedSessions projections, activity logs (append-only),
reservations, receipt print-audit fields (`printedCount`, `lastPrinted*`).

## 2. Writer inventory (before this change)

POS client (`firebase/firestore` SDK, rules-checked):

| Writer | Writes |
|---|---|
| `components/cashier/firestore.ts` `completePaymentFromUnits` | session close, payments rows, closedSessions/activeSessions, counters/receipts, receipt, table + table projection release, kitchen tickets served; then rtKds cleanup, KDS analytics, client analytics fallback (`analyticsApplied`) |
| `firestore.ts` `voidSession` | session voided, projections, tickets cancelled, rtKds, table release |
| `firestore.ts` `createRefundReceipt` | refund receipt create, parent refund counters, analytics fallback flag |
| `cashier/offlinePayment.ts` | same as checkout from cache, OL receipt `offlineOrigin`, session `revision`/`offlineWriteId`, table `releasedByWriteId` |
| `cashier/offlineVoid.ts` (+ `void-session-dialog.tsx`) | void from cache; queue marker written AFTER the batch (B17 gap) |
| `app/receipts/page.tsx`, `components/receipts/page.tsx` | correction: revision snapshot + receipt update (`analyticsApplied:true`, edit fields) + `analyticsEditVersion` fallback; void: receipt status/void cash + `analyticsReversed`; re-ring fallback `voidCashRetainedReversed`/`reRing*` |
| `hooks/use-print.ts` | receipt `printedCount`, `lastPrinted*` |
| `components/cashier/payment-modal.tsx` | reservation `paymentsAppliedToSessionId`; post-sale PIN / loyalty calls (HTTP) |
| `lib/manager/dataManagement.ts` (manager) | table projection rebuild |
| `PaymentConvertModal.tsx` | none direct (uses `/api/analytics/payment-conversion`) |

POS server (Admin SDK, bypasses rules): analytics applier / reconcile cron
(receipt analytics flags), `paymentConversions` route, loyalty reverse (receipt
loyalty flags), create-qr + webhook (`paymentIntents`).

Sibling repos (read-only grep 2026-11-03):
- `CUSTOMER`: no writes to receipts, counters, paymentConversions, paymentIntents,
  tables or session close state. Reads `closedSessions/{id}` (Admin SDK) in
  `submit-feedback`; `link-session` writes session link fields (Admin SDK). Unaffected.
- `Shareat Website`: only documentation mentions. Unaffected.

## 3. Server commands

All under `src/app/api/pos/commands/*` (POST, JSON), handler helpers in
`src/lib/server/pos-commands/`. Common checks: bearer ID token verified with
revocation (`verifyIdToken(token, true)`), `requireStaffStoreAccess` with the
roles below, operator resolution (section 5), body validation.

| Route | Roles | Effect |
|---|---|---|
| `checkout` | admin, manager, cashier | settle an open session |
| `void-session` | admin, manager, cashier | void an open (unpaid) session |
| `receipt-void` | admin, manager | void a final receipt (+ cash disposition) |
| `receipt-edit` | admin, manager | correction with revision snapshot |
| `refund` | admin, manager | refund receipt against a parent |
| `re-ring` | admin, manager | link void cash to a re-ring receipt |
| `reconcile` | admin, manager, cashier (own commands) | apply / retry / dismiss an offline command |
| `GET /api/cron/reconcile-pos-commands` | `Bearer CRON_SECRET` | sweep unreconciled offline commands + pending effects |

### 3.1 Checkout transaction

Input: `{ storeId, sessionId, opId, payments[{methodId, amount, reference?, intentDocId?, fromReservationPaymentId?}], expectedTotalCents, billingRevision }`.

In ONE Admin transaction:
1. Read session, receipt `receipts/{sessionId}`, command result `posCommandResults/{opId}`,
   store doc (tax config), receipt settings, counter, active projection,
   table, bill lines (query), active kitchen tickets (query), payment methods
   (query), every referenced paymentIntent / reservation.
2. Replay: result doc for `opId` exists, or receipt exists with `commandId == opId`
   -> return the stored outcome (no writes). Session closed/paid by anything
   else -> `409 already_settled`.
3. `session.billingRevision` must equal input `billingRevision` (409 `bill_changed`).
4. Totals are recomputed with `calculateBillTotals(billLines, store, billDiscount,
   customAdjustments, loyalty)` from the server reads; input `expectedTotalCents`
   must match within 1 centavo (409 `total_mismatch`). Client totals are never written.
5. Tenders: each amount must be finite, > 0 and representable in whole centavos
   (`|amount*100 - round(amount*100)| < 1e-6`); method must exist and not be archived.
   Paid >= due; change only from cash (same rules as before).
6. Gateway tenders (`gateway == paymongo_qrph`): bridge doc must exist,
   `status == paid`, `storeId`, `sessionId`, `methodId`, `provider == paymongo_qrph`
   (when present), `currency` absent or `PHP`, `billingRevision` (when present) ==
   input revision, amount (centavos) == tender, reference == provider payment id,
   and `consumedByReceiptId` absent or equal to this receipt (idempotent replay).
   The tx sets `consumedByReceiptId`, `consumedBySessionId`, `consumedByCommandId`,
   `consumedAtMs`. One intent can therefore settle at most one receipt, once.
   Reservation tenders: verified against the reservation and
   `paymentsAppliedToSessionId` is set in the same tx.
7. Writes: payments rows (ids `{opId}_{i}`), session closed (`revision + 1`),
   projections, counter +1, receipt (with analytics, `commandId`,
   `operatorProfileId`, `operatorVerified`), table + projection released only if
   `currentSessionId == sessionId`, tickets served, command result, effects outbox.

### 3.2 Other commands

- `void-session`: open/unpaid session -> voided (+ revision), tickets cancelled,
  projections, table released if still seated; effects `pinFinalize`,
  `loyaltyReverse`, `rtKdsCleanup`. Replay-safe via opId result doc.
- `receipt-void`: tx re-reads receipt; already voided -> idempotent no-op.
  Void cash values validated (finite, >= 0, refunded <= paid, retained = paid - refunded).
  Effects: `analytics(void)`, `loyaltyReverseReceipt`.
- `receipt-edit`: input `expectedEditVersion`; server snapshots the SERVER copy
  into `revisions/v{n}_{ts}`, recomputes totals with `receiptCorrectionTotals`,
  rebuilds sales analytics, settles tenders down to the new total (cash first),
  rejects tenders below the new total. If the original payment analytics is still
  pending, it is applied first (so the edit delta has a base). Effect `analytics(edit)`.
- `refund`: port of `createRefundReceipt` (same `quoteRefund`, fractional
  quantities from e29b7e71 unchanged), id = client request id (idempotent).
  Effect `analytics(refund)`.
- `re-ring`: runs the existing `voidcash-reverse` applier op (already server).

## 4. Offline commands (B16)

Collection `stores/{s}/posCommands/{opId}` — client **create-only, immutable,
unreadable by clients** (it carries the operator token; see 5). Shape:

```
{ schema: 1, opId, kind: "checkout" | "voidSession", storeId, sessionId,
  terminalId, createdByUid, clientCreatedAtMs, operatorSessionToken | null,
  expected: { sessionRevision, billingRevision, tableId | null, totalCents },
  payload: { payments[] | reason }, provisional: { receiptNumber, total, ... } }
```

Client order (offline sale or void):
1. Validate from cache exactly as today.
2. Write the localStorage queue item (with the full command) — if that fails
   the sale is NOT taken.
3. `setDoc(posCommands/{opId})` local-first (Firestore persistent cache keeps it
   across restarts). No canonical doc is written locally any more.
4. UI shows "pending settlement" from the local queue: the session is hidden from
   the active list, its table is offered as reseatable, and the receipt page
   renders the provisional receipt marked PROVISIONAL.

Reconcile (`/api/pos/commands/reconcile`, called by `PaymentQueueSyncProvider`
on reconnect with the queued command as fallback body; and by the cron sweep):
- Reads `posCommands/{opId}`; if missing (create denied or never synced), the
  request body copy is used and persisted by the server after checking
  `createdByUid == caller`, store, kind and shape.
- Operator token verified with the offline rule (5).
- Transaction: same as checkout plus: `session.revision == expected.sessionRevision`,
  `billingRevision`, recomputed total == `expected.totalCents`, session still
  open. Table released only if `currentSessionId == sessionId` (a reseated table
  is never cleared; result notes `tableReleased:false`). Receipt keeps the
  printed OL number (`offlineOrigin:true`, `offlineCommandId`).
- Outcome written to `posCommandResults/{opId}` (server-only, staff-readable):
  `accepted | rejected` with a reason code. Rejected commands stay in the queue
  with status `failed` (OfflineBanner shows them) and can be explicitly
  reconciled by a manager: `action: "retry"` (re-run validation) or
  `action: "dismiss"` (record resolution note; nothing canonical written).
- Transient failures (network, 5xx) leave the item pending.

## 5. Operator attribution

Header `x-pos-operator-session` carries the signed local-profile token from
`localStorage["shareat:serverProfile:{storeId}"].token` (read-only use of the
`useServerProfile` storage). Server: `verifyProfileSession(token, { uid, storeId })`.
- ok -> operator = `serverProfiles/{pid}` (must exist), `operatorVerified: true`.
- `no-key` (server has no signing secret, so no token was ever issued) ->
  account identity, `operatorVerified: false`.
- no / invalid token: admin and manager fall back to their account identity
  (they bypass the local-profile gate); cashier -> 401 `operator_session_required`.
- Offline commands: the token stored in the command is verified with
  `now = clientCreatedAtMs`; the command time must not be in the future
  (> server now + 5 min) and must be >= the token's `iat`. So a token that has
  since expired is accepted for a command recorded while it was valid. A
  forged or altered token always fails (signature).
Client-supplied names/ids are never written as the operator.

## 6. Deferred effects outbox (B17)

`stores/{s}/posEffects/{effectId}` — server-only. Written in the SAME transaction
as the canonical receipt / void. Deterministic ids `{receiptId}__{effect}` or
`void_{sessionId}__{effect}`. Fields: `effect`, `status pending|done|failed`,
`attempts`, `payload`, `lastError`, `sourceCommandId`.

Effects: `analytics` (shared applier, idempotent on flags), `kdsAnalytics`,
`rtKdsCleanup`, `pinFinalize`, `loyaltyFinalize`, `loyaltyEarn` (duplicate-safe
on receiptId), `loyaltyReverse` (redemption ids), `loyaltyReverseReceipt`.

Processing: inline right after the command commits (best effort), and by the
cron sweep. Each run re-checks that the source receipt/session exists in the
expected final state; if not, the effect is left pending and never marked done
(missing state is never finalized). After 10 failed attempts -> `failed`.
The browser no longer replays effects for new-style commands; legacy queue
items (no `opId`) keep the old gated replay path until drained.

## 7. Rules (separate final commit)

Earlier (non-breaking) commit: `posCommands` create-only/no read;
`posCommandResults`, `posEffects` server-only (read for results only).

Final commit (deploy ONLY after every device runs the new APK):
- receipts: no client create; update only print-audit fields with
  `printedCount == old + 1`; revisions: no client writes.
- counters, paymentConversions, sessions/*/payments: no client writes.
- sessions/{id}: client updates may not change `status` to closed/voided, set
  `isPaid`, or change `revision` / `offlineWriteId`; create must not be closed/paid.
- tables + table projection: clients may not clear `currentSessionId` or set
  `status: available` on a seated table (managers keep the projection rebuild
  via the storeConfig catch-all — existing residual).

The tightening is split across TWO final commits (both deploy-after-APK):
the money-docs commit and the bill-line / session-discount commit added in the
follow-up. Deploy them together, last.

`/api/analytics/payment-conversion` names its actor from the same operator
session header (body `actorName` ignored).

## 8. Rollout order

1. Server (App Hosting): commands, reconcile, cron route. Old APKs unaffected.
2. Rules commit 1 (posCommands/results/effects). Non-breaking.
3. New APK to every device. Cloud Scheduler job for
   `/api/cron/reconcile-pos-commands` (every 5 min, `Bearer CRON_SECRET`).
4. Drain: confirm no legacy offline queue items remain on devices.
5. Rules final commit (tightening). Old APKs will fail checkout after this.

## 9. Open business decisions (documented, not blocking)

1. Offline sale rejected (bill changed / settled elsewhere / total mismatch):
   money was collected. Manager resolves (re-ring or refund) then dismisses.
   Proposed default: no automatic re-ring.
2. Cashier role without a verified local-profile token is refused (account
   fallback only for admin/manager). Confirm this is acceptable for shops whose
   server has no `SERVER_PROFILE_SESSION_SECRET`/`CRON_SECRET` (then `no-key`
   fallback applies to everyone).
3. Bill-line prices (follow-up, `src/lib/checkout/line-pricing.ts`). Checkout
   proves each billable line's `unitPrice` against the store's price list:
   package lines -> `storeConfig/current.packages[].pricePerHead` (`bundlePrice`
   for bundles), `bundleextra_*` -> `bundleExtraHeadPrice`, add-ons ->
   `inventory/{itemId}.sellingPrice` (customer-app lines carry the product id
   and resolve through `inventory.productId`). Negative / non-finite modifier
   totals are refused. A different price needs `priceOverride {unitPrice, byUid}`
   whose uid is an active cashier/manager/admin of the store (the line editor
   writes it). Rules (final commit): server/kitchen accounts cannot write
   `unitPrice`, `modifiersTotal`, `priceOverride`, discounts (`lineAdjustments`,
   legacy `discount*`), `freeQty`, `itemId` or `type` on an existing line, may
   not lower an add-on line's quantity, cannot create a line carrying an
   override / discount / free qty, and cannot change the session's
   `billDiscount` / `customAdjustments`. A `priceOverride` may only be written
   in the writer's own uid.
   **Decision points (safe defaults chosen, owner to confirm):**
   - Servers and kitchen may NOT set custom prices; only cashier/manager/admin.
   - A catalog price changed by a manager mid-shift makes open bills that were
     priced at the old price fail checkout until a cashier confirms the price
     (edit line). Bills edited on an OLD APK (no override marker) need the same
     re-confirmation once the new server is live.
   - Items no longer in the inventory price list need a cashier override.
   Residuals: modifier prices are not re-validated against option-group config
   (only sign-checked); kitchen may still void quantity (`voidedQty`, its
   cancel flow) and servers may still set the package line quantity (guest-count
   verification) — both are audited flows, not price fields.
4. Bridge docs: P4 (audit/pos-payment-attempt-recovery) adds `billingRevision`
   (the bill revision the amount was last confirmed against). Checkout rejects a
   bridge whose `billingRevision` differs from the command's. A bridge WITHOUT
   the field (created before P4) is accepted as legacy: its amount, session,
   store, method and reference are still verified and it is still consumed
   exactly once. `currency` is checked only when present (QR Ph is PHP-only).
5. Offline commands may only be dismissed (closed without a canonical write) by a
   manager via `/api/pos/commands/reconcile {action:"dismiss", note}`; there is
   no dedicated UI yet — the till shows the rejection on the OfflineBanner and
   the cashier's Retry sends `action:"retry"`.
6. A rejected offline command whose creator account was deactivated or moved
   to another store cannot be retried (operator check fails); a manager
   dismisses it.

## 9b. Independent review fixes (2026-11-03)

| # | Finding | Resolution |
|---|---|---|
| 1 | session `loyaltyRedemptions` / create-time discounts / delete+recreate | Checkout prices rewards only from `loyaltyRedemptions/{id}` server records (applied, this store+session, not consumed elsewhere). Rules: `loyaltyRedemptions` is never client-written (create or update); server/kitchen cannot set `billDiscount`/`customAdjustments` on create or update; session create must be open, unpaid, revision 1 (or absent); client session delete denied (no client caller found). |
| 2 | reservation deposits | Scan-to-pay deposit rows refused at checkout (**decision: QR Ph deposits must be taken through the bridge flow**). Manual deposits deduped (client + server) and consumed once in server-only `tenderConsumptions/res_{reservationId}__{paymentId}`. A manual deposit is equivalent to a typed manual tender (cashier-trusted), so reservations stay staff-writable. |
| 3 | kitchen `voidedQty` | Kitchen voids also increment `kitchenVoidedQty` (rules require the same delta and forbid other void changes by server/kitchen); checkout rejects a line whose kitchen-voided qty exceeds its cancelled kitchen tickets. **Decision: kitchen keeps its cancel flow; anything beyond cancelled tickets needs a cashier.** Residual: ticket docs are client-written. |
| 4 | name vs itemId | Receipt lines and sales analytics use the catalog name (`orderedItemName` keeps what was typed). |
| 5 | void reversal ids | Only redemptions the server applied to this bill are reversed (existing `reverseLoyaltyRedeem` already refused ids from paid bills; this also blocks ids from other open bills). |
| 6 | rejected offline sale unrecoverable | Manager action `accept-recorded` writes receipt `offline_{opId}` from the command's own lines/tenders/total with approver + note (no session/table change; scan-to-pay/deposit tenders refused). `RejectedOfflineSalesCard` on both receipts pages lists rejected commands with Retry / Accept as recorded / Dismiss. |
| 7 | sweep blind spot | Commands carry `resolved:false` (required by rules at create); server sets `resolved:true` on any terminal outcome; sweep queries `resolved == false` (single-field, automatic index) and uses server write time for its grace period. |
| 8 | backdated offline time | Command time must be ≥ session start − 5 min and ≤ server now + 5 min, and ≥ token iat. No closed/posted business day exists in this codebase; if one is added, check it here. |
| 9 | void after partial refund | Cash paid on void nets out `refundedMop` cash. |
| 10 | opId reuse | Result docs store kind, session and a payload fingerprint; mismatch → 409 `command_conflict`. |
| 11 | effect double-run | Effects are leased (`leaseId`, `leaseUntilMs`, 2 min) in a transaction before running; only the lease holder marks done. |

## 10. Implementation map

| Piece | Files |
|---|---|
| Pure money math | `src/lib/checkout/receipt-math.ts` |
| Commands | `src/lib/server/pos-commands/{checkout,void-session,receipt-commands,reconcile,effects,effect-runner,operator,http,errors}.ts` |
| Routes | `src/app/api/pos/commands/{checkout,void-session,receipt-void,receipt-edit,refund,reconcile}/route.ts`, `src/app/api/cron/reconcile-pos-commands/route.ts` |
| Client | `src/lib/pos-commands/{client,receipts}.ts`, `components/cashier/{firestore,offlinePayment,offlineVoid,payment-modal,void-session-dialog,session-list-view}.tsx`, `components/shared/PaymentQueueSyncProvider.tsx`, `lib/offline/{payment-queue,reconcileQueuedCommand}.ts`, `hooks/use-pending-settlement.ts`, `app/receipt/page.tsx`, both receipts pages |
| Tests | `src/lib/server/pos-commands/pos-commands.test.ts` (server transactions), `tests/rules/audit-p1-financial-commands.test.ts`, updated `tests/rules/{audit-b01-b16,store-scoped}.test.ts` |
