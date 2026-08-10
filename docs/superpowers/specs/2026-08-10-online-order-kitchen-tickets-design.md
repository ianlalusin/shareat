# Online Order Kitchen Tickets + KDS History Collapse — Design

**Date:** 2026-08-10
**Status:** Approved (pending written-spec review)
**Builds on:** the existing dine-in kitchen-ticket/KDS system; the online-ordering admin flow (`admin/online-orders`).

---

## 1. Background & goal

Dine-in orders already generate kitchen tickets that route to a per-store "kitchen location" (a physical prep station — Grill, Drinks, etc.) and show up on the `/kitchen` KDS screen. Online orders (placed via the public website, accepted by staff in the admin Online Orders page) have **zero** integration with this system today — clicking "Accept" only flips the order's status. The kitchen never sees these items unless a staff member manually says something out loud.

**Goal:** accepting an online order creates one kitchen ticket per line item (routed to that item's configured kitchen location) and forwards them onto the same KDS screen kitchen staff already watch, tagged as online so they're distinguishable from dine-in tickets.

**Second, independent goal (bundled here since it touches the same screen):** the KDS's order-history panel is a fixed sidebar column that's always visible, permanently taking a quarter of the screen. Make it collapsible so kitchen staff can reclaim that space for active tickets (this matters more once online orders start adding to the ticket volume on the same screen).

### Confirmed decisions (from brainstorming)
| Decision | Choice |
|---|---|
| "Destination locations" | Existing per-store kitchen **stations** (Grill/Drinks/etc.), not other branches |
| Missing station mapping | **Skip that item's ticket**, still accept the order — same as dine-in items with no `kitchenLocationId` today |
| KDS display | **Same queue** as dine-in, tagged "Online" + customer name instead of table |
| Online-order status vs. ticket status | **Independent** for v1 — no auto-advance; staff still manually moves the order through its own statuses |
| Ticket storage | Sibling `kitchentickets` subcollection **under the online order**, not a fabricated session |
| Online card visual treatment | Light-green-to-white gradient card, green border/identifier, "● Online" badge — confirmed via mockup |
| Late online ticket | Still flips fully red-bordered like any late ticket — lateness overrides the online treatment |
| History panel | **Collapse the existing sidebar column itself** (not a new floating overlay) |
| History panel default | **Collapsed** by default, remembers choice per device (localStorage) |

### Non-goals
- No auto-advancing online order status from ticket progress (explicitly deferred).
- No printing changes — online-order tickets follow the exact same offline-backup-print gating as dine-in tickets, no new logic there.
- No changes to `SyncKdsTicketsTool`'s query — verified it needs none (collection-group queries match by collection name regardless of parent path).
- Not fixing the pre-existing gap where some newer "08XX"-range numbers/products or other unrelated edge cases exist elsewhere in the app — out of scope.

## 2. Data model

`KitchenTicket` (`src/lib/types.ts:496-584`):
- `sessionId` becomes **optional** (`sessionId?: string`).
- New field: `onlineOrderId?: string` — the alternate back-reference. A ticket has exactly one of `sessionId` or `onlineOrderId` set, never both.
- No other new fields. `customerName?` already exists on the type and gets populated from `order.contact.name` for online tickets; the KDS card uses `onlineOrderId != null` to decide whether to render the online treatment (badge, gradient, customer-name-as-identifier) — no separate boolean flag needed.

Storage path: `stores/{storeId}/onlineOrders/{orderId}/kitchentickets/{ticketId}` — same collection *name* as the dine-in path (`sessions/{sessionId}/kitchentickets/{ticketId}`), different parent. This is deliberate: every existing `collectionGroup('kitchentickets')` consumer (the three Firestore indexes in `firestore.indexes.json`, `SyncKdsTicketsTool`'s rebuild query) matches by collection name regardless of parent path, so they pick up online tickets automatically with no changes.

## 3. Item → kitchen-location resolution

Online order lines (`OrderLine` in `OnlineOrdersClient.tsx`) carry no `kitchenLocationId` today — it must be resolved at accept-time from the store's catalog:

1. For each line, look up the store's `InventoryItem` record keyed by `variantId` if present, else `productId`.
2. Read `kitchenLocationId`/`kitchenLocationName` off that record.
3. No mapping found → skip this line (ticket not created for it), increment a `itemsSkipped` counter.

This mirrors exactly how dine-in tickets resolve their station today (§2 of the research: it's a denormalized field on the store's product/addon/package/refill record, copied onto the ticket at creation time — never a live category lookup).

## 4. Ticket creation

New function, `createOnlineOrderKitchenTickets()`, Admin SDK (this route already runs server-side — `onlineOrders` is server-write-only per `firestore.rules`), parallel to (not reusing) the client-SDK `createKitchenTickets()` in `cashier/firestore.ts`, since that one is built against `PendingSession`/client transaction types that don't apply here.

Runs **inside the same Firestore transaction** that flips the order's status to `"accepted"` in `src/app/api/admin/online-orders/route.ts` — the status change and ticket creation succeed or fail together atomically. For each line with a resolved kitchen location:

- Write one ticket doc under `stores/{storeId}/onlineOrders/{orderId}/kitchentickets/{ticketId}`: `itemId` (productId/variantId), `itemName` (line.name), `qty`, `modifiers`/`modifiersText` (from line.modifiers), `kitchenLocationId`/`kitchenLocationName`, `status: "preparing"`, `onlineOrderId: orderId`, `storeId`, `customerName: order.contact?.name`, `createdByUid` (the staff member who clicked Accept), `createdAt` (server timestamp), `createdAtClientMs`.
- Fan into `stores/{storeId}/rtKdsTickets/{kitchenLocationId}`: merge into `.tickets.{ticketId}`, `arrayUnion` into `.activeIds`. The `sessionIndex` map (keyed by session id in the dine-in model) reuses the same field keyed by `orderId` for online tickets — it's a bookkeeping lookup, not something that cares whether the key is semantically a "session."

The transition API response gains `ticketsCreated`/`itemsSkipped` counts so `OnlineOrdersClient.tsx` can toast e.g. "Order accepted — 3 kitchen tickets created (1 item has no station configured)."

## 5. KDS integration

- `updateTicketStatus`, `handleServeBatch`, `handleCancelRemaining` (`src/app/kitchen/page.tsx`) each get a small branch: when the ticket carries `onlineOrderId`, write status updates to `onlineOrders/{onlineOrderId}/kitchentickets/{ticketId}`; otherwise the existing `sessions/{sessionId}/kitchentickets/{ticketId}` path. Same pattern already used for the existing `type === "addon"` branch in these functions.
- `KdsItemCard` (`src/components/kitchen/kds-item-card.tsx`): when `ticket.onlineOrderId` is set, render the gradient card treatment (§7 of the mockup — light-green-to-white gradient, green border, green identifier text showing `customerName` instead of the red table label, "● Online" badge). A late online ticket (`isLate`) still gets the full red late-border, overriding the online treatment — lateness is the one signal nothing suppresses.
- `SyncKdsTicketsTool` — no changes needed (confirmed: its `collectionGroup('kitchentickets')` rebuild query is path-agnostic).

## 6. Error handling

- Per-line: no kitchen-location mapping → skip that line's ticket, count it, continue. Never blocks accepting the order.
- Whole-batch: if the inventory lookup itself errors (not "no mapping," an actual read failure), treat it the same as "nothing mapped" — log a warning, create zero tickets, still let the order accept. A kitchen-ticket-routing hiccup must never block the time-sensitive, customer-facing "order accepted" action.
- Ticket creation is inside the same transaction as the status flip, so there's no partial state where the order shows "accepted" but tickets silently failed to write for a reason *other* than "no mapping" — a transaction failure rolls back the whole accept, and the existing UI error path (the accept button's fetch failing) already surfaces that today.

## 7. Testing

- Unit tests for `createOnlineOrderKitchenTickets`: one ticket per mapped line; unmapped lines skipped and counted; correct `rtKdsTickets` fan-out per station; atomic with the status transition (extends `route.test.ts`).
- Tests for the `updateTicketStatus`/`handleServeBatch`/`handleCancelRemaining` online-order branch, confirming they write to the online-order path when `onlineOrderId` is set.
- A regression test confirming `SyncKdsTicketsTool`'s rebuild query picks up online-order tickets untouched (proving the collection-group path-agnosticism holds in this codebase's actual Firestore setup, not just in theory).
- Visual/manual check: accept a real online order with items across 2+ kitchen locations, confirm tickets appear on the correct station tabs on `/kitchen`, confirm the gradient card renders, confirm a late online ticket still shows the red late state.

## 8. KDS history panel collapse (independent change, same screen)

Today: `src/app/kitchen/page.tsx`'s outer grid (`grid grid-cols-1 xl:grid-cols-4`) always renders the ticket area at `xl:col-span-3` and `<HistoryView>` at a fixed `xl:col-span-1` — a permanent sidebar, not a floating panel.

**New behavior:**
- A new boolean state, `historyCollapsed`, initialized from `localStorage` (default **collapsed** if unset) and persisted on toggle — remembers the choice per device.
- **Expanded**: unchanged today's layout (`xl:col-span-3` / `xl:col-span-1`). Still just a grid column — can never overlap anything.
- **Collapsed**: the ticket area becomes `xl:col-span-4` (reclaims the full width — the "additional column for active KDS cards"), `<HistoryView>` is not rendered as a grid item at all, and a small touch-sized toggle button ("History ▸") sits fixed in the bottom-right corner of the screen to re-expand it.
- The toggle is sized for the kitchen's touchscreen display (matching the KDS's existing large touch targets, e.g. the `h-11` action buttons on ticket cards), not a small hover-only control.

### Testing
- Manual check: toggle collapse/expand, confirm the ticket grid actually gains/loses a column and no overlap occurs in either state.
- Confirm the collapsed preference survives a page reload (localStorage).

## 9. Affected code (initial map)

- `src/lib/types.ts` — `KitchenTicket.sessionId` optional, add `onlineOrderId?`.
- `src/app/api/admin/online-orders/route.ts` — new `createOnlineOrderKitchenTickets()` call inside the accept transition; response gains `ticketsCreated`/`itemsSkipped`.
- New: `src/lib/kitchen/createOnlineOrderKitchenTickets.ts` (or colocated in the route file — implementation-plan decision) — the ticket-creation function itself, plus the inventory-lookup helper.
- `src/app/kitchen/page.tsx` — `updateTicketStatus`/`handleServeBatch`/`handleCancelRemaining` online-order branch; `historyCollapsed` state + layout toggle.
- `src/components/kitchen/kds-item-card.tsx` — online-order visual treatment.
- `src/components/admin/online-orders/OnlineOrdersClient.tsx` — surface `ticketsCreated`/`itemsSkipped` in the accept toast.
- `src/app/api/admin/online-orders/route.test.ts` — new tests for the accept-path ticket creation.

## 10. Risks & mitigations

- **Risk:** forgetting the online-order branch in one of the three KDS status-transition functions, silently writing to a nonexistent session path. **Mitigation:** all three functions get the branch in the same pass; tests cover all three explicitly, not just `updateTicketStatus`.
- **Risk:** the inventory lookup adds latency to the accept transaction. **Mitigation:** reads happen via `tx.get()` inside the same transaction (already the pattern this route uses for its other pre-transition reads) — no separate round trip.
- **Risk:** collapsing history by default surprises an existing user expecting to see it. **Mitigation:** it's a one-tap toggle back, and the whole point of this change is that most of the time staff want ticket space, not history.

## 11. Sequencing (value early)

1. Data model change (`KitchenTicket` type) — no behavior change, pure prep.
2. `createOnlineOrderKitchenTickets()` + wiring into the accept transition + tests — this alone delivers the core value (tickets reach the kitchen).
3. KDS status-transition branches (serve/cancel/partial-serve working for online tickets) — required before online tickets are usable end-to-end, not optional.
4. Visual treatment (gradient card, badge) — cosmetic, can ship slightly after #2/#3 if needed, but small enough to bundle.
5. History panel collapse — fully independent, can ship before, after, or alongside the above in any order.
