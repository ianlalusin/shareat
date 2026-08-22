# Dispensable Data Retention & Purge — Design

**Date:** 2026-08-22
**Repo:** POS (`sev5_advanced`) — the tickets, the rebuild, and the guard all live here.
**Status:** Approved design, pending implementation plan.

## 1. Problem

Customer-app activity writes high-volume operational documents that are consumed
live and never read again once a session is paid: kitchen tickets (including
every refill order), session bill lines, expired access PINs, and customer
assistance/griller requests. None of these are pruned today. There is no
retention job anywhere in the repo — `scripts/` contains only backfills and
one image cleanup.

The goal is to purge what is genuinely dispensable without losing anything the
business reads.

## 2. What was verified

### 2.1 Refill counts survive a purge — confirmed

The refill aggregation ladder, verified end to end:

```
kitchenticket
  → session.servedRefillsByName          KDS increments on serve
                                         (src/app/kitchen/page.tsx:594)
  → receipt.analytics.servedRefillsByName  copied at payment
                                         (src/components/cashier/firestore.ts:722)
  → analytics/{dayId}.refills.servedRefillsByName
  → analyticsMonths / analyticsYears rollups
  → nightly Postgres archive on the droplet
```

`getRefillContribution()` (`src/lib/analytics/daily.ts:552`) reads the
**receipt**, not the tickets. The analytics rebuild therefore reconstructs
refill numbers from receipts alone. A paid session's refill tickets are
dispensable.

The customer app only ever reads tickets for the **current** session —
`refillTicketState()` (`CUSTOMER/src/lib/server/refill-outstanding.ts:168`)
scopes its query to one `sessionId`. No historical read path exists.

### 2.2 Kitchen performance metrics do NOT survive — confirmed

The same kitchenticket document is the **only** source for the `kitchen.*`
block of a rebuilt day doc (`src/lib/analytics/backfill-core.ts:244-274`):

- `durationMsSumByLocation` / `durationCountByLocation` — per-station speed
- `servingMsSumByUser` / `servingCountByUser` — per-staff serving performance
- `cancelledCountByType`
- `servedCountByType` / `durationMsSumByType` / `durationCountByType`

The receipt carries `serveCountByType` and `serveTimeMsTotalByType`
(`firestore.ts:722-724`), but **not** the per-station or per-staff breakdown.
Those exist only on the tickets and in the already-computed day doc.

Likewise, `server.confirm*` (server confirmation speed, per staff) comes only
from session documents' `verifiedAt` / `verifyDurationMs`
(`backfill-core.ts:277-296`). Session documents are therefore **not** purgeable.

### 2.3 The landmine

`rebuildDailyAnalyticsFromReceiptsServer()`
(`src/lib/server/analytics/backfillServer.ts:22`) reads kitchentickets by
collection group (line 52) and writes the day doc with **`merge: false`** —
a full overwrite.

After a purge, a rebuild over a purged date range silently rewrites those day
docs with **zero** kitchen data. No error, no warning: the aggregate we are
relying on as the permanent record is destroyed by a rebuild that can no longer
see its source.

Reachable from two manual admin UIs:

| Path | Range |
|---|---|
| `src/app/admin/backfill/page.tsx:73` | arbitrary date range |
| `src/app/admin/reconcile/page.tsx:106,141,164` | single day / custom range |
| `src/app/admin/reconcile/page.tsx:182` | **an entire year** |

Reconcile is exactly the tool someone reaches for when numbers look off, so
this is a realistic path, not a theoretical one.

**Narrowing, verified:** the nightly `cron/reconcile-analytics` job is *not* a
rebuild. It calls `reconcileAnalyticsForAllStores()`, which applies pending
per-receipt deltas only — it contains no reference to the rebuild, to
kitchentickets, or to `merge: false`. The hazard is manual-UI-only, and no
unattended job can trigger it.

**Conclusion: the purge is safe if and only if the rebuild gets a horizon it
refuses to cross. The guard is not optional — it is what makes the purge safe.**

## 3. Scope

### Purge

| Target | Predicate | Justification |
|---|---|---|
| `stores/{s}/sessions/{id}/kitchentickets/*` | parent session terminal, older than horizon | Refills on the receipt; kitchen aggregates in the day doc (guarded) |
| `stores/{s}/sessions/{id}/sessionBillLines/*` | same | Snapshotted into `receipt.items` + `analytics.salesByItem` at payment |
| `pinRegistry/{pin}` | `expiresAtMs < now - 7d` (any status) | 2h TTL; doc id *is* the PIN, so stale docs also consume PIN space |
| `stores/{s}/customerRequests/*` | `createdAtClientMs < now - 90d` | Digest reads yesterday only (`daily-metrics-digest.ts:364`); admin page caps at `limit(1000)` (`admin/customer-requests/page.tsx:107`) |

A session is terminal when `status` is `closed`, `voided`, or `cancelled`, or
`isPaid === true` — matching the guards already used at
`firestore.ts:496`, `:906`, `:1099`.

**Session documents are timestamped `startedAtClientMs`, not
`createdAtClientMs`** (`firestore.ts:183`, `:248`). Kitchen tickets and customer
requests do use `createdAtClientMs`; the two are not interchangeable. A
Firestore range filter silently excludes documents missing the field, so the
wrong name returns zero rows and looks like a clean "nothing to purge". The
first census hit this and falsely reported zero sessions older than 30 days for
every store despite seven months of history. The purge carries an explicit
sanity check that aborts if a store has sessions but none carry the field.

### Never purge

`receipts`, `analytics` / `analyticsMonths` / `analyticsYears`, session
documents themselves (they carry `servedRefillsByName` and `verifyDurationMs`,
and the Postgres archive joins payments *through* the session),
`sessions/{id}/payments`, `customerFeedbackDays` (one doc per day, already
aggregated), `pointsLedger` / `loyaltyLogs` / `loyaltyRedemptions` (loyalty
balances).

### Retention horizon

**90 days**, not 30. Month-end reconcile of the previous month already lands
near a 30-day edge; 90 days gives real headroom and still clears the bulk.

## 4. Design

### 4.1 Retention horizon document

`stores/{storeId}/meta/retention`

```ts
{
  purgedBeforeMs: number,   // high-water mark; only ever moves forward
  lastRunAtMs: number,
  lastRunDeleted: { kitchentickets: number, sessionBillLines: number },
}
```

Written only by the purge job. `purgedBeforeMs` is monotonic — a run that would
move it backward leaves it unchanged.

**Ordering is a correctness requirement, not a detail.** The horizon must be
advanced to the run's cutoff **before the first delete batch commits** for that
store, never after the run completes. The dangerous state is *tickets deleted
for day D while the horizon still sits at or before D* — the guard would not
fire and a rebuild would zero real data. Writing the horizon first makes that
state unreachable, including when a run is interrupted mid-way. Over-coverage
(horizon ahead of what was actually deleted) is harmless by design: it only
preserves kitchen blocks for days whose tickets are still present, and those
blocks are identical to what a rebuild would recompute.

### 4.2 Purge script

`scripts/purge-dispensable.ts`, following the existing
`cleanup-archived-pins` shape (`CUSTOMER/src/app/api/admin/cleanup-archived-pins/route.ts`):
Admin SDK, batches of 500, cutoff-driven.

- **Dry run by default.** `--write` commits. `--store=<id>` scopes.
- Per store: query `sessions` `where('createdAtClientMs','<',cutoff)`,
  ordered, paged. Filter terminal status **in memory**.
- For each terminal session, delete its `kitchentickets` and `sessionBillLines`
  subcollections. The session doc and its `payments` subcollection are left
  untouched.
- A session past the horizon that is **not** terminal is skipped and reported
  as an anomaly — a 90-day-old open session is a data problem, not a purge
  candidate.
- On success, advance `purgedBeforeMs` for that store.

### 4.3 Rebuild guard — the load-bearing piece

In `rebuildDailyAnalyticsFromReceiptsServer()`:

1. Read `stores/{storeId}/meta/retention`.
2. For each `dayId` in the aggregate whose `dayStartMs < purgedBeforeMs`,
   read the existing day doc and **splice its `kitchen` block forward** into the
   new payload before the `merge: false` write.
3. `staffNames` is **merged, not replaced** — union of the preserved map and the
   freshly computed one, new values winning on key collision. It is written by
   both the kitchen block and the server-confirmation block, and the latter
   still recomputes from live session documents; a wholesale splice would
   resurrect stale names that the rebuild had correctly dropped.
4. Stamp `meta.kitchenPreservedFromPurge = true` on those days so the provenance
   is visible.
5. A missing retention document behaves as `purgedBeforeMs = 0` — no
   preservation, current behavior exactly unchanged. This keeps the guard inert
   on any store that has never been purged.

Preserve rather than refuse: reconcile is used to fix *money* numbers, and it
should still be able to do that on an old month without destroying kitchen
stats.

The same treatment applies to the `server.*` block if session documents are
ever added to the purge scope. They are not, today.

### 4.4 Pin and request cleanup

Extend the purge script with the two low-volume targets in §3. The existing
`cleanup-archived-pins` route only handles `status == "archived"`; pins that
expired without being archived (session ended with no reissue) linger forever.
This closes that gap.

### 4.5 Cron wiring

`src/app/api/cron/purge-dispensable/route.ts`, matching the existing cron
pattern exactly (`Authorization: Bearer ${CRON_SECRET}`, `runtime = "nodejs"`,
documented in `docs/CRON.md`). Scheduled via Google Cloud Scheduler alongside
the other seven cron routes.

## 5. Constraints

- **No new Firestore indexes.** `firestore.indexes.json` declares ~13 of ~57
  live indexes; a bulk `firebase deploy --only firestore:indexes` would offer
  to delete ~44 live indexes, including the `COLLECTION_GROUP kitchentickets`
  ones this rebuild depends on. The purge deliberately uses a single-field
  range query plus an in-memory status filter to avoid needing a composite
  index. If one turns out to be unavoidable, create it via the console
  error-link, never a file deploy.
- **Dry run is the default** on every entry point. Production deletion requires
  an explicit flag.
- **Do not push.** Build and smoketest on `sev5_advanced`; Ian pushes.

## 6. Testing

- Unit: the rebuild guard — a day before the horizon keeps its existing
  `kitchen` block; a day after the horizon is overwritten normally; a missing
  retention doc behaves as `purgedBeforeMs = 0` (no preservation, current
  behavior unchanged).
- Unit: terminal-session predicate against all of
  `closed` / `voided` / `cancelled` / `isPaid` / open.
- Unit: `purgedBeforeMs` monotonicity.
- Integration: dry run against production reports counts and writes nothing —
  verified by re-reading the retention doc and a sample session's subcollections.
- Integration: `--write` against the `TEST` store first, then one real store,
  then the rest — the staged pattern the archive backfill used successfully.
- Regression: run the rebuild over a purged range and confirm the day doc's
  kitchen numbers are unchanged.

## 7. Open items

- **Volume, partially measured 2026-08-22.** Global totals:
  42,640 `kitchentickets`, 17,008 `sessionBillLines`, 10,506 `payments`
  (never purged), 99 `refillItems`, 5,295 `pinRegistry` — of which **5,277 are
  already archived**, i.e. the existing `cleanup-archived-pins` route has never
  been run. ~10,269 sessions across 6 active stores (~4.2 tickets and ~1.7 bill
  lines per session).
- **The age split is still unmeasured.** The first census asked for sessions
  older than 30 days using `createdAtClientMs` and got zero everywhere — the
  wrong field (see §3). `census2.cjs` re-measures it per store using
  `startedAtClientMs`, plus a 25-session sample to estimate purgeable
  subcollection documents. Run it before implementing Tasks 4-7. If the estimate
  lands under ~10,000 tickets, land the guard and the pin sweep and defer the
  ticket purge.

## 8. Non-goals

- Archiving kitchen tickets to Postgres before deleting. The archive has no
  ticket table, and the only consumer of ticket detail is the aggregate already
  retained. Revisit only if ticket-level forensics is ever wanted.
- Purging receipts, sessions, or anything financial.
- Reconciling `firestore.indexes.json` (tracked separately).
