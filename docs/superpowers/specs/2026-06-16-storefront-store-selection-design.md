# Storefront store-scoped ordering with location-based store selection

**Date:** 2026-06-16
**Repos:** `POS` (shareat-hub-v2) + `Shareat Website` (shareat-website)
**Status:** Design approved; spec under review

## Context

The public storefront (`shareat.net/shop`) is live but **single-store**: the website bridge
(`getStorefrontCatalog`, `placeOrder`, `storefrontOrderStatus` in the website's `functions/index.js`)
reads one pilot store from `STOREFRONT_STORE_ID` and ignores any store choice. The per-store
catalog (`stores/{id}/storefrontCatalog/main`), per-store config (`storefrontConfig/main` with
`acceptsOnlineOrders`), and per-store option availability (`optionOverrides/main`) already exist —
only the bridge and the website are single-store.

We want buyers to **order from the branch that serves them**: prompt for location, show the
**nearest** store(s), and **limit which stores are visible based on the buyer's location**.

**Foundation that already exists:** store docs already carry `geo: { lat, lng }` (added for the
weather forecast, edited via `StoreGeoPicker` in `store-edit-dialog.tsx` — free paste-coordinates,
optional Google map). So coordinates are in place; what's missing is a service radius, a store-list
endpoint, and a multi-store bridge + a website store picker.

## Goals

- Buyer is prompted for location on the storefront and routed to the branch(es) that serve them.
- **Visibility is limited by location** via a per-store service radius.
- Free: browser GPS + haversine math; **no paid geocoding or Maps calls** on the buyer side.
- Server remains the authority for price, store eligibility, and delivery-area enforcement.
- Backward compatible: if no store is chosen, the bridge still falls back to `STOREFRONT_STORE_ID`.

## Locked decisions

- **Visibility model:** per-store service radius (`deliveryRadiusKm`).
- **Buyer location:** browser GPS first; if denied/unavailable, fall back to a manual pick from the
  enabled-store list (no geocoding).
- **Radius semantics:** radius = **delivery zone**. Delivery shows only stores whose radius covers
  the buyer; **pickup shows the nearest store(s) regardless of radius**. If no store covers the buyer
  for delivery, offer **pickup from the nearest** store.
- **Geo data:** reuse existing `store.geo`; add `deliveryRadiusKm` on the **store doc** (simplest
  editing, next to the existing Geotag). Participation stays gated by `acceptsOnlineOrders`.
- **Architecture:** website computes eligibility/sort client-side from a server-provided store list;
  server re-validates `storeId` + delivery-in-radius on order.

## Data model

- `Store` gains `deliveryRadiusKm?: number` (typed in `POS/src/lib/types.ts`; edited in
  `store-edit-dialog.tsx` beside the Geotag).
- A store is **online** iff `acceptsOnlineOrders === true` AND it has a valid `geo {lat,lng}`.
- Missing/zero `deliveryRadiusKm` ⇒ that store offers **pickup only** (no delivery), never an error.

## Components

### 1. New bridge endpoint — `getStorefrontStores` (`Shareat Website/functions/index.js`)
Returns the online store list for the picker:
`[{ id, name, address, geo:{lat,lng}, deliveryRadiusKm }]`. Reads hub `stores` where
`acceptsOnlineOrders === true && isActive !== false && geo` present. App-Check protected like the
other storefront functions; exposes no secrets; short cache header.

### 2. Multi-store bridge (same file)
`getStorefrontCatalog`, `placeOrder`, `storefrontOrderStatus` accept a `storeId` (query/body),
**validated against the online set**; fall back to `STOREFRONT_STORE_ID` when absent (compat).
`placeOrder` additionally enforces:
- store must be online;
- if `fulfillment.type === 'delivery'`: buyer `geo` is **required** and must be within the store's
  `deliveryRadiusKm` (haversine, server-side) — else reject `{ error: "outside delivery area" }`.

### 3. Website store picker (`Shareat Website/src/scripts/shop-store.ts` + gate in `shop.astro`)
- First visit: "Find my location" → `navigator.geolocation` → haversine vs the store list.
- **Delivery mode:** only stores whose radius covers the buyer, nearest first.
- **Pickup mode:** nearest store(s) regardless of radius.
- GPS denied/unavailable → full enabled-store list for manual pick.
- Chosen store persists in `localStorage` (mirrors the cart pattern) and drives the catalog fetch
  (`/api/storefront-catalog?storeId=`) + checkout. A header chip shows the branch + "Change" link.
- Out-of-range (delivery): message "No branch delivers to you yet — pick up from {nearest}?",
  defaulting to pickup.

### 4. Checkout wiring (`shop-checkout.ts`, `checkout.astro`)
Carry the selected `storeId` into `placeOrder`; keep the existing delivery pin (`fulfillment.geo`),
which the server now also uses for the radius check. Surface the server's "outside delivery area"
rejection inline.

### 5. Admin (`POS`)
- Add a `deliveryRadiusKm` input to `store-edit-dialog.tsx` (beside Geotag).
- Participation remains the `acceptsOnlineOrders` toggle (already in `storefront-catalog` route).
- Each participating store's catalog is rebuilt per-store (already supported via
  `rebuildStorefrontCatalog` / "Rebuild Storefront").

## Data flow

1. Website loads → `getStorefrontStores` → store list cached client-side.
2. Buyer GPS (or manual pick) → client haversine → eligible/sorted stores → buyer selects → persisted.
3. Catalog fetch for `storeId` → render menu (already store-scoped, incl. option availability).
4. Checkout → `placeOrder({storeId, fulfillment, geo, …})` → server re-validates store + delivery
   radius + recomputes price from that store's snapshot → writes to `stores/{storeId}/onlineOrders`.
5. Order lands in that store's existing online-orders inbox.

## Error handling

- GPS denied/unavailable → manual store list (not an error).
- No store covers buyer for delivery → pickup fallback message, not a dead end.
- Stale/invalid `storeId` from the client → server falls back / rejects with a clear message.
- Delivery outside radius → server rejects even if the client allowed it (authority on server).
- Missing `geo`/radius on a store → excluded from delivery; pickup still works.

## Testing (end-to-end, local)

Seed 2 online stores (TEST + one more) with `geo`, `deliveryRadiusKm`, `acceptsOnlineOrders`; build
both catalogs. Then:
- GPS near store A → A offered for delivery; spoof far coords → A hidden, pickup fallback shown.
- Switch store → catalog + per-store option availability change accordingly.
- Place a delivery order inside radius → succeeds; outside radius → server rejects.
- Confirm each order lands in the correct store's online-orders inbox.
Drive with Playwright against the Functions emulator + the static site, geolocation spoofed via
Playwright; verify hub docs with `npx tsx` reads.

## Out of scope (YAGNI)

- Delivery-zone polygons, drive-time/route distance (straight-line haversine only).
- Paid geocoding of typed addresses.
- Buyer accounts/saved addresses beyond the existing guest flow.
- Delivery-fee-by-distance pricing (radius gates availability only, not price).

## Risks

- **Catalog freshness:** each participating store must have a built catalog; a store toggled online
  without a rebuild shows empty — call out in admin / rebuild on enable.
- **GPS accuracy:** coarse fixes near a radius edge can flip eligibility; server is the final word on
  delivery, and pickup is always available as fallback.
- **Coordinate data quality:** wrong store `geo` mis-routes buyers; admin paste-from-Maps + the map
  pin mitigate. Radius defaults conservative.
