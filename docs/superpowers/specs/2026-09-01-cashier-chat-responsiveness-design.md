# Cashier chat responsiveness — design spec

Date: 2026-09-01
Repos touched: Shareat Website (no changes — read-only context), POS, ERP-rebuild

## Problem

The website live chat (customer → store, cashier replies from POS's `ChatInbox`)
has no responsiveness measurement today. We want to:

1. Track how many customer chat messages get answered, and whether within a
   2-minute standard.
2. Surface this on the POS printed daily sales report, next to the existing
   "Avg confirm (server)" service-time line.
3. Feed it into the ERP "Team Performance" score as a new cashier dimension.
4. Attribute fairly: a cashier who inherits an already-stale, unanswered
   message from a shift handover must not be penalized for the wait that
   happened before they were on duty — but the cashier who was on duty when
   the message arrived and never answered it *should* be dinged.

## Current state (relevant facts from exploration)

- Chat threads live in Firestore project `shareat-hub-v2`, path
  `stores/{storeId}/chatThreads/{threadId}`, messages subcollection
  `.../messages/{msgId}` with `sender: "customer"|"staff"`,
  `createdAtClientMs`. No response-time field exists today.
- Cashier replies are composed client-side in
  `POS/src/components/cashier/ChatThreadPane.tsx` → `sendReply()` (POS repo),
  a direct Firestore client-SDK write (no Cloud Function in the path).
- `ChatInbox` (`POS/src/components/cashier/ChatInbox.tsx`) is mounted only in
  the cashier session-list view (`session-list-view.tsx:324`) — not on
  KDS/server station views. It reads `currentProfile` from
  `useLocalProfile()`.
- "Who's logged in" on a POS device is `currentProfile` from
  `useServerProfile()` (`POS/src/hooks/useServerProfile.ts`) — a PIN-based
  local-profile switch persisted **only in that device's `localStorage`**, no
  server record, no timestamp history. This is the gap that has to be filled
  to know "who was on duty when a message arrived."
- The existing per-day analytics rollup (`stores/{storeId}/analytics/{dayId}`)
  already carries this exact shape for kitchen/server service times —
  incremented client-side in `applyKdsTicketDelta.ts`, per-local-profile
  buckets (`kitchen.servingMsSumByUser.{profileId}` etc.), with a
  `staffNames.{profileId}` mirror for display. The printed report
  (`salesReportFormatter.ts`) and its aggregator
  (`SalesReportPageClient.tsx`) already sum these across day-docs. This
  pattern is mirrored for chat.
- ERP's cashier/staff score (`ERP-rebuild/src/lib/performance/score.ts`,
  `computeStaffScore()`) is a weighted average of independent 0–100
  dimensions (nulls drop out, weight redistributes). POS→ERP data crosses via
  `POS/src/app/api/external/staff-metrics` (already returns `avgServeMs` /
  `avgConfirmMs` per profile per day; extended here to also return chat
  counts).

## Data model additions

### 1. Presence log (POS, new) — `stores/{storeId}/chatPresenceLog/{eventId}`

```ts
{
  profileId: string;
  profileName: string;
  event: "signin" | "signout";
  atClientMs: number;
  atServer: Timestamp; // serverTimestamp()
}
```

Written fire-and-forget from `ChatInbox.tsx` (the cashier-station-scoped
mount point — deliberately **not** the store-wide `LocalProfileProvider`,
which also fires for KDS/server stations that have nothing to do with chat
duty) via a `useEffect` on `currentProfile` changes: a `signout` for the
previous profile (if any) immediately followed by a `signin` for the new one,
and a `signout` on unmount.

Lookup helper (used at message-answer time): "who was on duty at time T" =
the most recent `signin` event with `atClientMs <= T` for which no `signout`
for that same profile exists with `atClientMs` between that signin and T.
Simplifies in the common case to "latest event ≤ T; if it's a signin, that
profile is on duty; if signout or no event, nobody is on duty" — no need to
handle overlapping profiles since a device has one `currentProfile` at a
time.

### 2. Per-message response stamping (POS, new fields on existing docs)

On `stores/{storeId}/chatThreads/{threadId}/messages/{msgId}` (customer
messages only):

```ts
{
  // existing fields unchanged...
  respondedAtClientMs?: number;
  responseMs?: number;              // respondedAtClientMs - createdAtClientMs
  respondedByProfileId?: string;
  respondedByName?: string;
  onDutyProfileIdAtArrival?: string | null; // for audit + miss attribution
}
```

Computed in `ChatThreadPane.sendReply()`: before writing the staff message,
query the thread's messages where `sender == "customer"` and
`respondedAtClientMs` is unset, created before `now`. For each:
- Stamp `respondedAtClientMs`, `responseMs`, `respondedByProfileId/Name` from
  the current local profile.
- Look up `onDutyProfileIdAtArrival` via the presence-log helper above, using
  the message's own `createdAtClientMs`.
- Also look up the responder's own most recent `signin` ≤ `now` to get their
  on-duty-start; the "fair" elapsed time used for scoring is
  `now - max(createdAtClientMs, responderOnDutyStart ?? createdAtClientMs)`.

A single staff reply can answer multiple queued customer messages (one reply
covering a customer's burst of 2–3 messages) — each gets its own fair elapsed
time computed independently since their arrival times differ.

### 3. Daily rollup (POS, new fields on existing `analytics/{dayId}` doc)

Mirrors the existing `kitchen.*ByUser` / `server.*ByUser` shape:

```ts
chat: {
  // Timeliness — credited to the RESPONDER, using the fair elapsed time.
  responseMsSumByUser: Record<profileId, number>;
  responseCountByUser: Record<profileId, number>;
  within2MinCountByUser: Record<profileId, number>;

  // Efficiency — credited to whoever was ON DUTY AT ARRIVAL.
  receivedWhileOnDutyByUser: Record<profileId, number>;
  answeredWhileOnDutyByUser: Record<profileId, number>; // subset personally answered by that same on-duty user

  totalReceived: number; // store-wide gate for "did this day have chat interaction"
}
```

Written alongside the message-stamping step in `sendReply()`, batched with
the existing thread-update write. Same day/month/year fan-out as
`applyKdsTicketDelta.ts` (`analytics/{dayId}`, `analyticsMonths/{monthId}`,
`analyticsYears/{yearId}`).

Note the efficiency counters are keyed by the **on-duty-at-arrival** profile,
independent of the timeliness counters (keyed by **responder**) — this is
what lets cashier 1 take the efficiency hit for an unanswered message while
cashier 2 only ever gains timeliness credit for answering it.

## Scoring formula (shared spirit, computed independently per surface)

Per cashier, per period (day for the printed report, month for ERP):

```
timeliness = within2MinCount / responseCount        (null if responseCount == 0)
efficiency = answeredWhileOnDuty / receivedWhileOnDuty (null if receivedWhileOnDuty == 0)
score = 80% * timeliness + 20% * efficiency          (100-scaled; a null side drops out,
                                                        the other side's weight covers 100%;
                                                        both null => no score, dimension N/A)
```

Rating buckets (both surfaces): `<20` very poor, `20–40` poor, `40–60`
average, `60–80` good, `≥80` very good.

This mirrors the *formula*, not a shared code path — POS computes it daily
(store level, `salesReportFormatter.ts`) from that day's raw rollup;
ERP computes it monthly (per cashier) from raw counts pulled via the
extended `/api/external/staff-metrics` endpoint, in a new
`chatResponsivenessScore()` function in `score.ts`. Same precedent as how
`avgServeMs`/`avgConfirmMs` already cross that bridge as raw numbers, not a
pre-computed score.

## POS printed report changes

`salesReportFormatter.ts`, inside the existing "SERVICE TIMES" block, after
the "Avg confirm (server)" lines:

```
Chat response avg      1m 42s
Chat answered <2min     83%
Chat rating            GOOD
```

Gated entirely on `totalReceived > 0` for that day — the whole block is
omitted otherwise, per the "don't show days with no chat interaction"
requirement. `SalesReportPageClient.tsx`'s aggregator gets a sibling function
to `aggregateServiceTimes()` that sums the new `chat.*` rollup fields the
same way.

## ERP performance score changes

`src/lib/performance/score.ts`:
- New `StaffScoreMetrics` fields: `chatResponseCount`, `chatWithin2MinCount`,
  `chatReceivedWhileOnDuty`, `chatAnsweredWhileOnDuty` (nullable-by-absence,
  same convention as `avgServeMs`).
- New `chatResponsivenessScore()` — absolute (no cohort needed, since the
  2-minute standard is fixed, not relative), same 80/20 formula above.
- New `StaffScoreBreakdown.chatResponsiveness` and
  `ScoreWeights.chatResponsiveness`, added to `DEFAULT_SCORE_WEIGHTS` with a
  starting weight of 15 (tunable in the existing
  `manager/staff-hub/performance-config` UI like every other weight).
- This is a **separate dimension from the existing `responsiveness`**
  (manager-only OIL-briefing score) — different population, different
  meaning, must not collide.
- `staff-perf-month.ts`'s `collectPosStaffMetrics` step pulls the new chat
  counts from the extended `/api/external/staff-metrics` response and sums
  them across the month, same as it already does for serve/confirm times.

## Out of scope / explicitly deferred

- Multi-terminal stores with more than one concurrently-active cashier
  profile are not disambiguated — the presence log is per-store, last-writer
  wins. Acceptable for the current single-front-register store model; a
  future device-scoped presence log would be a separate change if that
  assumption stops holding.
- No changes to the Shareat Website repo — the customer-facing widget and
  Cloud Functions are untouched; all new logic lives on the POS (staff) side
  of the existing shared Firestore project.
- No changes to `chatThreads` document shape beyond the new message-level
  fields — thread-level `lastMessage*` fields are unchanged.

## Testing plan

- POS: unit-test the fair-elapsed-time and on-duty-lookup helpers (pure
  functions extracted for testability, mirroring how `applyKdsTicketDelta`
  keeps its delta math separate from the Firestore write). Smoketest
  `ChatInbox`/`ChatThreadPane` in dev (send a customer message via the
  website chat widget or a seeded doc, reply as a cashier, confirm the
  rollup increments and the printed report renders the new block — and that
  it's absent on a day with zero chat messages).
- ERP: unit-test `chatResponsivenessScore()` (mirrors existing dimension
  test patterns in `score.ts`'s test file, if any exists — check first).
  Confirm the new dimension appears in the performance-config weight UI and
  the Team Performance page without breaking existing dimensions.
- Cross-repo: verify the extended `/api/external/staff-metrics` response
  shape against what `staff-perf-month.ts` expects before wiring the ERP
  side.

## Push plan

- POS: build + typecheck + smoketest, then push to `sev5_advanced` (explicit
  in-session request to push covers this repo's normal "Ian pushes" default).
- ERP-rebuild: push to the feature branch and `upgrade-next16`.
- Shareat Website: no code changes, nothing to push.
