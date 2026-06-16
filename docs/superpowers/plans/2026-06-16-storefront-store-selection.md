# Storefront location-based store selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let storefront buyers be routed to the branch that serves them — prompt for location, show the nearest store(s), and limit store visibility by a per-store delivery radius — across the website and the multi-store bridge.

**Architecture:** The website fetches the list of online stores (with `geo` + radius), computes nearest/eligible client-side via haversine (free, no Maps API), and the buyer picks a store that is persisted and drives the catalog + checkout. The website Cloud Functions become multi-store and the server re-validates the chosen store and enforces the delivery radius on order placement (server stays the authority).

**Tech Stack:** Astro 5 + Tailwind (website client), Firebase Cloud Functions (Node 20, `asia-southeast1`) reading the hub via Admin SDK, Next.js 15 admin (POS). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-storefront-store-selection-design.md`

**Verification note:** The website has no test runner. The one pure-logic module (distance/eligibility) is verified with a throwaway `npx tsx` assertion; everything else is verified at runtime (build + Playwright against the Functions emulator + static site), matching this project's established practice. Commit after each task. Do NOT push (user tests locally first).

---

## File Structure

**POS repo (`C:/Users/ianla/webapps/POS`):**
- Modify `src/lib/types.ts` — add `geo?` + `deliveryRadiusKm?` to `Store`.
- Modify `src/components/admin/store-edit-dialog.tsx` — radius input next to the Geotag; save it.

**Website repo (`C:/Users/ianla/webapps/Shareat Website`):**
- Modify `functions/index.js` — new `getStorefrontStores`; make `getStorefrontCatalog`, `placeOrder`, `storefrontOrderStatus` store-aware; server radius enforcement + a `haversineKm` helper.
- Modify `firebase.json` — rewrite `/api/storefront-stores` → `getStorefrontStores`.
- Create `src/lib/store-eligibility.ts` — pure haversine + eligibility/sort helpers (shared by the picker).
- Create `src/scripts/shop-store.ts` — store-picker controller (GPS, manual fallback, persistence, header chip).
- Modify `src/pages/shop.astro` — store-gate markup + picker mount + header chip.
- Modify `src/scripts/shop-catalog.ts` — fetch catalog for the selected store; re-render on store change.
- Modify `src/pages/shop/checkout.astro` + `src/scripts/shop-checkout.ts` — carry `storeId`; surface "outside delivery area".

---

## Task 1: Add store geo + delivery radius to the POS data model

**Files:**
- Modify: `POS/src/lib/types.ts` (the `Store` type, ~709-746)
- Modify: `POS/src/components/admin/store-edit-dialog.tsx`

- [ ] **Step 1: Type the geo + radius fields on `Store`**

In `POS/src/lib/types.ts`, inside `export type Store = { … }`, add after `address: string;`:

```ts
  /** Geotag used for the weather forecast AND storefront store-selection distance. */
  geo?: { lat: number; lng: number };
  /**
   * Online-delivery service radius in km. A storefront buyer is offered DELIVERY
   * from this store only when within this distance (server-enforced in placeOrder).
   * 0/absent ⇒ pickup only. Pickup ignores this radius entirely.
   */
  deliveryRadiusKm?: number;
```

- [ ] **Step 2: Add the radius field to the store edit form schema**

In `POS/src/components/admin/store-edit-dialog.tsx`, find the zod schema with `geoLat`/`geoLng` (~31-32) and add:

```ts
  deliveryRadiusKm: z.string().optional(),
```

In both `defaultValues` objects (~99 and ~155), add `deliveryRadiusKm: "",`. In the `reset(...)` from an existing store (~137-138, beside geoLat/geoLng), add:

```ts
        deliveryRadiusKm: store.deliveryRadiusKm != null ? String(store.deliveryRadiusKm) : "",
```

- [ ] **Step 3: Persist the radius on save**

In the same file's submit handler (~187-191), extend the geo parsing:

```ts
    const { geoLat, geoLng, deliveryRadiusKm, ...rest } = data;
    const lat = geoLat && geoLat.trim() !== "" ? Number(geoLat) : NaN;
    const lng = geoLng && geoLng.trim() !== "" ? Number(geoLng) : NaN;
    const geo = !Number.isNaN(lat) && !Number.isNaN(lng) ? { lat, lng } : undefined;
    const radiusNum = deliveryRadiusKm && deliveryRadiusKm.trim() !== "" ? Number(deliveryRadiusKm) : NaN;
    const radius = Number.isFinite(radiusNum) && radiusNum >= 0 ? radiusNum : undefined;
    onSave({ ...rest, ...(geo ? { geo } : {}), ...(radius != null ? { deliveryRadiusKm: radius } : {}) } as any);
```

- [ ] **Step 4: Add the radius input under the Geotag**

In the JSX, immediately after the `<StoreGeoPicker … />` block (~243), add:

```tsx
                  <FormField
                    control={form.control}
                    name="deliveryRadiusKm"
                    render={({ field }) => (
                      <FormItem className="mt-3">
                        <FormLabel>Online delivery radius (km)</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="e.g. 5" {...field} />
                        </FormControl>
                        <FormDescription>
                          Buyers within this distance can order delivery online. Leave blank for pickup-only. Pickup ignores this.
                        </FormDescription>
                      </FormItem>
                    )}
                  />
```

Confirm `FormField, FormItem, FormLabel, FormControl, FormDescription, Input` are already imported in this file (they are used elsewhere in it); if any is missing, add it to the existing imports.

- [ ] **Step 5: Build POS**

Run: `cd /c/Users/ianla/webapps/POS && NEXT_DISABLE_TURBOPACK=1 NEXT_PRIVATE_MAX_WORKERS=1 npx next build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/ianla/webapps/POS add src/lib/types.ts src/components/admin/store-edit-dialog.tsx
git -C /c/Users/ianla/webapps/POS commit -m "stores: add deliveryRadiusKm to store model + edit form"
```

---

## Task 2: Pure eligibility helper (distance + filter/sort)

**Files:**
- Create: `Shareat Website/src/lib/store-eligibility.ts`

- [ ] **Step 1: Write the helper**

Create `Shareat Website/src/lib/store-eligibility.ts`:

```ts
export type LatLng = { lat: number; lng: number };
export type StorefrontStore = {
  id: string;
  name: string;
  address?: string;
  geo: LatLng;
  deliveryRadiusKm?: number;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
};
export type RankedStore = StorefrontStore & { distanceKm: number; deliverable: boolean };

/** Great-circle distance in km between two coordinates. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** All stores with distance from the buyer, nearest first; flags delivery eligibility. */
export function rankStores(stores: StorefrontStore[], buyer: LatLng): RankedStore[] {
  return stores
    .map((s) => {
      const distanceKm = haversineKm(buyer, s.geo);
      const radius = Number(s.deliveryRadiusKm) || 0;
      const deliverable = s.deliveryEnabled !== false && radius > 0 && distanceKm <= radius;
      return { ...s, distanceKm, deliverable };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Stores that can deliver to the buyer (radius covers them), nearest first. */
export function deliverableStores(stores: StorefrontStore[], buyer: LatLng): RankedStore[] {
  return rankStores(stores, buyer).filter((s) => s.deliverable);
}
```

- [ ] **Step 2: Assert the math with a throwaway tsx script**

Create `Shareat Website/tmp-eligibility-check.mjs`:

```js
import { haversineKm, rankStores, deliverableStores } from "./src/lib/store-eligibility.ts";
const buyer = { lat: 14.5995, lng: 120.9842 }; // Manila
const near = { id: "near", name: "Near", geo: { lat: 14.61, lng: 120.99 }, deliveryRadiusKm: 5, deliveryEnabled: true };
const far  = { id: "far",  name: "Far",  geo: { lat: 14.90, lng: 121.30 }, deliveryRadiusKm: 5, deliveryEnabled: true };
const km = haversineKm(buyer, near.geo);
const ranked = rankStores([far, near], buyer);
const deliv = deliverableStores([far, near], buyer);
console.assert(km < 5, "near store should be <5km, got " + km);
console.assert(ranked[0].id === "near", "nearest should sort first");
console.assert(deliv.length === 1 && deliv[0].id === "near", "only near store deliverable");
console.log("OK distance=" + km.toFixed(2) + "km; ranked=" + ranked.map(r=>r.id).join(",") + "; deliverable=" + deliv.map(r=>r.id).join(","));
```

Run: `cd "/c/Users/ianla/webapps/Shareat Website" && npx tsx tmp-eligibility-check.mjs`
Expected: prints `OK distance=…km; ranked=near,far; deliverable=near` and no assertion errors.

- [ ] **Step 3: Remove the throwaway script**

Run: `rm "/c/Users/ianla/webapps/Shareat Website/tmp-eligibility-check.mjs"`

- [ ] **Step 4: Commit**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add src/lib/store-eligibility.ts
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: pure store distance/eligibility helper"
```

---

## Task 3: `getStorefrontStores` endpoint + rewrite

**Files:**
- Modify: `Shareat Website/functions/index.js`
- Modify: `Shareat Website/firebase.json`

- [ ] **Step 1: Add a shared haversine helper in functions**

In `functions/index.js`, near the other storefront helpers (after `storefrontStoreId()`, ~50), add:

```js
// Great-circle distance in km — server-side mirror of the client helper. Used to
// enforce the per-store delivery radius in placeOrder.
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Reads a store's storefront fields from the hub (store doc + storefrontConfig).
// Returns null when the store isn't a valid online store (no geo / not accepting).
async function readOnlineStore(hubDb, storeId) {
  const [storeSnap, cfgSnap] = await Promise.all([
    hubDb.doc(`stores/${storeId}`).get(),
    hubDb.doc(`stores/${storeId}/storefrontConfig/main`).get(),
  ]);
  if (!storeSnap.exists) return null;
  const s = storeSnap.data();
  if (s.acceptsOnlineOrders !== true || s.isActive === false) return null;
  const lat = Number(s.geo && s.geo.lat);
  const lng = Number(s.geo && s.geo.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  return {
    id: storeId,
    name: s.name || "SharEat",
    address: s.address || "",
    geo: { lat, lng },
    deliveryRadiusKm: Number(s.deliveryRadiusKm) || 0,
    deliveryEnabled: cfg.deliveryEnabled === true,
    pickupEnabled: cfg.pickupEnabled !== false,
  };
}
```

- [ ] **Step 2: Add the `getStorefrontStores` function**

In `functions/index.js`, in the ONLINE STOREFRONT section (near `getStorefrontCatalog`, ~723), add a new export. Match the existing function's structure (App Check gate via the existing helper used by `getStorefrontCatalog` — reuse the same guard call you see there):

```js
exports.getStorefrontStores = onRequest(
  { region: "asia-southeast1", cors: true },
  async (req, res) => {
    try {
      if (!(await appCheckAllowed(req))) return res.status(401).json({ error: "App Check failed" });
      const hubDb = getHubDb();
      const snap = await hubDb.collection("stores").where("acceptsOnlineOrders", "==", true).get();
      const stores = (
        await Promise.all(snap.docs.map((d) => readOnlineStore(hubDb, d.id)))
      ).filter(Boolean);
      res.set("Cache-Control", "public, max-age=60");
      return res.json({ stores });
    } catch (e) {
      console.error("getStorefrontStores failed:", e);
      return res.status(500).json({ error: "Failed to load stores" });
    }
  }
);
```

NOTE: use the SAME App Check check the sibling storefront functions use. Open `getStorefrontCatalog` (~723) and copy its exact App-Check guard (the function name differs across the file — it is the one that returns `true` under `FUNCTIONS_EMULATOR`). Replace `appCheckAllowed(req)` above with that exact call.

- [ ] **Step 3: Add the hosting rewrite**

In `Shareat Website/firebase.json`, add to `hosting.rewrites` (after the `/api/storefront-catalog` entry):

```json
      {
        "source": "/api/storefront-stores",
        "function": { "functionId": "getStorefrontStores", "region": "asia-southeast1" }
      },
```

- [ ] **Step 4: Verify the endpoint under the emulator**

Run: `cd "/c/Users/ianla/webapps/Shareat Website" && firebase emulators:start --only functions` (background).
Then in another shell (App Check is bypassed under the emulator via `FUNCTIONS_EMULATOR`):
`curl -s "http://127.0.0.1:5001/<hubProjectId>/asia-southeast1/getStorefrontStores" | head -c 600`
Expected: JSON `{"stores":[…]}` containing each online store with `geo` + `deliveryRadiusKm`. (If none yet, `{"stores":[]}` — Task 8 seeds them.)

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add functions/index.js firebase.json
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: getStorefrontStores endpoint + rewrite + radius helpers"
```

---

## Task 4: Make catalog + order-status store-aware

**Files:**
- Modify: `Shareat Website/functions/index.js` (`getStorefrontCatalog` ~723, `storefrontOrderStatus` ~1081)

- [ ] **Step 1: Resolve a requested storeId, validated against online set**

Add a helper near `storefrontStoreId()` in `functions/index.js`:

```js
// Resolves the store to serve: an explicit, validated online storeId, else the
// configured pilot store (compat). Returns null if neither is usable.
async function resolveStoreId(hubDb, requested) {
  const id = String(requested || "").trim();
  if (id) {
    const ok = await readOnlineStore(hubDb, id);
    if (ok) return id;
  }
  return storefrontStoreId() || null;
}
```

- [ ] **Step 2: Use it in `getStorefrontCatalog`**

In `getStorefrontCatalog` (~728), replace `const storeId = storefrontStoreId();` with:

```js
      const hubDb = getHubDb();
      const storeId = await resolveStoreId(hubDb, req.query && req.query.storeId);
      if (!storeId) return res.status(404).json({ error: "No store" });
```

Ensure the subsequent reads use this `hubDb`/`storeId` (the doc paths at ~734-735 already interpolate `storeId`). Remove any now-duplicate `getHubDb()` call below.

- [ ] **Step 3: Use it in `storefrontOrderStatus`**

In `storefrontOrderStatus` (~1086), replace `const storeId = storefrontStoreId();` with the same resolve pattern (it reads `req.query.storeId`), so status polling targets the same store the order was placed at:

```js
      const hubDb = getHubDb();
      const storeId = await resolveStoreId(hubDb, req.query && req.query.storeId);
      if (!storeId) return res.status(404).json({ error: "No store" });
```

Remove any now-duplicate `getHubDb()` below.

- [ ] **Step 4: Verify under the emulator**

With the emulator running and at least one online store seeded (Task 8 can be done first if needed):
`curl -s "http://127.0.0.1:5001/<hubProjectId>/asia-southeast1/getStorefrontCatalog?storeId=TEST" | head -c 400`
Expected: that store's catalog JSON. Omitting `storeId` returns the pilot store's catalog (compat).

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add functions/index.js
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: catalog + order-status accept a validated storeId"
```

---

## Task 5: `placeOrder` — store-aware + delivery radius enforcement

**Files:**
- Modify: `Shareat Website/functions/index.js` (`placeOrder` ~858-1074)

- [ ] **Step 1: Resolve + validate the store**

In `placeOrder` (~863), replace `const storeId = storefrontStoreId();` with:

```js
      const hubDb = getHubDb();
      const storeId = await resolveStoreId(hubDb, body.storeId);
      if (!storeId) return res.status(400).json({ error: "No store selected" });
      const store = await readOnlineStore(hubDb, storeId);
      if (!store) return res.status(400).json({ error: "This branch isn't accepting online orders." });
```

Remove the later duplicate `getHubDb()` if present, and make the snapshot reads (~900-901) use this `hubDb`/`storeId`.

- [ ] **Step 2: Enforce the delivery radius**

The existing block validates the delivery pin into `geo` (~881-889). Immediately AFTER that block, add:

```js
      if (ftype === "delivery") {
        if (!geo) return res.status(400).json({ error: "Please set your delivery location pin." });
        if (!store.deliveryEnabled || !(store.deliveryRadiusKm > 0)) {
          return res.status(400).json({ error: "This branch isn't delivering online right now." });
        }
        const distKm = haversineKm(store.geo, geo);
        if (distKm > store.deliveryRadiusKm) {
          return res.status(400).json({ error: "Sorry — you're outside this branch's delivery area." });
        }
      }
```

- [ ] **Step 3: Verify rejection + acceptance under the emulator**

With the emulator running and store `TEST` seeded with `geo` + small `deliveryRadiusKm` (Task 8):
- POST a delivery order with a pin INSIDE the radius → expect `200` + an order id.
- POST the same with a pin far OUTSIDE → expect `400` `{ "error": "…outside this branch's delivery area." }`.

Example (inside): `curl -s -X POST "http://127.0.0.1:5001/<hubProjectId>/asia-southeast1/placeOrder" -H "Content-Type: application/json" -d '{"storeId":"TEST","fulfillment":{"type":"delivery","geo":{"lat":<near>,"lng":<near>}}, …minimal valid body…}'`
(Use a body shaped like the website's checkout payload; copy field names from `shop-checkout.ts`.)
Expected: inside → ok; outside → 400 with the delivery-area error.

- [ ] **Step 4: Commit**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add functions/index.js
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: placeOrder store-aware + server-enforced delivery radius"
```

---

## Task 6: Website store picker (GPS, fallback, persistence)

**Files:**
- Create: `Shareat Website/src/scripts/shop-store.ts`
- Modify: `Shareat Website/src/pages/shop.astro` (add the gate markup + mount)

- [ ] **Step 1: Read the current shop entry wiring**

Open `src/scripts/shop-catalog.ts` (note the `$()` helper, `appCheckedFetch`, the catalog fetch at ~435, and how the page boots) and `src/pages/shop.astro` (where the catalog mounts and where scripts are included). The picker reuses `appCheckedFetch` and the same `localStorage` pattern as the cart.

- [ ] **Step 2: Write the store-picker controller**

Create `src/scripts/shop-store.ts`:

```ts
import { appCheckedFetch } from "../lib/firebase-client";
import { rankStores, deliverableStores, type StorefrontStore, type RankedStore, type LatLng } from "../lib/store-eligibility";

const LS_KEY = "shareat_store_id";
let cache: StorefrontStore[] | null = null;

export function getSelectedStoreId(): string | null {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
export function setSelectedStoreId(id: string) {
  try { localStorage.setItem(LS_KEY, id); } catch {}
  document.dispatchEvent(new CustomEvent("shareat:store-changed", { detail: { id } }));
}

export async function loadStores(): Promise<StorefrontStore[]> {
  if (cache) return cache;
  const res = await appCheckedFetch("/api/storefront-stores", { method: "GET" });
  const json = await res.json().catch(() => ({}));
  cache = Array.isArray(json.stores) ? json.stores : [];
  return cache;
}

export function getBuyerLocation(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/** Build the picker list for a fulfillment mode given an optional buyer location. */
export function pickerList(stores: StorefrontStore[], buyer: LatLng | null, mode: "delivery" | "pickup"): RankedStore[] {
  if (!buyer) return stores.map((s) => ({ ...s, distanceKm: NaN, deliverable: s.deliveryEnabled !== false })) as RankedStore[];
  return mode === "delivery" ? deliverableStores(stores, buyer) : rankStores(stores, buyer);
}
```

- [ ] **Step 3: Render the picker UI + gate**

Append to `src/scripts/shop-store.ts` a `mountStorePicker()` that:
- renders into a `#shop-store-gate` element a panel with: a "📍 Find my location" button, a fulfillment toggle (Delivery / Pickup), and (after location or on fallback) a list of stores with name, address, and distance (`x.x km away`) or "Outside delivery area" when not deliverable in delivery mode;
- on "Find my location": call `getBuyerLocation()`; if null, show the full store list with a note "Couldn't get your location — choose a branch"; in delivery mode with zero deliverable stores, show "No branch delivers to you yet — switch to Pickup" and auto-suggest the nearest for pickup;
- on selecting a store: `setSelectedStoreId(id)`, hide the gate, reveal `#shop-catalog`;
- a header chip element `#shop-store-chip` shows the chosen branch name with a "Change" button that re-opens the gate.

```ts
export async function mountStorePicker() {
  const gate = document.getElementById("shop-store-gate");
  const chip = document.getElementById("shop-store-chip");
  if (!gate) return;
  const stores = await loadStores();

  const render = (buyer: LatLng | null, mode: "delivery" | "pickup", note = "") => {
    const list = pickerList(stores, buyer, mode);
    const rows = list.map((s) => {
      const dist = Number.isFinite(s.distanceKm) ? `${s.distanceKm.toFixed(1)} km away` : "";
      const blocked = mode === "delivery" && !s.deliverable;
      return `<button data-store="${s.id}" ${blocked ? "disabled" : ""} class="store-row${blocked ? " store-row--blocked" : ""}">
        <span class="store-row__name">${s.name}</span>
        <span class="store-row__meta">${s.address || ""}${dist ? " · " + dist : ""}${blocked ? " · Outside delivery area" : ""}</span>
      </button>`;
    }).join("");
    const emptyDelivery = mode === "delivery" && buyer && list.length === 0;
    gate.innerHTML = `
      <div class="store-gate">
        <h2>Choose your branch</h2>
        <div class="store-gate__modes">
          <button data-mode="delivery" class="${mode === "delivery" ? "is-active" : ""}">Delivery</button>
          <button data-mode="pickup" class="${mode === "pickup" ? "is-active" : ""}">Pickup</button>
        </div>
        <button id="store-locate" class="store-gate__locate">📍 Find my location</button>
        ${note ? `<p class="store-gate__note">${note}</p>` : ""}
        ${emptyDelivery ? `<p class="store-gate__note">No branch delivers to you yet — try Pickup.</p>` : ""}
        <div class="store-gate__list">${rows || "<p>No branches available.</p>"}</div>
      </div>`;
    gate.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => render(buyer, (b as HTMLElement).dataset.mode as any, "")));
    gate.querySelector("#store-locate")?.addEventListener("click", async () => {
      const loc = await getBuyerLocation();
      render(loc, mode, loc ? "" : "Couldn't get your location — choose a branch below.");
    });
    gate.querySelectorAll("[data-store]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = (b as HTMLElement).dataset.store!;
        try { localStorage.setItem("shareat_fulfillment_mode", mode); } catch {}
        setSelectedStoreId(id);
        gate.classList.add("hidden");
        document.getElementById("shop-catalog")?.classList.remove("hidden");
        const chosen = stores.find((s) => s.id === id);
        if (chip && chosen) { chip.textContent = chosen.name; chip.classList.remove("hidden"); }
      }));
  };

  // Open the gate (initial, or via Change). Default to delivery mode.
  const open = () => {
    gate.classList.remove("hidden");
    document.getElementById("shop-catalog")?.classList.add("hidden");
    render(null, (localStorage.getItem("shareat_fulfillment_mode") as any) || "delivery");
  };
  chip?.addEventListener("click", open);

  const selected = getSelectedStoreId();
  if (selected && stores.some((s) => s.id === selected)) {
    const chosen = stores.find((s) => s.id === selected)!;
    if (chip) { chip.textContent = chosen.name; chip.classList.remove("hidden"); }
    document.getElementById("shop-catalog")?.classList.remove("hidden");
    gate.classList.add("hidden");
  } else {
    open();
  }
}
```

- [ ] **Step 4: Add the gate markup + chip + mount in `shop.astro`**

In `src/pages/shop.astro`, above the existing `#shop-catalog` container add `<div id="shop-store-gate"></div>` and add a header chip button `<button id="shop-store-chip" class="hidden"></button>` near the cart/nav. In the page's client script block (where `shop-catalog.ts` boots), import and call the picker BEFORE the catalog boot so a store is chosen first:

```ts
import { mountStorePicker, getSelectedStoreId } from "../scripts/shop-store";
await mountStorePicker();
```

Add minimal CSS (Tailwind classes or a `<style>`) for `.store-gate`, `.store-row`, `.store-row--blocked` (dimmed, `cursor-not-allowed`) consistent with the existing shop styling.

- [ ] **Step 5: Build the site**

Run: `cd "/c/Users/ianla/webapps/Shareat Website" && npm run build`
Expected: Astro build succeeds, no type errors.

- [ ] **Step 6: Commit**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add src/scripts/shop-store.ts src/pages/shop.astro
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: location-based store picker (GPS + manual fallback)"
```

---

## Task 7: Catalog fetch follows the selected store

**Files:**
- Modify: `Shareat Website/src/scripts/shop-catalog.ts` (fetch at ~435)

- [ ] **Step 1: Pass the selected storeId into the catalog fetch**

In `shop-catalog.ts`, import the selector and append the query param:

```ts
import { getSelectedStoreId } from "./shop-store";
// …
const sid = getSelectedStoreId();
const res = await appCheckedFetch(`/api/storefront-catalog${sid ? `?storeId=${encodeURIComponent(sid)}` : ""}`, { method: "GET" });
```

- [ ] **Step 2: Re-fetch the catalog when the store changes**

Wrap the existing catalog-boot in a function (e.g. `renderCatalog()`), call it on boot, and also on store change:

```ts
document.addEventListener("shareat:store-changed", () => { void renderCatalog(); });
```

Clear the current cart on store switch (items priced for another branch shouldn't carry over) — reuse the cart's existing clear function; if none is exported, empty the cart `localStorage` key the cart module uses and re-render the cart badge.

- [ ] **Step 3: Build**

Run: `cd "/c/Users/ianla/webapps/Shareat Website" && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add src/scripts/shop-catalog.ts
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: catalog fetch + re-render follow the selected store"
```

---

## Task 8: Checkout carries storeId + surfaces delivery-area errors; seed + end-to-end verify

**Files:**
- Modify: `Shareat Website/src/scripts/shop-checkout.ts`, `Shareat Website/src/pages/shop/checkout.astro`
- Verify only (no commit): seed via `npx tsx` against the hub TEST + one more store

- [ ] **Step 1: Send storeId from checkout**

In `shop-checkout.ts`, import `getSelectedStoreId` and include `storeId` in the `placeOrder` body and in the order-status poll URL (`/api/storefront-order-status?storeId=…&orderId=…`). If no store is selected, redirect back to `/shop` to pick one.

- [ ] **Step 2: Surface the server's delivery-area rejection**

Where the `placeOrder` response is handled, when the server returns `400` with an `error`, show that message inline near the fulfillment section (the server messages are user-facing, e.g. "outside this branch's delivery area"). Re-enable the submit button (guard against double-submit per existing pattern).

- [ ] **Step 3: Build**

Run: `cd "/c/Users/ianla/webapps/Shareat Website" && npm run build`
Expected: success.

- [ ] **Step 4: Seed two online stores with geo + radius**

Write a throwaway `npx tsx` script (service account `C:/Users/ianla/webapps/PK/POS.json`, project `shareat-hub-v2`) that sets on `stores/TEST` and one other store (e.g. an existing branch id): `acceptsOnlineOrders: true`, `geo: { lat, lng }` (two distinct PH coordinates), `deliveryRadiusKm: 3`, and `storefrontConfig/main` `{ deliveryEnabled: true, pickupEnabled: true }`. Then call the POS rebuild for each (or run `rebuildStorefrontCatalog` via the existing admin "Rebuild Storefront" with each store active). Delete the seed script after running.

- [ ] **Step 5: End-to-end via emulator + static site (Playwright)**

Start the Functions emulator and serve the built site (or `astro dev`). With Playwright (geolocation spoofed via the context), verify:
1. Land on `/shop` → store gate appears (no catalog yet).
2. Spoof coordinates near store A → "Find my location" → A listed as deliverable (distance shown); pick A → catalog renders.
3. "Change" → switch to store B → catalog re-renders to B's items; cart cleared.
4. Spoof coordinates far from all stores, Delivery mode → list empty + "try Pickup"; Pickup mode → nearest store still selectable.
5. Place a delivery order from store A with the pin inside radius → success → order lands in `stores/A/onlineOrders` (verify via `npx tsx` read or the POS Online-Orders inbox).
6. Force a far delivery pin → checkout shows "outside this branch's delivery area"; no order written.

Capture screenshots for steps 1, 2, 4, 6.

- [ ] **Step 6: Commit (website) — do NOT push**

```bash
git -C "/c/Users/ianla/webapps/Shareat Website" add src/scripts/shop-checkout.ts src/pages/shop/checkout.astro
git -C "/c/Users/ianla/webapps/Shareat Website" commit -m "storefront: checkout carries storeId + surfaces delivery-area errors"
```

---

## Self-review (against the spec)

- **Per-store radius visibility** → Tasks 1 (data), 2 (eligibility), 6 (picker filtering). ✓
- **GPS + manual fallback (free)** → Task 6 (`getBuyerLocation` + fallback list, haversine, no Maps API). ✓
- **Radius = delivery zone; pickup always; out-of-range → pickup** → Tasks 2 (`deliverableStores` vs `rankStores`) + 6 (mode toggle + empty-delivery note) + 5 (server enforces delivery only). ✓
- **Reuse `store.geo` + `acceptsOnlineOrders`; add radius** → Tasks 1, 3 (`readOnlineStore`). ✓
- **Multi-store bridge, server authority, backward compatible** → Tasks 3–5 (`resolveStoreId` falls back to pilot; server re-validates + recomputes price). ✓
- **Admin entry** → Task 1 (radius beside Geotag; `acceptsOnlineOrders` unchanged). ✓
- **Testing** → Task 8 end-to-end. ✓
- **Type consistency:** `StorefrontStore`/`RankedStore`/`LatLng` defined in Task 2 and reused in Task 6; `readOnlineStore`/`resolveStoreId`/`haversineKm` defined in Task 3 and reused in Tasks 4–5. ✓
- **Open risk to watch:** the exact App Check guard name in `functions/index.js` must be copied from a sibling storefront function (Task 3 Step 2 calls this out) rather than assumed.
