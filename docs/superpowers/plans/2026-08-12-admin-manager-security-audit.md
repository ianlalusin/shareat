# Admin & Manager Security Audit — 2026-08-12

Security-focused sweep of the admin and manager domains in POS (API routes, client pages, Firestore rules), done incidentally alongside a general bug-gap/cleanup pass.

## Priority Summary

TL;DR ordered list of every Critical/High finding, most-actionable-and-severe first:

1. **[Critical] `storeConfig` doc writable by any active staff — direct cash-theft vector.** `firestore.rules` `isConfigCollection()` (line 64-69) omits `storeConfig` from its allow-list, so the catch-all at lines 265-274 lets any `hasStoreAccess(storeId)` staffer (cashier included) write it with no `isManagerOrAdmin()` check; `src/lib/billing/adjustments.ts:13` reads this doc as the checkout source of truth. See finding below.
2. **[Critical] `stores/{storeId}` document has no role gate on write/delete.** `firestore.rules:221-223`. Confirmed independently by three separate audit passes (Firestore rules, manager domain, admin pages).
3. **[Critical] `option-overrides` route has no store-scope check.** `src/app/api/admin/option-overrides/route.ts`. Confirmed independently by the manager-domain audit.
4. **[Critical] No server-side gate on `/admin/**` pages at all.** `src/components/guards/RoleGuard.tsx` is client-only; no `src/app/admin/layout.tsx`; `src/middleware.ts` matcher is API-only. Architectural gap — flagged for a dedicated follow-up, not a quick patch.
5. **[High] Dead-code gate lets any `role:"admin"` reset another admin's password.** `src/app/api/admin/users/reset-password/route.ts:34-37`.
6. **[High] Loyalty reward-stats route exposes cross-store customer PII with no store scoping.** `src/app/api/admin/loyalty/reward-stats/route.ts:33`. Severity raised from Medium to High after the admin-pages audit traced the server-side exposure independent of the UI gate.

## Status

Living document. All four planned audit passes are now complete.

- Admin API routes — **DONE**
- Firestore rules — **DONE**
- Manager domain — **DONE**
- Admin client pages — **DONE**

**Fixes:** 6 of 8 Critical/High/Cleanup findings that needed code changes have been fixed and locally validated — `firestore.rules`, `storage.rules`, 4 API route files, and the rules test suite were all edited. Validation performed:
- `npm run test:rules` — 201/201 passing against the Firestore emulator, including 4 new regression tests.
- `npm run build` — clean, no TypeScript/compile errors across all routes.
- Dev-server smoketest of all 4 edited API routes — proper 401/403 auth-denial responses with no token, no 500s.

**Nothing has been committed or pushed.** All changes are in the working tree only, per this repo's rule that agents never commit/push on POS (Ian reviews and pushes).

2 findings remain open and undone: the architectural `/admin` layout gate (Critical) and the money/percentage bounds-validation finding (Medium) — both need larger, separately-scoped work (see their Notes above). Everything in the Cleanup section beyond the one item fixed (dead code in `admin/stores/page.tsx`, duplicated CRUD boilerplate, duplicated auth-helper patterns, misplaced/dead components, etc.) is still open for a future pass.

## Findings

### Critical

#### [admin API] `option-overrides` route has no store-scope check
- **File:** `src/app/api/admin/option-overrides/route.ts` (authStore helper lines 12-20, used by GET line 28 and PUT line 49)
- **Scenario:** The route calls only `requireActiveStaff(db, decoded, ["admin","manager"])` — no verification that `storeId` (taken from the query string on GET, from the body on PUT) is in `staff.assignedStoreIds`. Every sibling store-scoped route (`customer-catalog-cache`, `storefront-catalog`, `online-orders`) checks `assignedStoreIds.includes(storeId)`; this one omits it. A manager assigned only to Store A can PUT arbitrary `disabledGroupIds`/`disabledValueKeys` onto Store B (or any store), silently disabling menu options for a store they have no relationship to.
- **Fix:** Use `requireStaffStoreAccess(db, decoded, storeId, ["admin","manager"])` (reorder `authStore` to take `storeId` as a param), or add the same manual `assignedStoreIds.includes(storeId)` guard used elsewhere.
- **Corroboration:** Independently confirmed by the manager-domain audit, which also traced the concrete UI path: `OptionGroupsClient` on `/manager/inventory` → `PUT /api/admin/option-overrides` with an attacker-chosen `storeId` in the body.
- **Status:** Fixed (uncommitted — see Status section for validation)

#### [Firestore rules] `stores/{storeId}` document has no role gate on write/delete
- **File:** `firestore.rules:221-223`
- **Scenario:** The rule is `match /stores/{storeId} { allow read, write, delete: if hasStoreAccess(storeId); }`, and `hasStoreAccess(storeId)` is `isAdmin() || (isActiveStaff() && assignedStoreIds.hasAny([storeId]))` — no role check, so cashier/server/kitchen assigned to the store all pass. Contrast with the very next block (`firestore.rules:265-274`), which correctly locks store config subcollections (inventory, storeDiscounts, storeCharges, storeModesOfPayment, optionOverrides, savedQrCodes, etc.) to `isManagerOrAdmin()` via `isConfigCollection(coll)` — the top-level `stores/{storeId}` doc was left out of that pattern despite holding equally sensitive fields (`taxRatePct`, `taxType`, `tin`, `isActive`, `loyaltyConfig.pointsPerPeso`, `forecastConfig`, `acceptsOnlineOrders`, `acceptsReservations`, `acceptsWebsiteChat`, `deliveryRadiusKm` — `src/lib/types.ts:1041+`). Confirmed client-SDK write call sites that rely on this doc being protected: `src/app/admin/stores/page.tsx:116,168` (full store edit + `isActive` toggle, UI-gated by `RoleGuard allow={["admin"]}` at line 252 — cosmetic only, since the rule itself doesn't check role), `src/components/manager/store-settings/loyalty-settings.tsx:39-40` (`loyaltyConfig`), `src/components/manager/store-settings/forecast-settings.tsx:141-142` (`forecastConfig`), `src/lib/firebase/client.ts:74-78` (`logoUrl`). Manager page gate is `RoleGuard allow={["admin","manager"]}` (`src/app/manager/store-settings/page.tsx:75`) — also cosmetic only against this rule. A logged-in cashier (role "cashier", status "active", assigned to storeA) can open devtools and run `updateDoc(doc(db,"stores","storeA"),{taxRatePct:0,isActive:false,acceptsOnlineOrders:false})` or `deleteDoc(doc(db,"stores","storeA"))` using the app's already-initialized client SDK — both succeed today. Zeroes out VAT (tax-fraud vector), silently disables the store/online-ordering/reservations, rewrites the loyalty earn rate, or deletes the store doc outright.
- **Fix:** `allow read: if hasStoreAccess(storeId); allow write, delete: if hasStoreAccess(storeId) && isManagerOrAdmin();` — mirror the `isConfigCollection` pattern. Add a test case to `tests/rules/store-scoped.test.ts` (cashier/server/kitchen denied, manager/admin allowed on the store doc itself) since current coverage only tests the subcollections, not the doc.
- **Corroboration:** Independently confirmed by the manager-domain audit. Legitimate writers that a fix must preserve: `forecast-settings.tsx:141-142` and `loyalty-settings.tsx:39-40` (both manager-only actions) — the suggested rule fix (require `isManagerOrAdmin()` on write/delete) is compatible with both.
- **Corroboration 2:** Independently confirmed a third time by the admin-pages audit, which named the concrete write call sites: `src/app/admin/stores/page.tsx` `handleSaveStore` (lines 104-150, `updateDoc`/`batch.set`) and `handleToggleActive` (lines 152-184) — both go through the client SDK with only `RoleGuard allow={["admin"]}` as (cosmetic) protection.
- **Status:** Fixed (uncommitted — see Status section for validation)

#### [Firestore rules] `storeConfig` doc — the live checkout price/discount cache — is writable by any active staff, not just manager/admin
- **File:** `firestore.rules:64-69` (`isConfigCollection()` allow-list), `firestore.rules:265-274` (catch-all write rule); `src/lib/manager/dataManagement.ts:47-138` (`rebuildStoreConfig()`); `src/lib/billing/adjustments.ts:13`
- **Scenario:** `isConfigCollection()` is an allow-list (`inventory`, `storeDiscounts`, `storeCharges`, `storeModesOfPayment`, `storePackages`, `storeRefills`, `storeFlavors`, `menuSchedules`, `kitchenLocations`, `receiptSettings`, `salesTargets`, `optionOverrides`, `savedQrCodes`) — `storeConfig` is NOT in this list, so the catch-all at lines 265-274 lets any `hasStoreAccess(storeId)` staffer write it (the `isManagerOrAdmin()` check is skipped since `isConfigCollection('storeConfig')` is false). `stores/{storeId}/storeConfig/current` is the price/discount/charge cache the POS checkout UI actually reads: `rebuildStoreConfig()` writes this doc's `discounts`/`charges`/`modesOfPayment`/`packages` fields via the client SDK, invoked from admin pages after every discount/charge edit; `src/lib/billing/adjustments.ts:13` reads `stores/{storeId}/storeConfig/current` directly as the source of truth the cashier UI applies at checkout — it does NOT re-validate against the admin-gated source collections at sale time. This is a direct cash-theft vector: any cashier/server with store access can open DevTools and `setDoc` a forged 100%-off discount into this doc, then apply it at the register. This is the highest-priority fix in the whole audit — more directly exploitable for financial loss than the `stores/{storeId}` finding above.
- **Fix:** Add `'storeConfig'` to `isConfigCollection()` (write becomes `isManagerOrAdmin()`-gated) — simplest, and consistent with how `rebuildStoreConfig()` already writes it as a manager/admin action today.
- **Status:** Fixed (uncommitted — see Status section for validation)

#### [architecture] No server-side gate on `/admin/**` routes at all
- **File:** `src/components/guards/RoleGuard.tsx`; no `src/app/admin/layout.tsx` exists; `src/middleware.ts` matcher is `["/api/:path*"]` only
- **Scenario:** `RoleGuard` is a client component that renders after mount; there is no `src/app/admin/layout.tsx`, and `src/middleware.ts`'s matcher is API-routes-only, so page routes are never touched by it. The only reason impact is contained is that most writes and sensitive reads are independently re-checked by `firestore.rules` or server API routes (`requireActiveStaff`/`requireStaffStoreAccess`) — this finding is about the missing defense-in-depth layer itself, not one specific data leak (the specific leaks it enables are the `storeConfig` finding above and the `stores/{storeId}` finding above). A non-admin can see admin page markup/initial data flash before the client guard redirects.
- **Fix:** Add `src/app/admin/layout.tsx` as a Server Component that reads the session server-side and redirects non-admin/non-manager before render, in addition to keeping `RoleGuard` for UX. **Flag as architectural — needs a dedicated follow-up** rather than a quick patch, since it may require new server-side session-reading infra that doesn't exist yet.
- **Note:** Not fixed this pass: needs new server-side session-reading infra (reading the auth cookie/custom claim in a Server Component) that doesn't appear to exist yet in this codebase — a bigger, separate piece of work, not a quick patch.
- **Status:** Open

### High

#### [admin API] Dead-code gate lets any `role:"admin"` reset another admin's password
- **File:** `src/app/api/admin/users/reset-password/route.ts` lines 34-37
- **Scenario:** `const staff = await requireActiveStaff(db, decoded, ["admin"]); if (!staff.isPlatformAdmin) return bad(...)` is dead code — `isPlatformAdmin` is defined (`active-staff-check.ts` line 38) as `decoded.platformAdmin===true || role==="admin"`, and `requireActiveStaff` with `allowedRoles=["admin"]` already requires `role==="admin"` (which makes `isPlatformAdmin` true by definition) to reach this line, so the `!staff.isPlatformAdmin` branch can never fire. The comment says "only platform admins can reset passwords" but the real gate is just `staff.role==="admin"`. Any staff doc with `role:"admin"` can reset the password of ANY other user including other admins via `getAdminAuth().updateUser(uid,{password:tempPassword})` (line 73), gets the plaintext `tempPassword` back in the response (line 92), and `revokeRefreshTokens` (line 78) kicks the legitimate owner out at the same time — one compromised/malicious admin account can take over every other admin account.
- **Fix:** Gate resets targeting another `role==="admin"` account on `decoded.platformAdmin===true` directly (bypass the role-based alias), or maintain a separate `isSuperAdmin` check. At minimum, fix/remove the misleading dead condition.
- **Status:** Fixed (uncommitted — see Status section for validation)

#### [admin API] Loyalty reward-stats route has no store scoping at all — exposes cross-store customer PII
- **File:** `src/app/api/admin/loyalty/reward-stats/route.ts` line 33; `src/app/admin/loyalty-rewards/page.tsx` `openStats()` (lines 103-123)
- **Scenario:** `requireActiveStaff(["admin","manager"])` with no `storeId` param at all — the redemption query (line 43) scans `loyaltyRedemptions` across ALL stores with no per-store filter, so a manager normally confined to `assignedStoreIds` elsewhere gets an unscoped platform-wide view of every store's redemption activity, including customer phone numbers (line 96/130 `recent` log). **Severity reconciled from Medium to High:** first identified by the API-routes audit as Medium; the admin-pages audit independently found the same route/gap and rated it High, with an added detail — the admin page that calls it (`src/app/admin/loyalty-rewards/page.tsx` `openStats()`, lines 103-123) is `RoleGuard allow={["admin"]}` only, so a manager never sees the button in the UI, but the server route itself still accepts a manager's token, and `rewardIds` are trivially discoverable since `loyaltyRewards` is readable by any active staff (rules line 327). Both audits agree on the server-side facts; the UI trace explains why the exposure was initially under-weighted.
- **Fix:** Confirm intent; if unintentional, scope `byStore`/`recent` to `assignedStoreIds` for non-platform-admins. Otherwise document as intentional.
- **Status:** Fixed (uncommitted — see Status section for validation)

### Medium

#### [admin API] Forecast routes hand-roll auth instead of using shared helpers
- **File:** `src/app/api/admin/backfill-forecast-accuracy/route.ts`, `src/app/api/admin/refresh-forecast/route.ts`
- **Scenario:** Neither uses `requireActiveStaff`/`requireStaffStoreAccess` — each hand-rolls the same staff/status/role lookup inline instead. Currently functionally correct (`backfill-forecast-accuracy` does check `assignedStoreIds.includes(storeId)` for managers at lines 44-51), but the duplicated auth logic will silently diverge from the shared helpers if those are patched later (this is exactly the mechanism that produced the `option-overrides` Critical finding above).
- **Fix:** Refactor both to call the shared helpers like every other route in the directory.
- **Status:** Open

#### [admin API] No storeId format validation across the admin surface
- **File:** all of `src/app/api/admin/*`
- **Scenario:** Since `db.doc()` treats "/" as a path separator, an admin-role caller (who bypasses `assignedStoreIds` membership entirely via `isAdmin`) could pass a `storeId` containing "/" to address documents outside `stores/{storeId}/...`. Not a privilege escalation today (admin already has blanket trust throughout this codebase) but worth tightening as defense-in-depth.
- **Fix:** Validate `storeId` matches `^[A-Za-z0-9_-]+$`, or confirm the doc exists before use.
- **Status:** Open

#### [manager domain] No server-side bounds validation on money/percentage fields for manager-editable config
- **File:** `src/lib/inventory/quick-edit.ts` (`parsePriceDraft`), `src/components/manager/inventory/edit-inventory-dialog.tsx` (zod schema lines 19-27), `src/components/manager/collections/ChargeEditDialog.tsx` / `DiscountEditDialog.tsx` (zod: `.min(0)`, percent `<=100`)
- **Scenario:** Every manager edit dialog validates client-side only — the Firestore rules that authorize these writes (`inventory`, `storeCharges`, `storeDiscounts`, `storeModesOfPayment`, `storePackages`, etc., all gated via `isConfigCollection`) check only role + store scope, with no `request.resource.data.value` bounds check anywhere in `firestore.rules`. A manager (who already has legitimate write access to their own store's config, so this is not a privilege-escalation bug) can bypass the dialog via devtools and write `sellingPrice: -500`, or `value: 500` on a "percent"-typed discount — a path to till/receipt corruption or a discount that pays the customer money. Contrast with `/api/product-requests`, which correctly re-validates `suggestedPrice >= 0` / `cost >= 0` server-side.
- **Fix:** Add minimal `request.resource.data.x >= 0` (and `<= 100` for percent-typed charges/discounts) guards to the relevant `firestore.rules` blocks, or route these writes through a validated API route instead of raw client Firestore writes.
- **Note:** Not fixed this pass: would need per-field bounds checks added to several firestore.rules blocks (storeDiscounts, storeCharges, inventory sellingPrice, etc.) — deferred to keep this pass scoped to the fixes that were already fully traced end-to-end; flagged for a dedicated follow-up.
- **Status:** Open

#### [Storage rules] Loyalty reward image uploads not restricted to admin, unlike the reward doc itself
- **File:** `storage.rules:73-75`; `firestore.rules:328`; `src/app/admin/loyalty-rewards/page.tsx` `uploadRewardImage` (lines 95-101)
- **Scenario:** `storage.rules` line 73-75 lets any `isManagerOrAdmin()` write to `loyaltyRewardImages/{rewardId}/{fileName}`, but `firestore.rules` line 328 restricts creating/editing the reward doc itself to `isAdmin()` only. A manager can upload arbitrary images under any (including nonexistent) `rewardId` even though they can never attach them to a real reward via the UI (`admin/loyalty-rewards/page.tsx` `uploadRewardImage`, lines 95-101, is behind `RoleGuard allow={["admin"]}` so a manager can't reach it via the app — but the storage rule itself doesn't enforce that). Low-impact storage abuse, not data exposure.
- **Fix:** Narrow the storage rule to `isAdmin()` for this path, or accept as enforcement-consistency debt since the UI path is already admin-only.
- **Status:** Open

### Low

#### [Storage rules] `paymentProofs/` read is unconditionally public bucket-wide
- **File:** `storage.rules:108-112`
- **Scenario:** Read access on `paymentProofs/` is public bucket-wide (Storage rules OR across matching blocks, so a stricter `allow read` on this path is a no-op, per the file's own comment) — mitigated by crypto-random UUID path + 15-day lifecycle deletion. A leaked URL exposes a customer's payment-confirmation photo for up to 15 days.
- **Fix:** None required — conscious, documented tradeoff, not an oversight. Recorded for completeness only; not actionable.
- **Status:** Accepted tradeoff (informational, not tracked as Open)

#### [admin pages] `backfill` page uses a stricter admin check than the rest of the app
- **File:** `src/app/admin/backfill/page.tsx` lines 57-59 (repeated at 62, 87, 112, 137)
- **Scenario:** Early-return checks `appUser?.role !== 'admin'` instead of the `isPlatformAdmin` definition `RoleGuard` actually uses (custom claim OR `role==='admin'`). More restrictive than intended — can only ever lock out a legitimate platform admin whose staff-doc role differs from their custom claim (the documented "break-glass" case in `firestore.rules` lines 14-33). Correctness bug, not a security hole.
- **Fix:** Use the same `isPlatformAdmin` definition (custom claim OR role) as `RoleGuard`, consistently across all five `handle*Backfill` guards.
- **Status:** Open

#### [admin pages] Any active staff (including cashier) can read any customer's loyalty doc by phone number
- **File:** `src/components/admin/online-orders/OnlineOrdersClient.tsx` line 296; `firestore.rules:311`
- **Scenario:** `OnlineOrdersClient.tsx` reads `customers/{phone}` directly — `firestore.rules` line 311 lets ANY `isActiveStaff()` (including cashier) read any customer's loyalty doc by phone number, platform-wide, with no store-scoping. Pre-existing broad grant, not introduced by this page, but worth recording: a customer's visit count/loyalty data is fetchable by any staff account that knows (or guesses/enumerates) a phone number.
- **Fix:** Consider scoping `customers/{phone}` reads to staff whose store the customer has transacted with, if that's derivable; otherwise document as an accepted platform-wide read grant.
- **Status:** Open

### Cleanup

#### [admin API] Store-scoped routes don't use the existing `requireStaffStoreAccess` helper
- **File:** `src/app/api/admin/*` (zero grep hits for `requireStaffStoreAccess`)
- **Scenario:** No route under `src/app/api/admin/` uses `requireStaffStoreAccess` despite it existing for exactly this purpose — every store-scoped route hand-rolls the `assignedStoreIds` check after `requireActiveStaff` instead. This duplication is exactly how `option-overrides` ended up missing the check (see Critical finding above).
- **Fix:** Migrate all store-scoped admin routes to `requireStaffStoreAccess` so the omission becomes structurally impossible.
- **Status:** Open

#### [admin API] Bearer-token parsing and error helper duplicated across all routes
- **File:** all 13 files under `src/app/api/admin/*/route.ts`
- **Scenario:** Bearer-token extraction (`const m = authz.match(/^Bearer\s+(.+)$/i)`) and a `bad()` error-response helper are copy-pasted verbatim into all 13 admin route files.
- **Fix:** Candidate for a shared `src/lib/server/route-auth.ts` helper returning `{decoded, db}` or a `NextResponse` error in one call.
- **Status:** Open

#### [admin API] Unreachable admin-check condition in products/merge
- **File:** `src/app/api/admin/products/merge/route.ts` lines 24-26
- **Scenario:** Same dead-code pattern as `reset-password` (`if (!staff.isPlatformAdmin && staff.role !== "admin")` is unreachable given `allowedRoles=["admin"]` on the preceding call), but here it isn't gating anything additional, so it's cleanup, not a vuln.
- **Fix:** Remove or comment as intentionally-redundant.
- **Status:** Fixed (uncommitted — see Status section for validation)

#### [admin API] `backfill-forecast-accuracy` hand-rolls a check `requireStaffStoreAccess` already provides
- **File:** `src/app/api/admin/backfill-forecast-accuracy/route.ts` lines 39-51
- **Scenario:** Hand-rolls the same role+store-scope check `requireStaffStoreAccess` already provides instead of calling it. Correct today, but this exact pattern — reimplementing the check by hand — is how the `option-overrides` bug happened.
- **Fix:** Standardize on the shared helper everywhere.
- **Status:** Open

#### [routing] Misleading route naming under `/api/admin/*`
- **File:** `src/app/api/admin/backfill-forecast-accuracy`, `src/app/api/admin/option-groups`, `src/app/api/admin/option-overrides`
- **Scenario:** These routes live under `/api/admin/*` but are legitimately callable by managers too — confusing for future maintainers who might assume "admin path = admin-only" and add an insufficiently-scoped check.
- **Fix:** Consider renaming or documenting the shared-access convention explicitly.
- **Status:** Open

#### [manager domain] Dead component: `RecentReceiptsList`
- **File:** `src/components/manager/receipts/RecentReceiptsList.tsx`
- **Scenario:** Not imported anywhere in the codebase (verified via repo-wide grep).
- **Fix:** Candidate for removal.
- **Status:** Open

#### [manager domain] Misplaced component: `receipt-settings.tsx`
- **File:** `src/components/manager/store-settings/receipt-settings.tsx`
- **Scenario:** Not used by `src/app/manager/store-settings/page.tsx` (absent from its `TABS` array) — it's actually consumed by `src/app/receipts/page.tsx` and `src/components/receipts/page.tsx`. Living under `manager/store-settings` is misleading.
- **Fix:** Consider moving to `src/components/receipts/`.
- **Status:** Open

#### [manager domain] Inconsistent RoleGuard placement around "No Store Selected" states
- **File:** `src/app/manager/collections/page.tsx:49-58`, `src/app/manager/store-settings/page.tsx:63-72` vs. `src/app/manager/inventory/page.tsx:613-626`, `src/app/manager/product-requests/page.tsx:216-231`
- **Scenario:** Cosmetic only, not exploitable — the first two pages render their "No Store Selected" card outside `RoleGuard`, while the latter two wrap the equivalent branch inside `RoleGuard`. No data/actions exposed either way (`FirstLoginGuard` blocks all unauth access app-wide), just worth aligning for consistency.
- **Fix:** Standardize placement of the "No Store Selected" branch relative to `RoleGuard` across manager pages.
- **Status:** Open

#### [manager domain] Repeated settings-panel boilerplate
- **File:** `ForecastSettings`, `LoyaltySettings`, `TablesSettings`, `ChargesSettings`, `DiscountsSettings`, `ModesOfPaymentSettings` (all under `src/components/manager/store-settings/`)
- **Scenario:** Identical subscribe → local state → updateDoc/setDoc → toast shape repeated across six components.
- **Fix:** Candidate for a shared hook if the pattern grows further.
- **Status:** Open

#### [admin pages] Dead, throwing code in `admin/stores/page.tsx`
- **File:** `src/app/admin/stores/page.tsx` lines 43-72
- **Scenario:** `getSubCollections()`/`getCollectionData()` are dead, mutually-recursive, never called (`downloadStoreData()` at lines 191-248 has its own separate working implementation) — `getSubCollections` also queries a literal nonexistent `"subcollections"` collection (line 46) and would throw if ever invoked.
- **Fix:** Safe to delete both.
- **Status:** Open

#### [admin pages] Duplicated CRUD boilerplate across flavors/packages/refills menu pages
- **File:** `src/app/admin/menu/flavors`, `src/app/admin/menu/packages`, `src/app/admin/menu/refills`
- **Scenario:** Near-identical CRUD boilerplate duplicated three times, with inconsistent error handling — flavors uses `errorEmitter`/`FirestorePermissionError` overlays, packages/refills just `toast()` on catch.
- **Fix:** Candidate for a shared `useAdminCatalogCrud(collectionName)` hook, not urgent.
- **Status:** Open

#### [admin pages] `backfill` page repeats the same admin-role guard four times
- **File:** `src/app/admin/backfill/page.tsx`
- **Scenario:** The four `handle*Backfill` functions each re-implement the identical `role!=='admin'` guard (see the related Low finding above on that guard being stricter than intended).
- **Fix:** Could be one wrapper.
- **Status:** Open

## Files changed (uncommitted)

- `firestore.rules` — storeConfig gating fix + `stores/{storeId}` role gate
- `storage.rules` — loyaltyRewardImages narrowed to admin-only
- `tests/rules/store-scoped.test.ts` — moved storeConfig to config-collections, added 2 regression tests
- `src/app/api/admin/option-overrides/route.ts` — store-scope check added
- `src/app/api/admin/users/reset-password/route.ts` — real admin-vs-admin hierarchy check
- `src/app/api/admin/loyalty/reward-stats/route.ts` — narrowed to admin-only
- `src/app/api/admin/products/merge/route.ts` — removed dead-code check

## Cleanup notes

- **Reviewed clean, no issues found (admin API):** `customer-catalog-cache/route.ts`, `online-orders/route.ts` (previously-fixed op-gating bug verified correctly fixed, covered by regression tests in `route.test.ts`), `option-groups/route.ts` + `[id]/route.ts`, `products/inventory-counts/route.ts`, `products/sync-inventory-from-products/route.ts`, `storefront-catalog/route.ts`. No secrets logged anywhere in the admin API surface; temp-password generation uses `crypto.randomInt` (CSPRNG).

- **Reviewed clean, no issues found (Firestore/Storage rules):** Known landmines checked and confirmed NOT present as live bugs (each was previously hit and already fixed here, with comments documenting the fix):
  1. OR-semantics nested-rule no-op — root fallback at `firestore.rules:403-413` explicitly excludes `stores` for this exact reason; `activeSessions` excluded from the config catch-all at `252-255`/`265-269` to avoid ORing past `pinFieldsUnchanged()`.
  2. Bare `get()`/`exists()` without the `firestore.get()` path syntax — not present in `firestore.rules` (all use the correct `/databases/$(database)/documents/...` form via `staffPath()`); was a real historical bug in `storage.rules`, already fixed (`storage.rules:8-13` comment).
  3. Self-create role escalation via `isAdmin()` — does not apply; `staff/{uid}` create rule (`firestore.rules:142-146`) hard-pins `status:pending`/`role:server`/`assignedStoreIds:[]` independent of `isAdmin()`, and `isAdmin()`/`isManager()` gate on `isActiveStaff()` first so a brand-new pending doc never qualifies.
  4. Wildcard-read-that-a-later-deny-can't-override — root fallbacks (`414-423`) are read-only/staff-only and explicitly exclude `stores`/`paymongoIntentIndex`; `serverProfileSecrets` excluded at the point of origin rather than via a separate deny block, with a comment explaining why a separate deny would be a no-op under OR-semantics.

  Collection-by-collection, all correctly gated except the `stores/{storeId}` Critical finding above: `staff` (isAdmin, self-signup pinned), `stores/{storeId}/{configColl}` (isManagerOrAdmin via isConfigCollection), `products`/`addonCategories`/`packages`/`refills`/`flavors` (isAdmin), `optionGroups` global (no client write call site, real writes are Admin-SDK-only via `/api/admin/option-groups*`), `optionOverrides` per-store (isManagerOrAdmin), `onlineOrders`/`storefrontCatalog`/`storefrontConfig`/`paymentIntents`/`analytics*`/`dashPresets`/`dailySessions` (client writes always denied, Admin-SDK-only, covered by `tests/rules/store-scoped.test.ts:225-244`), `loyaltyRewards` (isAdmin), `productRequests` (API-only, writes false), `customerRequests` (open to shift roles per design intent), `inventory` (isManagerOrAdmin), legacy `users` collection (writes false, isAdmin-only read), `serverProfileSecrets` (closed to everyone including admins, Admin-SDK-only).

- **Reviewed clean, no issues found (manager domain):** `/api/product-requests` (exemplary — `requireActiveStaff` + `assignedStoreIds` check for submit, `requestedByUid` match for cancel, `requireAdmin` for approve/reject, price/cost `>=0` validation, image-domain allowlist); `/api/server-profiles` (`requireStaffStoreAccess` throughout, correct per-op role tiers, rate-limit/lockout on passcode verify); direct Firestore writes for `inventory`/`storeCharges`/`storeDiscounts`/`storeModesOfPayment`/`storePackages`/`storeRefills`/`storeFlavors`/`menuSchedules`/`kitchenLocations`/`salesTargets` (all correctly gated); `staff/{uid}` role-escalation path (none found — writes restricted to `isAdmin()`, no manager page/component ever writes `staff/{uid}`); all 5 manager pages wrap content in `RoleGuard allow={["admin","manager"]}` (no unguarded page).

- **Reviewed clean, no issues found (admin pages):** `admin/tools/printer-test` (no Firestore access, hardware only); `admin/menu/flavors|packages|refills|products` (writes gated `isAdmin()` in rules, matches `RoleGuard`); `admin/product-requests` (read-only `onSnapshot`, all mutations via well-guarded `/api/product-requests`); `admin/online-orders` (proper server-side gating on all state-changing actions, inherits the `storeConfig`/`stores/{storeId}` gaps only via the underlying rules); `admin/users` (staff writes `isAdmin()`-gated, password reset route independently re-verifies + revokes tokens); `admin/collections` (`globalDiscounts`/`globalCharges` `isAdmin()`-gated, `storeDiscounts`/`storeCharges` `isManagerOrAdmin()`-gated); `admin/customer-requests|daily-session-timeline|backfill|reconcile` (read-only store-scoped queries, mutating actions route through `/api/analytics/backfill` which does `requireStaffStoreAccess` correctly); `admin/products` (trivial redirect); `admin/page.tsx` (nav hub, defense-in-depth working as intended). No hardcoded secrets/API keys found anywhere under `src/app/admin/**` (the one env-driven key, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `store-geo-picker.tsx`, is an intentionally-public browser-restricted Maps key). No URL/query-param-driven IDOR found — all `storeId` scoping comes from `useStoreContext()`, derived from the authenticated user's `assignedStoreIds`, not the URL.
