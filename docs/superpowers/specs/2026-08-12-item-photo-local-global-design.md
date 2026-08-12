# Item Photos: Local (Store) vs. Global (Admin-Promoted) — Design

**Date:** 2026-08-12
**Status:** Approved (pending written-spec review)
**Builds on:** the existing `Product`/`InventoryItem` catalog model, the existing admin-only `uploadProductImage()` flow, and the `productRequests` server-mediated review pattern.

---

## 1. Background & goal

Today only an admin can set an item's photo, and there is exactly one photo per product, shared by every store (`products/{id}.imageUrl`, written via `uploadProductImage()` on `/admin/menu/products`). Managers have no way to attach a photo to what their store actually stocks, and `/manager/inventory`'s edit dialog has no image field at all.

**Goal:** let a manager upload a photo for an item at their own store, with the photo taking effect immediately *at that store only*. An admin, from `/admin/menu/products`, can then review store-submitted photos and either **promote** one to be the item's photo for every store that doesn't have its own override, or **reject** it. Rejecting an already-promoted photo resets every store that was relying on it back to no picture. A store's own distinct photo is never touched by another store's promotion or rejection.

### Confirmed decisions (from brainstorming)
| Decision | Choice |
|---|---|
| Target entity | The per-store `InventoryItem` (`stores/{storeId}/inventory/{itemId}`), not the global `Product` directly |
| "Every store gets the picture" mechanism | **Fallback at display time** (`inventoryItem.imageUrl ?? product.imageUrl`), not a fan-out write to every store |
| Admin discovery UI | **Inline per-product badge** on `/admin/menu/products`, not a separate review page |
| Workflow mechanism | **Server-mediated** via a new API route + `productPhotoRequests` collection, mirroring `productRequests` — not direct client Firestore writes for the review lifecycle |
| "Local" vs "global" status | Not a stored field — **derived at render time** from which of `inventoryItem.imageUrl` / `product.imageUrl` is set. The *request*'s `status` (`pending`/`approved`/`rejected`) is what's actually persisted. |
| Reject scope | A single admin action, valid on both a still-pending and an already-approved request. On an approved request it also clears `product.imageUrl`, which is what makes every fallback-relying store "reset" in one write. |

### Non-goals
- No photo history/versioning — a new submission overwrites the previous request doc for that (store, product) pair. No undo beyond re-uploading.
- No cross-store fan-out writes, ever. Promotion and rejection are always single-document writes (`products/{id}.imageUrl`) plus, for reject, one write to the originating store's `inventoryItem.imageUrl`.
- No image compression/resizing beyond the existing size-guard pattern (`isImageUnder()`) already used elsewhere in `storage.rules`.
- Not building cleanup for a product/inventory item being archived or deleted while a photo request is pending — an accepted gap, not engineered around.
- Not touching the existing admin-only `uploadProductImage()` flow on `/admin/menu/products` (an admin editing the product form directly still works exactly as today) — this feature is additive.

## 2. Data model

`stores/{storeId}/inventory/{itemId}.imageUrl` (`src/lib/types.ts:238`) — existing field, no schema change. Becomes the store's local override.

`products/{id}.imageUrl` (`src/lib/types.ts:56`) — existing field, no schema change. Stays the global default.

**Display rule, everywhere an item's photo is rendered:** `effectiveImageUrl = inventoryItem.imageUrl ?? product.imageUrl ?? null`.

New collection, `productPhotoRequests/{requestId}` where `requestId = ${storeId}_${productId}` (deterministic — at most one active request per store+product pair, reused across resubmissions rather than accumulating history):

```ts
type ProductPhotoRequest = {
  id: string;                    // `${storeId}_${productId}`
  storeId: string;
  storeName: string;             // denormalized for the admin list
  productId: string;
  productName: string;           // denormalized for the admin list
  status: "pending" | "approved" | "rejected";
  imageUrl: string;               // the submitted photo's download URL
  submittedByUid: string;
  submittedByName: string;
  submittedAt: Timestamp;
  reviewedByUid?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: Timestamp | null;
};
```

`firestore.rules`: `productPhotoRequests` gets `allow read, list: if isActiveStaff(); allow create, update, delete: if false;` — same shape as `productRequests` (`firestore.rules:392-395`). All writes go through the API route below.

## 3. Storage

New path: `productPhotos/{productId}/{storeId}.webp`.

`storage.rules`: mirrors the existing store-scoped pattern (`qrWallet`, store logo):
```
match /productPhotos/{productId}/{storeId}.webp {
  allow write: if request.auth != null
    && isStoreManagerOrAdmin(request.auth.uid, storeId)
    && isImageUnder(4);
}
```
Public read (falls under the existing `{allPaths=**} { allow read; }` root rule — no change needed, consistent with `Items/` and every other product-facing image).

The client uploads the file directly to this path via the Storage SDK (same pattern as `uploadProductImage`/`uploadStoreLogo` in `src/lib/firebase/client.ts`), then calls the API route below with the resulting download URL — the route never touches Storage itself.

## 4. API route

`POST /api/product-photo-requests`, Admin SDK, structured like `src/app/api/product-requests/route.ts`. Bearer token required on every op.

| op | Who | Behavior |
|---|---|---|
| `submit` | `requireStaffStoreAccess(db, decoded, storeId, ["admin","manager"])` | Client has already uploaded to `productPhotos/{productId}/{storeId}.webp`. Route does, in one write: upsert `productPhotoRequests/{storeId}_{productId}` to `{status: "pending", imageUrl, submittedByUid, submittedByName, submittedAt}` (clearing any prior `reviewedBy*`/`reviewedAt`), and set `stores/{storeId}/inventory/{itemId}.imageUrl` to the same URL. Covers first upload and "change" (resubmission just overwrites both). |
| `remove` | `requireStaffStoreAccess(db, decoded, storeId, ["admin","manager"])` | Clears `stores/{storeId}/inventory/{itemId}.imageUrl` (back to `null`, so display falls back to `product.imageUrl` if any) and **deletes** the `productPhotoRequests/{storeId}_{productId}` doc, regardless of its current status. Covers "delete." Does **not** touch `product.imageUrl` even if this request was `approved` — revoking a global promotion is an admin-only decision (see `reject` below). |
| `promote` | admin only (`requireActiveStaff(db, decoded, ["admin"])`) | Reads `productPhotoRequests/{requestId}` **server-side** (never trusts a client-passed URL). Sets `products/{productId}.imageUrl` to `request.imageUrl`. Marks the request `approved`, `reviewedByUid`/`reviewedByName`/`reviewedAt`. |
| `reject` | admin only | Reads the request server-side. If `status === "approved"`, also clears `products/{productId}.imageUrl` (only if it still equals this request's `imageUrl` — an intervening different promotion is not clobbered). Always clears `stores/{storeId}/inventory/{itemId}.imageUrl` for the *originating* store. Marks the request `rejected`. |

Request bodies: `submit` takes `{ storeId, productId, imageUrl }` (the URL from the just-completed Storage upload); `remove` takes `{ storeId, productId }`; `promote` and `reject` take only `{ requestId }` — every other value they need is read from the stored request doc server-side, closing the class of bug this session's audit found repeatedly (client-supplied values driving privileged writes).

Given today's `option-overrides` finding, this route gets an explicit route-level test asserting: a manager is denied `promote`/`reject` outright, and a manager assigned to store A is denied `submit`/`remove` for store B — not just "the happy path works."

## 5. Manager UI — `/manager/inventory`

`edit-inventory-dialog.tsx` gains a photo field:
- Shows the effective photo (local if set, else the inherited global one, visually indicated as "inherited" when it's not the store's own).
- Upload control → uploads to Storage, then calls `submit`.
- If a `productPhotoRequests` doc exists for this (store, product), show its status inline: "Pending admin review" / "Live for every store" (approved) / "Rejected — upload a different photo?" (rejected, distinct from pending so the manager knows a decision was already made).
- Remove control → calls `remove`, only enabled when the store has its own local `imageUrl` set (nothing to remove if it's just showing the inherited global picture).

## 6. Admin UI — `/admin/menu/products`

- Each product row gets a small badge (e.g. a camera icon + count) when 1+ `productPhotoRequests` exist with `status === "pending"` for that `productId`. Live-updated via `onSnapshot` on a query scoped to `pending` requests (the page already loads all products; querying `productPhotoRequests` where `status == "pending"` once and grouping client-side by `productId` avoids N per-row queries).
- Clicking the badge opens a dialog listing each pending store: thumbnail, store name, submitted-by/at, with **Promote** and **Reject** buttons calling the API route.
- The product's own detail/edit view shows its current `imageUrl` with a small note when it originated from a promoted store photo (informational only — not required to be perfectly attributed after a `reject` clears it).

## 7. Error handling

- `submit`/`remove` on a store the caller isn't assigned to → 403, same shape as every other `requireStaffStoreAccess` failure in this codebase.
- `promote`/`reject` on a non-existent or already-`rejected`/`approved`-in-a-conflicting-way `requestId` → the route re-reads status server-side before acting, so a stale admin dialog (another store's request already handled by someone else) fails cleanly with a clear message rather than corrupting state — the dialog should re-fetch and show "already reviewed" rather than erroring silently.
- Two stores independently submitting for the same product is normal and expected — their requests are independent docs; promoting one never reads or writes the other.
- Storage upload failures (size/type rejected by `isImageUnder`) surface as a standard Storage SDK error in the upload UI, before `submit` is ever called — no partial state possible (the request doc is only created/updated after a successful upload).

## 8. Testing

- `tests/rules/store-scoped.test.ts` (or a focused addition): `productPhotoRequests` create/update/delete denied for every role including admin (server-only), matching the existing `productRequests` coverage.
- New `src/app/api/product-photo-requests/route.test.ts`, modeled on `src/app/api/admin/online-orders/route.test.ts`: per-op auth matrix (manager own-store allowed on `submit`/`remove`, denied cross-store; `promote`/`reject` admin-only, manager denied on both even for their own store's request); `promote` reads `imageUrl` from the stored doc, not the request body; `reject` on an `approved` request clears `product.imageUrl` only when it still matches, and clears the originating store's `inventoryItem.imageUrl` unconditionally; `reject` on a still-`pending` request never touches `product.imageUrl`.
- Manual smoke test: dev-server route compiles and returns proper 401/403 without a token (matching this session's validation pattern for the other admin routes touched today).
