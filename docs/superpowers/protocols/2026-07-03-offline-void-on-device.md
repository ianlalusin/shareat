# Offline Void Session — On-Device Acceptance Protocol

> **This is the mandatory human acceptance gate for the Offline Void Session feature (Plan B).**
> Offline Firestore behavior (IndexedDB cache, batch commit on reconnect) is not unit-testable, so this on-device run is the real test. Run it on the APK, or on `npm run dev` in Chrome with **DevTools → Network → Offline**.

## Setup
- Open a session while **online** first (so its docs are in this device's cache). Ideally pick a session that has **both** a linked **loyalty redemption** and a **customer PIN**, so steps 2–3 exercise the deferred effects.
- Note the table number and the session id.

## Test steps — record PASS/FAIL for each

**1. Offline void (no hang).**
Go **Offline**. Void the session from the dialog with a reason.
- ✅ Expect: no spinner hang; the dialog closes; the session shows `voided`; its active kitchen tickets (`preparing`/`ready`) are cancelled; the table is freed and returns to `available`; you're back on the session list.

**2. Outbox marker written.**
Inspect `localStorage` key `offline_payment_queue` (DevTools → Application → Local Storage).
- ✅ Expect: one new item with `kind: "void"`. Its `effects` show `analytics/loyaltyFinalize/loyaltyEarn` = `"skip"`; `loyaltyReverse` = `"pending"` if the session had redemptions (else `"skip"`); `pinFinalize` = `"pending"` if the session had a PIN (else `"skip"`). `ctx.redemptionIds` lists the reversed ids; `ctx.pin` holds the PIN (or null).

**3. Reconnect → sync + drain.**
Go back **Online**.
- ✅ Expect: the local void syncs to Firebase (session `voided`, tickets cancelled, table free — confirm in the Firebase console). Then the outbox drains: the loyalty redemption(s) are **reversed** (points returned to the customer) and the PIN is **finalized** (`reason: session_voided`). The queue item is **removed**. **No duplicate** void, no duplicate reversal.

**4. Void with no loyalty / no PIN.**
Offline, void a plain session (no redemption, no PIN).
- ✅ Expect: voids locally with no hang; the queue item's `loyaltyReverse` and `pinFinalize` are both `"skip"`; on reconnect there is nothing to replay and the item resolves/removes cleanly.

**5. Partial-failure retry (no double reversal).**
Offline-void a session that has a redemption. Before reconnecting, block one endpoint (e.g. DevTools request-blocking on `/api/loyalty/redeem` **or** `/api/pins/finalize`), then reconnect.
- ✅ Expect: only the blocked effect stays `"pending"`; the other effect completes and is marked `"done"`. Unblock and let it retry (or reconnect again) → the pending effect completes. The already-`done` effect is **not** re-run — no double points reversal, no double PIN finalize.

**6. Online void unchanged (regression).**
While **online**, void a session normally.
- ✅ Expect: behaves exactly as before this feature — live loyalty reversal + PIN finalize happen inline, **no** `offline_payment_queue` item is created.

## Reporting
If every step is PASS, the feature is accepted. If any step FAILS, capture: the step number, what you saw vs. expected, the `offline_payment_queue` contents at the point of failure, and any console errors (look for `[voidSessionOffline]`, `[PIN]`, `[Loyalty]`, or sync-drain warnings) — and report BLOCKED with those specifics.
