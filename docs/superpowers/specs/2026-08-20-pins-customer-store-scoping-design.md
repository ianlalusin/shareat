# /pins Customers Tab — Store Scoping

Date: 2026-08-20
Status: Approved, implementing

## Problem

The Customers tab on `/pins` shows every Sharelebrator customer to every
active staff member at every branch. A manager at Lipa can browse the
full customer base — names, phone numbers, points balances — and the
cross-branch audit log with it.

Customers must stay free to dine at any branch, so the fix is not to
partition customer records by store. The fix is to scope *visibility*
to the customers a store is actually serving.

## Access model

| Role | List | Lookup | Reset password |
|---|---|---|---|
| cashier / server / kitchen | scoped | scoped | no |
| manager | scoped | scoped | yes, in scope |
| admin / `isPlatformAdmin` | global | global | global |

"Scoped" means the customer satisfies at least one of:

1. **Here now** — linked to an open session at this store
   (`stores/{storeId}/activeSessions/{id}.linkedCustomerPhone`).
2. **Recent** — any loyalty event at this store within the last
   **2 hours** (login, signup, points earned).

The window survives the session ending, so a manager can still pull up
points or reset a passcode for a customer who just walked out.

## The stale walk-in

A customer who last visited this store days ago walks up and asks for a
passcode reset. They are outside the window, so the manager cannot see
them.

**Resolution: an admin resets it.** Admins are global by design, so the
capability already exists — the escape hatch is a human escalation, not
a code path. This was chosen over a degraded "walk-in card" (exact-phone
lookup returning a stripped record) because that card would have been a
second, weaker access surface to keep correct and audit forever, to
serve a case that escalation already covers.

For the escalation to work the UI must name it. An out-of-scope search
returns:

> Not active at {Store}. This customer's record is held at another
> branch — ask an admin to reset.

This confirms the phone is registered somewhere, which is an accepted
trade: the manager is holding a number the customer just handed them,
so there is nothing to enumerate, and a bare "not found" is
indistinguishable from a typo and would strand the customer at the
counter.

## The OR-semantics trap

`firestore.rules` ends with two catch-all blocks granting `read` on
every collection to any active staff, minus a short exclusion list:

```
match /{collection}/{docId} { allow read: if isActiveStaff() && collection != ... }
match /{collection}/{docId}/{docPath=**} { allow read: if isActiveStaff() && collection != ... }
```

Firestore rules OR together. Tightening `match /customers/{phone}` to
`allow list: if isAdmin()` is therefore a **no-op** — the catch-all
still grants it, and the guard would exist only in the UI.

`customers`, `loyaltyLogs`, and `loyaltyLogsDaily` must be added to the
exclusion list in **both** blocks. The `{docPath=**}` block matches
zero-or-more segments, so it also matches the parent doc itself and
needs the identical exclusions — the file's own comment records this
having been confirmed against the emulator for `paymongoIntentIndex`.

## Presence resolution

`src/lib/server/loyaltyPresence.ts`, Admin SDK, shared by both routes:

1. `stores/{storeId}/activeSessions` where `linkedCustomerPhone != null`
   → presence `active`.
2. `loyaltyLogsDaily/{dayId}_meta` + parts for today and yesterday
   (Manila), filter `entries[]` by `storeId` and
   `createdAtMs >= now - 2h` → presence `recent`.
3. `getAll()` on the resulting `customers/{phone}` for name and balance.

Yesterday is read because the 2h window crosses Manila midnight.

**No new composite index**, deliberately. `firestore.indexes.json`
declares 15 indexes against roughly 57 live, so any
`firebase deploy --only firestore:indexes` would delete the ~44
undeclared ones. Reading the daily projections costs ~4-8 doc reads per
refresh and avoids the question entirely. The cost is that the list
polls (30s) rather than using a live listener.

## Files

| File | Change |
|---|---|
| `firestore.rules` | Exclusions in both catch-alls; `list: if isAdmin()` on the three collections; `get` kept for staff |
| `src/lib/server/loyaltyPresence.ts` | New — resolver |
| `src/app/api/loyalty/store-customers/route.ts` | New — scoped list |
| `src/app/api/loyalty/lookup/route.ts` | `storeId` param, scope check, out-of-scope response |
| `src/components/pins/customers-admin.tsx` | Takes `storeId`; drops both client listeners |
| `src/app/pins/pins-client.tsx` | Passes `storeId` |

`OnlineOrdersClient.tsx:303` does an exact-phone `getDoc` on
`customers/{phone}`, so `get` stays open to active staff.

## Testing

- `npm run test:rules` — a manager cannot `list` customers, and cannot
  reach them through the catch-all either. The second assertion is the
  one that catches the OR-semantics trap.
- vitest on the resolver: in-window, out-of-window, Manila midnight
  rollover with `TZ` pinned (server-side date math here is
  Manila-specific and passes spuriously under UTC).
- vitest on the lookup route: in-scope hit, out-of-scope message, admin
  bypass.

## Not in scope

- Per-store `presenceWindowMinutes` config. 2h is a single named
  constant; promote it if branches diverge.
- Rate limiting. Admin escalation is already the bottleneck.
