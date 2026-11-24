# Menu Management — Stress Test & Audit Report

Date: 2026-11-24 (Asia/Manila)
Scope: Global menu catalog (admin) + per-store menu (manager store-settings)
Author: automated audit

## 1. Scope

The "menu management" feature spans two ownership layers and three admin surfaces:

| Layer | Surface | Route | Lifecycle owned |
|---|---|---|---|
| Global catalog | Products (families/variants) | `/admin/menu/products` | create, update, archive, restore, activate/deactivate |
| Global catalog | Flavors | `/admin/menu/flavors` | create, update, archive, activate/deactivate |
| Global catalog | Packages | `/admin/menu/packages` | create, update, archive, activate/deactivate |
| Global catalog | Refills | `/admin/menu/refills` | create, update, archive, activate/deactivate |
| Per-store menu | Packages | `/manager/store-settings` → Packages | add-from-global, edit price/schedule/refills/flavors, enable/disable, hard delete |
| Per-store menu | Refills | `/manager/store-settings` → Refills | add-from-global, enable/disable, sort/kitchen/other-flag |
| Per-store menu | Flavors | `/manager/store-settings` → Flavors | add-from-global, enable/disable, sort |

`/admin/products` is a thin redirect to `/admin/menu/products`.

## 2. Data model (source of truth)

- **Global**: `products` (with `kind: single|group|variant`, `groupId`, `variantLabel`), `flavors`, `packages`, `refills`, `addonCategories`. Writes are admin-only (firestore.rules).
- **Per-store**: `stores/{id}/storePackages`, `stores/{id}/storeRefills`, `stores/{id}/storeFlavors`, `stores/{id}/menuSchedules`, `stores/{id}/kitchenLocations`. Writes are manager/admin via `hasStoreAccess()`.
- **Denormalized caches**: `stores/{id}/storeConfig/current` (POS reads packages/flavors/schedules) and the customer app's `refillOptionsCache` — both must be rebuilt after a menu edit or the change never reaches the register/customer.

## 3. Method

- Static inspection of all seven surfaces and their edit dialogs, plus `src/lib/products/variants.ts`, `src/lib/refill-visibility.ts`, `src/lib/refill-selection.ts`, `src/lib/server/catalog-shared.ts`.
- A new deterministic stress suite (`src/lib/__tests__/menu-workflow.stress.test.ts`) exercising the pure projections behind those screens: family grouping over thousands of products, the three-gate refill visibility (global `isActive` × store `isEnabled` × package allow-list), stale-package-id detection, and the modifier union rule.
- `tsc --noEmit` + the menu vitest suites.

## 4. Findings — fixed

### F1. Flavors / Packages / Refills could be archived but never restored (HIGH)
The archive confirmations promised "Archived items are hidden but can be recovered", but each page only rendered `items.filter(i => !i.isArchived)` and offered **no restore path**. An operator who archived a flavor, package or refill could only recover it from the Firestore console.

**Fix**: added an "Archived" section pinned below each live table with a **Restore** action. Restore clears `isArchived` and leaves `isActive` off (operator reactivates when ready), matching the existing products-page restore semantics.
- `src/app/admin/menu/flavors/page.tsx`
- `src/app/admin/menu/packages/page.tsx`
- `src/app/admin/menu/refills/page.tsx`

### F2. Editing a family child (variant) via the main product dialog corrupted it (HIGH)
The nested variant rows' **Edit** button opened `ProductEditDialog` in single-SKU mode (it read `product.variant`, which variant children don't set — they use `variantLabel`). Saving rewrote `kind: "single"` while leaving `groupId`/old `variantLabel` intact, producing an inconsistent "single with a groupId" row.

**Fix**: the dialog now pre-fills the label from `variantLabel`, hides the "has variants" toggle for children, and `handleSaveProduct` keeps `kind: "variant"` and writes `variantLabel` (not `variant`) for children.
- `src/app/admin/menu/products/page.tsx`
- `src/components/admin/product-edit-dialog.tsx`

### F3. Store package enable/disable could fail silently (MEDIUM)
`StorePackagesSettings.handleToggleEnabled` awaited `updateDoc` + `syncConfigCache` with no try/catch. A denied or failed write became an unhandled rejection with no user feedback.

**Fix**: wrapped in try/catch with a destructive toast, matching the sibling handlers in the same file.
- `src/components/manager/store-settings/store-packages-settings.tsx`

### F4. Flavors page failures were silent (LOW)
`handleSave`, `handleToggleActive` and `handleDelete` emitted a permission error for debugging but showed no toast (packages/refills do).

**Fix**: added destructive toasts to all three catch paths.
- `src/app/admin/menu/flavors/page.tsx`

## 5. Verification

`npx tsc --noEmit` — clean (exit 0).

Menu vitest suites — all green:
- `menu-workflow.stress.test.ts` (16) — new
- `products/variants.test.ts` (5)
- `__tests__/refill-visibility.test.ts` (11)
- `__tests__/refill-selection.test.ts` (13)
- `server/catalog-shared.test.ts` (9)
- `__tests__/flavor-visibility.test.ts` (2) — new

**56 tests, 56 passed.**

The stress suite asserts the invariants that matter at scale:
- family grouping preserves every item exactly once across 0→5000 products and never co-mingles a groupId-less variant;
- refill visibility is total/disjoint and every hidden refill violated exactly one of the three gates;
- the refill tap state machine never leaves focus pointing at a removed entry over 5000 random taps;
- the modifier union (parent ∪ variant ∪ store) de-dupes, preserves order, and drops blanks.

## 6. Outstanding findings — disposition

1. **Global flavor deactivation is a chain-wide kill switch.** The manager flavor screen already hid inactive flavors from "Add from Global Flavors", and the product's refill picker had no gate for saved store flavors. Added a pure visibility helper, filtered rebuilt POS configs against global flavor status, refreshed POS configs and customer refill caches across stores after deactivation/archive, and made the refill picker listen to global flavors live. Store flavor documents remain intact for reactivation. Reactivating or editing `isActive` on a flavor also republishes the caches (review fix: originally only deactivation did, so reactivated flavors stayed hidden until a manual rebuild). **Customer app gap (separate repo):** `CUSTOMER/src/lib/server/refill-options-cache.ts` did not read global flavors, so the POS-side cache refresh alone could not hide them. A fix is committed locally on `CUSTOMER` branch `fix/refill-options-global-flavor-gate` (drops globally inactive flavors from the cached `storeFlavors`); it is NOT deployed until that repo's PR is merged.
2. **Archive gating matches the rules.** `useAuthContext` sets `isPlatformAdmin` when `role === 'admin'`; `firestore.rules` `isAdmin()` accepts that same active staff role. Kept the UI gate and documented the mapping beside it.
3. **Type gap fixed.** Added optional `isArchived` to `Flavor`, `Package`, and `Refill`; removed the archive casts from the three catalog pages and store flavor settings.
4. **Product image create made atomic in Firestore.** Creation uploads the image first, then commits the product and its `imageUrl` in one batch. Existing product image edits still use `uploadProductImage`, preserving their current upload-and-update behavior. If the Firestore batch fails after upload, an unreferenced storage object can remain; the product itself is never published without its image URL.

## 7. Prior-fix review

- Restore clears `isArchived` and preserves the inactive state set by archive. This matches products and avoids an item going live just because it was recovered.
- The main dialog keeps family children as `kind: 'variant'`, writes the edited label to `variantLabel`, and its update payload leaves existing `groupId` and `groupName` untouched. The `has variants` toggle is hidden for every variant child, including orphan variants; single products can still be toggled to groups.
- Store package toggle error handling encloses both `updateDoc` and the awaited `syncConfigCache()` call. Cache rebuild failures are reported by `syncConfigCache` itself; write errors reach the outer catch.

## 8. Changed files

- `src/app/admin/menu/flavors/page.tsx`
- `src/app/admin/menu/packages/page.tsx`
- `src/app/admin/menu/refills/page.tsx`
- `src/app/admin/menu/products/page.tsx`
- `src/components/admin/product-edit-dialog.tsx`
- `src/components/manager/store-settings/store-packages-settings.tsx`
- `src/components/manager/store-settings/store-flavors-settings.tsx`
- `src/components/server/RefillPOSModal.tsx`
- `src/lib/firebase/client.ts`
- `src/lib/manager/dataManagement.ts`
- `src/lib/types.ts`
- `src/lib/flavor-visibility.ts`
- `src/lib/__tests__/flavor-visibility.test.ts` (new)
- `src/lib/__tests__/menu-workflow.stress.test.ts` (new)
