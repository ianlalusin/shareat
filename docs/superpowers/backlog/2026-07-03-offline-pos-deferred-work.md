# Offline-First POS — Deferred Work Backlog

> Durable record of work deliberately deferred out of the shipped offline-first plans
> (Plans 1–5, Kitchen BT Printer, Plan A line-adjustments, Plan B void). Each item was a
> conscious decision — captured here so it isn't lost when the ledger scratch is cleared.
> Nothing below blocks the current on-device acceptance runs.

Working branch: `sev5_advanced` (origin = github.com/ianlalusin/shareat). Offline code under `src/lib/offline/` + `src/components/cashier/`.

---

## Plan 4B — Connectivity UX + Server-Side Guardrail Rules (deferred, not yet planned in tasks)

Plan 4 was split during execution: **4A** shipped the deferred-effects sync engine (correctness — outbox, idempotent replay, retry/backoff). **4B** is everything user-facing and the server-side hard guards, intentionally deferred until the offline write paths (Plans 3/5/A/B) were complete. It should be brainstormed → planned (`writing-plans`) → executed as its own plan when the user is ready. This section is the scope brief, not a task-by-task plan.

### 4B.1 — Connectivity UX
- **Reachability service:** a real online/offline signal beyond `navigator.onLine` (which reports "connected to a network" even when the internet/Firestore is unreachable). E.g. a lightweight periodic reachability ping to a Firestore doc / health endpoint, exposed through the existing `useOnlineStatus` hook so every offline branch keys off a trustworthy signal.
- **Offline banner:** a persistent, unobtrusive indicator when offline so the cashier knows writes are queued locally.
- **Unsynced count + sync-report UI:** surface the `offline_payment_queue` depth (pending payment + void items) and a drill-in report of what synced / what's still pending / what hit a terminal conflict. Today a sync conflict only raises a transient toast (`use-payment-queue-sync.ts:45`) and a terminal item sits `status:"failed"` in localStorage with no UI to inspect or retry it.

### 4B.2 — Guardrail rules (Firestore security rules — the "5a" hard prevention)
The offline write paths apply locally and sync on reconnect via `commitLocalFirst` / the outbox. A **stale local cache** can therefore clobber authoritative server state on sync. The client mitigations already in place (below) reduce the window, but the durable fix is server-side rules that reject the conflicting write outright.

- **5a — receipts (payment path).** Block a client write that would overwrite a *final, non-offline* receipt. Today the drain detects this and throws a terminal "Sync conflict" (`PaymentQueueSyncProvider.tsx`, the `kind !== "void"` receipt guard) — but detection happens *after* the local batch already committed; only a rule prevents the overwrite reaching the server. Rule intent on `stores/{storeId}/receipts/{sessionId}`: deny an update whose incoming doc has `offlineOrigin == true` when `resource.data.status == "final" && resource.data.offlineOrigin != true`.

- **5b — void of an already-finalized session (Plan B / review finding I3).** An offline void of a session that was already **paid/closed/voided on another device** LWW-clobbers the real outcome on sync (e.g. stamps `status:"voided"` over a paid sale, flips served tickets to cancelled, frees the table). The void path skips the receipt guard (voids have no receipt), so there is currently **no** terminal-conflict detection for voids at all. 
  - **Enabler already shipped:** the offline void stamps `offlineOrigin: true` on its session write (`offlineVoid.ts`, commit `ff3e5e5`), so a rule can distinguish an offline-origin void from the online transactional void.
  - **Rule intent** on `stores/{storeId}/sessions/{sessionId}` update: deny when the incoming write is an offline-origin void (`request.resource.data.status == "voided" && request.resource.data.offlineOrigin == true`) **and** the existing server doc is already finalized (`resource.data.status in ["closed","voided"] || resource.data.isPaid == true`). The online void (runs in a `runTransaction` that re-reads, no `offlineOrigin` stamp) is unaffected.
  - When the rule rejects the batch, the whole void batch fails on sync and surfaces via `commitLocalFirst`'s `onError` → this should feed the 4B.1 sync-report so the cashier is told the void was rejected (the session was already settled elsewhere).
  - **Note:** because the rule fails the *entire atomic batch*, verify the void batch doesn't bundle any write that must succeed independently. It doesn't today (tickets/projection/table are all part of the same void and should all roll back together), but re-check when the rule lands.

### 4B — acceptance
On-device: force a stale-cache conflict (finalize a session on device B while device A is offline, then void it offline on A and reconnect) → device A's write is rejected server-side, the real server state is preserved, and the sync-report shows the rejection. Plus the receipt 5a equivalent.

---

## Minor follow-ups from the Plan B whole-branch review

These are Minor severity — safe to leave, cheap to fix. Not scheduled; fold into a future offline touch-up commit.

### M2 — offline void enqueues a marker + toasts "will sync" even when there's nothing to sync
- **Where:** `src/components/cashier/void-session-dialog.tsx:103` (the offline branch's `addToQueue({ …, kind: "void", … })`).
- **Behavior:** a void of a session with **no PIN and no loyalty redemptions** still enqueues an outbox item whose effects are all `"skip"`, and still toasts "Loyalty/PIN will sync when back online" (`:117`). The item is harmless — it self-completes and is removed on the first drain pass — but it's pure queue/toast noise and the toast is slightly misleading (nothing will sync).
- **Fix:** guard the enqueue so a fully-skip void doesn't queue:
  ```ts
  if (pin || reversedRedemptionIds.length > 0) {
    addToQueue({ /* …existing… */ });
  }
  ```
  Keep the `toast` + `onClose()` unconditional. Optionally soften the toast copy when nothing is deferred (drop the "Loyalty/PIN will sync" clause).

### M3 — reconnect drain toast says "sale" for a void
- **Where:** `src/hooks/use-payment-queue-sync.ts:37` — on a completed drain: `toast({ title: "Offline sale synced", description: \`Session …… finalized.\` })`. This fires for **both** payment and void items; `item` (with `item.kind`) is in scope.
- **Behavior:** a voided session is not a "sale" — cosmetic mislabel only.
- **Fix:** branch the copy on kind, e.g.:
  ```ts
  const isVoid = item.kind === "void";
  toast({
    title: isVoid ? "Offline void synced" : "Offline sale synced",
    description: `Session ${item.sessionId.slice(0, 6)}… ${isVoid ? "voided" : "finalized"}.`,
  });
  ```

---

## Accepted as-is (recorded for context, no action planned)

- **M1 — rtKds station-doc update in the offline void is unguarded** (`offlineVoid.ts`, the `batch.update(rtKdsTickets/{station}, …)` in the ticket-cancel loop). Same batch-atomicity class as the table-guard that *was* fixed (I1): if the station doc is absent from the local cache, the whole void batch fails on sync. Left unguarded deliberately — the station doc reliably exists server-side, it mirrors the online `voidSession`, and per-station existence reads would add a `getDoc` per ticket. If the 4B sync-report ever shows void batches failing on a station-doc precondition, revisit with the same `getDoc`+`exists()` guard used for the table.
