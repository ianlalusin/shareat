# Offline-First POS (Cashier) — Design

**Date:** 2026-07-01
**Status:** Approved (pending written-spec review)
**Approach:** Robust offline-first inside the existing Capacitor/Next.js web app. **No Flutter, no native rewrite. One codebase.**

---

## 1. Background & problem

The POS ships as an Android APK via **Capacitor**, bundling the Next.js static export (`webDir: out`) so it opens and runs locally (`appId: net.shareat.pos`, "SHAREAT POS"). Firestore is already initialized with offline persistence (`persistentLocalCache` + `persistentMultipleTabManager`).

Despite this, cashiers **cannot start a session, open billing, or take payment while offline**. Investigation found the root cause is **not** Capacitor and **not** something a Flutter/native rewrite would fix for free:

- `startSession()` and `completePaymentFromUnits()` (and `voidSession()`, `createKitchenTickets()`) are built on **`await runTransaction(...)`**. **Firestore transactions require a live server round-trip and fail when offline** — by design. The Flutter/mobile Firestore SDK behaves identically, so a rewrite would face the same redesign plus a full port of ~9,300 lines of cashier logic.
- Plain writes and **`writeBatch().commit()` queue in the local cache and sync later** (e.g. `updateSessionBillLine`, `removeLineAdjustment` already work this way — bill editing likely already works offline).
- The receipt/OR number is minted **inside** the payment transaction from a shared server counter (`stores/{storeId}/counters/receipts`), which is both offline-incompatible and collision-prone across devices.
- A few critical-path calls hit `/api/*` server routes (loyalty, PINs, analytics deltas). The Capacitor build excludes server routes, so these are inherently online-only and must be **deferred**, never block the sale.

Printing is already offline-capable: `receiptFormatter.ts` builds ESC/POS text locally; `printHub.ts` sends it over **Bluetooth (Capacitor plugin) or WebUSB** (local transports). The only network dependency is the logo image, already cached in `localStorage` with graceful skip.

## 2. Goals

Run a **full shift with no internet**. The app must:

1. Open **cold** (after app kill / device reboot) and load menu, prices, option groups, store config, payment methods, tables, and receipt settings from cache.
2. Let a cashier **fully offline**: start a session (dine-in / walk-in / ala carte), take/edit orders, take payment (all methods, record-only), print the receipt, print kitchen tickets, void/cancel a session, and view/reprint past sessions (at least today's).
3. **Sync exactly once** on reconnect, with a human-readable sync report and no silent data loss.

### Non-goals
- Processing card/e-wallet through a payment gateway (the POS only **records** tender; there is no gateway).
- Real-time cross-device sync while both devices are offline (Firestore syncs via cloud; impossible without connectivity).
- Offline loyalty earn/redeem (see §8).
- Any Flutter or native (React Native) rewrite.

## 3. Confirmed requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Direction | **B** — robust offline-first in Capacitor, not Flutter |
| Payment methods offline | **All** methods, record-only (no gateway) |
| Receipt numbering offline | **Offline-marked, device-time + local daily sequence**: `<storeCode>-OL-<HHMM>-<NNN>` (e.g. finalized 3:20 AM → `SHT-OL-0320-001`). Store has ≤2 POS that never operate concurrently, so no cross-terminal collision. `-OL-` marks offline-origin sales; kept permanently after sync. |
| Concurrency model | Rare overlap → **soft ownership + last-write-wins on monotonic revision + sync report** |
| Offline duration | **Full shift / whole day**, cold-start + durable outbox surviving reboot |
| Offline op scope | Start session, edit billing, take payment, **print receipt**, **kitchen tickets**, **void/cancel**, **view/reprint past sessions** |
| Kitchen tickets offline | Print to **local Bluetooth/USB** kitchen printer; networked KDS screen catches up on reconnect |
| Loyalty offline | **No** — deferred/online-only (avoids point double-spend) |

## 4. Architecture

### 4.1 Core fix — replace offline-incompatible primitives

| Operation | Today | Change |
|---|---|---|
| `startSession` | `runTransaction` | `writeBatch` (session + table + projection), pre-generated local doc id (already done), local `startedAtClientMs` (already done) |
| `completePaymentFromUnits` | `runTransaction` + server counter | Local offline receipt number + `writeBatch` (receipt + session close + projections) |
| `voidSession` | `runTransaction` | `writeBatch` with audit stamp |
| `createKitchenTickets` | runs inside `tx` | batch/local write + local print |
| Receipt number (offline) | server counter in tx | **offline-marked local number** `<storeCode>-OL-<HHMM>-<NNN>` from device clock + local daily sequence |

`writeBatch` is atomic **and** offline-capable — it applies to the local cache immediately and flushes to the server on reconnect. This single change unblocks the offline critical path. Where a transaction currently exists only to atomically touch multiple docs (session + table + projection), a batch preserves that atomicity offline.

### 4.2 New components

1. **Device identity** (`src/lib/offline/terminal.ts`)
   - Lightweight persistent `deviceId` (uuid) + optional label, stored on-device (localStorage + mirrored in IndexedDB).
   - Used for the `ownerTerminalId` soft-ownership stamp and sync-report attribution. **Not** required for receipt numbering (the `-OL-` + store code + device time + local sequence is collision-safe given ≤2 non-concurrent POS per store).

2. **Offline receipt numbering** (`src/lib/offline/localCounter.ts`)
   - Builds the offline number `<storeCode>-OL-<HHMM>-<NNN>` from the **device clock** at finalization + a **local daily sequence** (`NNN`) persisted in IndexedDB, resetting each day.
   - The local sequence is the tiebreaker guaranteeing uniqueness when two sales land in the same minute; the `-OL-` marker distinguishes offline-origin sales for audit/reconciliation.
   - Increment guarded by an IndexedDB transaction (single-writer) so concurrent tabs can't reuse a sequence.
   - Online sales keep the existing server-counter OR format unchanged; only offline-finalized sales use this format, and they **retain their OL number permanently** after sync (never retro-renumbered — the physical receipt already shows it).
   - **Uniqueness scope:** the OL number has no date component, so it is unique only within **(store, day)** — `SHT-OL-0320-001` recurs across days. Always store/query it **paired with its finalize date**; never use the OL string as a standalone unique key.
   - **Concurrency/atomicity note:** the local daily sequence must be incremented by a **single-writer inside an async IndexedDB transaction** (Firestore runs `persistentMultipleTabManager`, so multiple tabs are a real race). A synchronous localStorage read-modify-write is only the reference rule, not the atomic allocator.
   - **Never blocks the sale:** if the persisted sequence state is unreadable/corrupt the allocator refuses (throws) rather than risk a duplicate OR number; the payment path must catch this and recover (re-init today's counter / surface to the sync report), never crash the sale.

3. **Durable outbox** (`src/lib/offline/outbox.ts`)
   - IndexedDB-backed queue of **intents**: `start-session`, `add/adjust-line`, `payment`, `void`, `kitchen-ticket`, and `deferred-side-effect` (loyalty/PIN/analytics).
   - Each intent carries an **idempotency key** (deterministic from terminal + local id + op) so replay after a mid-sync crash never double-applies.
   - Survives app kill / device reboot; replayed on next launch.
   - This is the trustworthy layer B adds over Firestore's own cache: Firestore's cache handles its own document writes, but the outbox additionally captures **server-only side effects** the cache cannot, and gives us an explicit, auditable, inspectable sync state + report.

4. **Sync engine** (`src/lib/offline/syncEngine.ts` + `src/hooks/use-payment-queue-sync.ts` upgraded)
   - On reconnect (and on app launch if items pending), drains the outbox **in order**, idempotently.
   - Replays deferred **online-only side effects** (loyalty earn/redeem, PIN finalize/disable, analytics deltas) against the live backend.
   - Marks items done; emits a **sync report** (counts, failures, flagged conflicts).
   - Absorbs the existing ad-hoc `payment-queue.ts` (localStorage) into the unified outbox.

5. **Connectivity service** (`src/hooks/use-online-status.ts` upgraded + `src/lib/offline/connectivity.ts`)
   - Beyond `navigator.onLine` (which only reports the network interface): a debounced **reachability probe** (lightweight request to backend) for true online/offline state.
   - App-wide status via context; drives a persistent **offline banner** and an **"N unsynced" indicator**, plus a "sync now" action.

### 4.3 Representative data flow — offline payment

1. Confirm payment → allocate **local receipt number** from the terminal counter.
2. `writeBatch`: write receipt doc, close session, update projections → applied to local cache immediately; UI proceeds instantly.
3. Enqueue **deferred side effects** (loyalty earn, PIN finalize, analytics delta) into the outbox — these do **not** block the sale.
4. **Print** receipt locally (Bluetooth/USB) with the final offline number (`<storeCode>-OL-<HHMM>-<NNN>`).
5. On reconnect: Firestore flushes the batch; sync engine replays side effects idempotently; sync report confirms.

Start-session, void, and kitchen-ticket follow the same **local-first write → enqueue side-effects → sync** pattern.

### 4.4 Conflict handling (rare by design)

- **Soft ownership:** each session stamps `ownerTerminalId`; another terminal editing offline is allowed but flagged.
- **Monotonic `revision`** per session; on sync, higher revision wins at document level (last-write-wins).
- **Sync report** surfaces genuine clashes (e.g. two sessions seated on one physical table offline) for a human to reconcile. No silent loss.

### 4.5 Full-day offline readiness

- **Pre-cache while online / on login:** menu + products + option groups, prices, store config, payment methods, tables, receipt settings, cached logo. Firestore listeners hydrate `persistentLocalCache`; we explicitly warm the critical reads and add a manual "refresh reference data" action.
- **Outbox durability:** IndexedDB; replayed on next launch; idempotency keys prevent double-apply after a reboot mid-sync.

## 5. Stays online-only (deferred, never blocks offline)

Loyalty lookup/earn/redeem, PIN finalize/disable, server analytics deltas (`/api/analytics/apply-delta`), guest-count server verification, and anything behind `/api/*`. All queue as deferred side effects and replay on reconnect.

## 6. Affected code (initial map)

- `src/components/cashier/firestore.ts` — convert `startSession`, `completePaymentFromUnits`, `voidSession`, `createKitchenTickets` from transaction to batch + local numbering.
- `src/lib/offline/` — new: `terminal.ts`, `localCounter.ts`, `outbox.ts`, `syncEngine.ts`, `connectivity.ts`; fold in existing `payment-queue.ts`.
- `src/hooks/use-online-status.ts`, `src/hooks/use-payment-queue-sync.ts` — upgrade.
- `src/components/cashier/payment-modal.tsx`, `start-session-form.tsx`, `session-detail-view.tsx` — use local-first paths + surface offline/unsynced UI.
- Reference-data caching hook(s) for cold-start warming.
- Printing (`printHub.ts`, `receiptFormatter.ts`) — no transport change; ensure receipt data available locally at print time (it will be).

## 7. Testing strategy

- **Unit:** local counter (gapless, per-terminal, reboot-safe); outbox (enqueue/drain/idempotency/replay-after-crash); batch builders per op; receipt-number formatting with terminal segment.
- **Integration:** airplane-mode simulation — start → order → pay → print → void fully offline, then reconnect and assert **exactly-once** sync, correct per-terminal receipt numbers, and correct projections.
- **Manual (on-device APK):** real thermal printer (receipt + kitchen), toggle real connectivity across a full mock shift, cold-start after reboot with pending outbox.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Two offline devices seat the same table | Soft ownership + sync report flags for human reconcile |
| Batch loses atomicity guarantees a tx gave | Group each op's writes in one `writeBatch`; verify invariants in tests |
| Reference cache cold/empty when going offline | Explicit warm-on-login + "refresh reference data"; block offline mode if never warmed |
| Mid-sync crash double-applies side effects | Idempotency keys + server-side idempotent replay |
| Networked KDS screen expects live tickets offline | Out of scope by decision; local kitchen printer covers offline; KDS catches up on reconnect |
| Loyalty point double-spend offline | Loyalty stays online-only/deferred |

## 9. Implementation sequencing (value early)

1. Terminal identity + local receipt counter.
2. Convert `startSession` → batch (**unblocks offline sessions**).
3. Convert payment → batch + local number + print (**unblocks offline sales**).
4. Durable outbox + sync engine + idempotency for deferred side effects.
5. Void + kitchen tickets offline.
6. Connectivity UX (banner, unsynced count, sync report) + cache warming.
7. On-device test pass.

## 10. Resolved with reviewer (2026-07-01)

- **Receipt numbering:** device-clock time + local daily sequence, offline-marked — `<storeCode>-OL-<HHMM>-<NNN>` (e.g. `SHT-OL-0320-001`). Safe because a store runs ≤2 POS, never concurrently. No reserved per-terminal prefixes needed.
- **Kitchen model:** local Bluetooth/USB printer for offline; networked KDS screen catches up on reconnect. ✅
- **Loyalty:** stays deferred / online-only (avoids point double-spend). Recording the sale offline is sufficient; earn/redeem replays on reconnect. ✅
- **Device setup:** no per-terminal receipt prefix required; a lightweight `deviceId` is generated on first launch purely for ownership/audit attribution.
